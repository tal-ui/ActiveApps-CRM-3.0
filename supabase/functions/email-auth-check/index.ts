// email-auth-check — looks up SPF, DKIM and DMARC for a domain.
//
// Only the lookups happen here. Parsing lives in src/lib/emailAuth.ts, so the
// settings page and the send window share one implementation that can be
// unit-tested without a network, and this function stays small enough to
// redeploy freely.
//
// Server-side rather than from the page: both public resolvers do send CORS
// headers and the app publishes no CSP, but ad-blocking extensions routinely
// block dns.google from a document — which would report the user's DNS as
// unreachable for reasons that have nothing to do with their DNS.
//
// Deploy with verify_jwt = true, admin-gated: the sending domain is derived
// here from integrations.config, which the browser can never read — the From
// address sits in the same jsonb as the app password, so a browser-side
// checker would have to guess the domain from a different field and could
// silently check the wrong one.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const RESOLVERS = [
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
];

/** Selectors worth sweeping when the caller has not named one. */
const COMMON_DKIM_SELECTORS = [
  "google",
  "default",
  "selector1",
  "selector2",
  "s1",
  "s2",
  "mail",
  "dkim",
  "k1",
  "zoho",
];

// A domain someone types. Strict on purpose.
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

// An SPF include: target, which routinely has underscore labels — _spf.google.com
// is the most common include in existence, and every flattening service uses
// names like dc-xxxx._spfm.example.com. Validating those with DOMAIN_RE
// silently resolved nothing at all.
const SPF_TARGET_RE = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)+$/;

function normaliseTxt(v: unknown): string {
  // Resolvers quote TXT values, and split long ones into adjacent chunks.
  return String(v ?? "")
    .replace(/^"|"$/g, "")
    .replace(/"\s+"/g, "")
    .trim();
}

const TXT_TYPE = 16;

async function txtFrom(base: string, name: string): Promise<string[] | null> {
  try {
    const res = await fetch(
      `${base}?name=${encodeURIComponent(name)}&type=TXT`,
      {
        headers: { accept: "application/dns-json" },
        // Layer one of the staleness problem: without this the runtime's own
        // HTTP cache can serve a "missing" answer long after it was fixed.
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      Status?: number;
      Answer?: { data?: string; type?: number }[];
    };
    // SERVFAIL/REFUSED is not an answer. Reporting it as "no record" would
    // send someone to fix a record that is already there.
    if (body.Status === 2 || body.Status === 5) return null;
    return (body.Answer ?? [])
      // Answer mixes types: a CNAME'd DKIM name returns the CNAME too, and
      // treating its target hostname as a TXT record is nonsense.
      .filter((a) => a.type === undefined || a.type === TXT_TYPE)
      .map((a) => normaliseTxt(a.data))
      .filter(Boolean);
  } catch {
    return null;
  }
}

/**
 * Asks both resolvers and reports whether they agreed.
 *
 * Public resolvers cache negative answers, so a record published minutes ago
 * can still read as missing. Disagreement is the signal that a change is
 * mid-propagation, which is worth saying out loud rather than asserting a
 * stale failure at someone who has just done the right thing.
 */
async function txtRecords(
  name: string,
): Promise<{ records: string[]; disagree: boolean; unreachable: boolean }> {
  const answers = (await Promise.all(RESOLVERS.map((r) => txtFrom(r, name))))
    .filter((x): x is string[] => x !== null);
  if (answers.length === 0) {
    return { records: [], disagree: false, unreachable: true };
  }
  const key = (list: string[]) => [...list].sort().join("|");
  const disagree = answers.length === 2 && key(answers[0]) !== key(answers[1]);
  // Union, so a record either resolver can already see counts as present.
  return { records: [...new Set(answers.flat())], disagree, unreachable: false };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as {
      domain?: string;
      dkimSelector?: string;
    };

    const authHeader = req.headers.get("Authorization") ?? "";
    const { data: userData } = await supabase.auth.getUser(
      authHeader.replace(/^Bearer\s+/i, ""),
    );
    const userId = userData?.user?.id ?? "";
    if (!userId) return json(401, { error: "unauthorized" });
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("auth_user_id", userId)
      .maybeSingle();
    if (String((profile as { role?: string } | null)?.role) !== "admin") {
      return json(403, { error: "forbidden" });
    }

    // The From address lives in integrations.config, which only the service
    // role can read. Only the derived domain leaves this function.
    const { data: integ } = await supabase
      .from("integrations")
      .select("connected, config")
      .eq("key", "email_smtp")
      .maybeSingle();
    const cfg = (integ?.config ?? {}) as Record<string, unknown>;
    const configuredFrom = String(cfg.from_address ?? cfg.username ?? "");
    const fromDomain = (configuredFrom.split("@")[1] ?? "").toLowerCase();
    const smtpHost = String(cfg.host ?? "");

    const domain = String(body.domain ?? fromDomain ?? "")
      .trim()
      .toLowerCase()
      .replace(/^@/, "")
      .replace(/\.$/, "");
    if (!domain || domain.length > 253 || !DOMAIN_RE.test(domain)) {
      return json(400, { error: "bad_domain" });
    }

    const selectors = [
      ...new Set(
        [String(body.dkimSelector ?? "").trim(), ...COMMON_DKIM_SELECTORS]
          .filter(Boolean)
          .filter((s) => /^[a-z0-9._-]{1,63}$/i.test(s)),
      ),
    ];

    const [apex, dmarc, ...dkimResults] = await Promise.all([
      txtRecords(domain),
      txtRecords(`_dmarc.${domain}`),
      ...selectors.map((sel) => txtRecords(`${sel}._domainkey.${domain}`)),
    ]);

    const dkim: Record<string, string[]> = {};
    selectors.forEach((sel, i) => {
      dkim[sel] = dkimResults[i].records;
    });

    // One level of include: expansion. An SPF flattening service publishes
    // include:xyz._spfm.example.com, so judging the top record by string match
    // alone reports a correct delegated record as broken.
    const spfRecord = apex.records.find((r) =>
      r.trim().toLowerCase().startsWith("v=spf1"),
    );
    const includeTargets = [
      ...new Set(
        [...(spfRecord ?? "").matchAll(/\b(?:include|redirect)[:=]([^\s]+)/gi)]
          .map((m) => m[1].toLowerCase())
          .filter((t) => t.length <= 253 && SPF_TARGET_RE.test(t)),
      ),
    ].slice(0, 10);
    const includeChain = (
      await Promise.all(includeTargets.map((t) => txtRecords(t)))
    ).flatMap((r) => r.records.filter((x) => x.toLowerCase().startsWith("v=spf1")));

    return json(200, {
      ok: true,
      records: {
        domain,
        fromDomain,
        smtpHost,
        apex: apex.records,
        includeChain,
        dmarc: dmarc.records,
        dkim,
        unreachable: apex.unreachable && dmarc.unreachable,
        resolversDisagree: apex.disagree || dmarc.disagree,
        checkedAt: Date.now(),
      },
    });
  } catch (e) {
    return json(500, {
      error: "unexpected",
      detail: String((e as Error)?.message ?? e).slice(0, 300),
    });
  }
});
