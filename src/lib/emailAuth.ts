// SPF / DKIM / DMARC: what the records mean, and what to publish when they
// are missing.
//
// Pure functions over raw TXT records. The edge function does the DNS
// lookups (ad blockers routinely block dns.google from a page) and hands the
// records back unparsed, so this logic has exactly one implementation and can
// be tested without any network at all.
//
// Nothing here writes DNS. The CRM cannot: these records live at the domain's
// nameservers. This module diagnoses and generates the values to paste.

/**
 * "unknown" is the one that keeps the panel honest: a resolver outage must
 * never render as "you have no SPF record" and send someone into their DNS
 * panel to fix something that is already there.
 */
export type AuthStatus = "pass" | "warn" | "fail" | "unknown";

export interface AuthCheck {
  status: AuthStatus;
  /** One sentence, written for someone who does not know what SPF is. */
  detail: string;
  /** The record that was found, when there was one. */
  record?: string;
}

export interface AuthRecords {
  domain: string;
  /** Derived server-side from the SMTP config — the browser cannot see it. */
  fromDomain?: string;
  smtpHost?: string;
  /** True when neither resolver answered: nothing can be concluded. */
  unreachable?: boolean;
  /** Every TXT record at the apex. */
  apex: string[];
  /** SPF records of each include: target, one level deep. */
  includeChain?: string[];
  /** Every TXT record at _dmarc.<domain>. */
  dmarc: string[];
  /** selector -> TXT records at <selector>._domainkey.<domain>. */
  dkim: Record<string, string[]>;
  /** True when the two resolvers disagreed — a change is mid-propagation. */
  resolversDisagree?: boolean;
  checkedAt: number;
}

/** Selectors worth sweeping when the user has not named one. */
export const COMMON_DKIM_SELECTORS = [
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

/** Mechanisms that cost a DNS lookup against SPF's limit of 10. */
const LOOKUP_MECHANISMS = /\b(include|a|mx|ptr|exists|redirect)[:=]/g;

/** The SPF include that authorises a given SMTP host, when we recognise it. */
export function expectedIncludeFor(smtpHost?: string): string | undefined {
  const h = (smtpHost ?? "").toLowerCase();
  if (h.includes("google") || h.includes("gmail")) return "_spf.google.com";
  if (h.includes("outlook") || h.includes("office365")) return "spf.protection.outlook.com";
  if (h.includes("sendgrid")) return "sendgrid.net";
  if (h.includes("amazonaws")) return "amazonses.com";
  if (h.includes("resend")) return "amazonses.com";
  // Unrecognised: show what is published and let the reader judge, rather
  // than asserting an expectation we cannot justify.
  return undefined;
}

export function checkSpf(
  apexRecords: string[],
  opts: {
    /** Only meaningful for our OWN sending domain. */
    expectInclude?: string;
    /** TXT of each include: target, one level deep, so a delegated record
     *  ("include:xyz._spfm.example.com") is judged on what it resolves to. */
    includeChain?: string[];
    unreachable?: boolean;
  } = {},
): AuthCheck {
  if (opts.unreachable) {
    return {
      status: "unknown",
      detail: "Could not reach a DNS resolver, so nothing can be said either way.",
    };
  }
  const spf = apexRecords.filter((r) => r.trim().toLowerCase().startsWith("v=spf1"));

  if (spf.length === 0) {
    return {
      status: "fail",
      detail:
        "No SPF record. Receivers have no way to tell which servers may send as this domain.",
    };
  }
  // Two "correct" records are worse than one: RFC 7208 makes this a permerror,
  // so a well-meaning second record breaks the first.
  if (spf.length > 1) {
    return {
      status: "fail",
      record: spf.join("  |  "),
      detail: `${spf.length} SPF records. A domain may publish only one — receivers treat several as an error and ignore them all. Merge them.`,
    };
  }

  const record = spf[0].trim();
  const lower = record.toLowerCase();

  if (opts.expectInclude) {
    const needle = opts.expectInclude.toLowerCase();
    // Look through one level of delegation before concluding anything: an SPF
    // flattening service publishes include:xyz._spfm.example.com, which
    // resolves to the real include. String-matching the top record alone
    // reports a correct record as broken.
    const chain = (opts.includeChain ?? []).join(" ").toLowerCase();
    const authorises = lower.includes(needle) || chain.includes(needle);
    if (!authorises) {
      return {
        status: "warn",
        record,
        detail:
          (opts.includeChain?.length ?? 0) > 0
            ? `Neither this record nor the records it includes authorise ${opts.expectInclude}, so it does not cover the servers actually sending your mail.`
            : `The record does not obviously authorise ${opts.expectInclude}. It may do so through an include we could not resolve — check before changing anything.`,
      };
    }
  }

  // +all authorises the entire internet, which is worse than having no record
  // at all: it actively vouches for every spammer.
  if (/\+all\s*$/.test(lower)) {
    return {
      status: "fail",
      record,
      detail: "Ends in +all, which authorises every server on the internet to send as you.",
    };
  }
  if (/\?all\s*$/.test(lower)) {
    return {
      status: "warn",
      record,
      detail: "Ends in ?all, a neutral result — the record exists but asserts nothing.",
    };
  }
  if (/\bptr[:\s]/.test(lower)) {
    return {
      status: "warn",
      record,
      detail: "Uses the ptr mechanism, which the RFC deprecates and some receivers ignore.",
    };
  }

  const lookups = (lower.match(LOOKUP_MECHANISMS) ?? []).length;
  if (lookups > 10) {
    return {
      status: "warn",
      record,
      detail: `At least ${lookups} DNS lookups, and SPF allows 10. Receivers stop evaluating past the limit and the check fails. (Each include may add more of its own — this counts only what is in the record itself.)`,
    };
  }

  if (!/[~-]all\s*$/.test(lower)) {
    return {
      status: "warn",
      record,
      detail:
        "No all mechanism at the end, so the record leaves unlisted senders undecided.",
    };
  }

  return {
    status: "pass",
    record,
    detail:
      (lower.endsWith("-all")
        ? "Valid, and strict: anything not listed is rejected outright."
        : "Valid. Unlisted senders are marked as a soft failure, which is the usual setting.") +
      (opts.expectInclude && !lower.includes(opts.expectInclude.toLowerCase())
        ? ` Authorises ${opts.expectInclude} indirectly, through an include.`
        : ""),
  };
}

export function checkDkim(
  dkim: Record<string, string[]>,
  opts: { unreachable?: boolean; selectorKnown?: boolean } = {},
): AuthCheck & { selector?: string } {
  if (opts.unreachable) {
    return {
      status: "unknown",
      detail: "Could not reach a DNS resolver, so nothing can be said either way.",
    };
  }
  for (const [selector, records] of Object.entries(dkim)) {
    for (const raw of records) {
      const record = raw.replace(/"\s*"/g, "").trim();
      if (!/v\s*=\s*DKIM1/i.test(record) && !/p\s*=/.test(record)) continue;
      const p = /(?:^|;)\s*p\s*=\s*([^;]*)/i.exec(record)?.[1]?.trim() ?? "";
      if (!p) {
        // Worse than missing: the key is published as revoked, so signatures
        // that would otherwise verify are actively refused.
        return {
          status: "fail",
          selector,
          record,
          detail: `The key at ${selector}._domainkey has an empty p= value, which publishes it as revoked.`,
        };
      }
      // t=y tells receivers to behave as though DKIM were not deployed. It is
      // meant to be removed after testing, and routinely is not.
      if (/(?:^|;)\s*t\s*=\s*[^;]*y/i.test(record)) {
        return {
          status: "warn",
          selector,
          record: `${record.slice(0, 60)}…`,
          detail: `The key at ${selector}._domainkey is flagged t=y (testing), which tells receivers to ignore the signature. Remove that flag.`,
        };
      }
      // Only claim a key size when the length actually indicates one: a
      // 1024-bit RSA key is ~216 base64 characters and a 2048-bit key ~392.
      // Anything shorter is malformed or truncated, and guessing "1024-bit"
      // at it would be a confident answer to a question we cannot read.
      const weak = p.length >= 180 && p.length < 300;
      return {
        status: weak ? "warn" : "pass",
        selector,
        record: `${record.slice(0, 60)}…`,
        detail: weak
          ? `Signing key published at ${selector}._domainkey, but it looks like a 1024-bit key. Regenerate it at 2048.`
          : `Signing key published at ${selector}._domainkey.`,
      };
    }
  }
  return {
    status: "fail",
    detail: opts.selectorKnown
      ? "No key at the selector on file. If the sending provider changed, the selector changed with it."
      : `No DKIM key at any of ${Object.keys(dkim).length} common selector names. That does not prove DKIM is absent — only that it is not at a name worth guessing. Paste an Authentication-Results header below to settle it.`,
  };
}

export interface DmarcCheck extends AuthCheck {
  policy?: string;
  rua?: string;
}

export function checkDmarc(
  dmarcRecords: string[],
  opts: { domain?: string; unreachable?: boolean } = {},
): DmarcCheck {
  if (opts.unreachable) {
    return {
      status: "unknown",
      detail: "Could not reach a DNS resolver, so nothing can be said either way.",
    };
  }
  if (dmarcRecords.filter((r) => /^\s*v\s*=\s*DMARC1/i.test(r)).length > 1) {
    return {
      status: "fail",
      detail:
        "More than one DMARC record. Receivers must ignore all of them, so the domain behaves as if it had none while looking configured.",
    };
  }
  const rec = dmarcRecords.find((r) => /^\s*v\s*=\s*DMARC1/i.test(r));
  if (!rec) {
    return {
      status: "fail",
      detail:
        "No DMARC record. Receivers are given no instruction about mail that fails authentication, and you get no reports.",
    };
  }
  const record = rec.trim();
  const tag = (name: string) =>
    new RegExp(`(?:^|;)\\s*${name}\\s*=\\s*([^;]*)`, "i")
      .exec(record)?.[1]
      ?.trim();

  const policy = (tag("p") ?? "").toLowerCase();
  const rua = tag("rua");

  if (!policy) {
    return {
      status: "fail",
      record,
      detail: "The record has no p= policy tag, so it is invalid and ignored.",
    };
  }
  if (!rua) {
    return {
      status: "warn",
      record,
      policy,
      detail: `Policy is p=${policy}, but there is no rua= address — nothing reports back, so you cannot see what is sending as you.`,
    };
  }
  // Reports to another domain are silently discarded unless that domain
  // publishes <checked>._report._dmarc.<ruaDomain> authorising them.
  const ruaDomain = /@([^\s,>]+)/.exec(rua)?.[1]?.toLowerCase();
  const external =
    !!ruaDomain && !!opts.domain && ruaDomain !== opts.domain.toLowerCase();
  const externalNote = external
    ? ` Reports go to ${ruaDomain}, a different domain — that domain must publish ${opts.domain}._report._dmarc.${ruaDomain} or they are silently discarded.`
    : "";

  if (policy === "none") {
    return {
      status: "warn",
      record,
      policy,
      rua,
      detail:
        "Monitoring only (p=none): reports arrive but nothing is enforced. Tighten to quarantine once SPF and DKIM pass." +
        externalNote,
    };
  }
  return {
    status: "pass",
    record,
    policy,
    rua,
    detail: `Enforcing (p=${policy}), with reports going to ${rua}.` + externalNote,
  };
}

/* --------------------------------------------------------------------------
 * The records to publish
 * ----------------------------------------------------------------------- */

export interface SuggestedRecord {
  host: string;
  type: "TXT";
  value: string;
}

/** Google Workspace's include costs a single DNS lookup. */
export function buildSpfRecord(): SuggestedRecord {
  return { host: "@", type: "TXT", value: "v=spf1 include:_spf.google.com ~all" };
}

export function buildDmarcRecord(rua: string): SuggestedRecord {
  const to = rua.trim();
  return {
    host: "_dmarc",
    type: "TXT",
    value: `v=DMARC1; p=none; rua=mailto:${to}; fo=1`,
  };
}

/**
 * There is deliberately no buildDkimRecord(). The key pair is generated by
 * Google Workspace and only Google holds the private half — a record invented
 * here would look complete and authenticate nothing.
 */
export const DKIM_INSTRUCTIONS = [
  "Google Admin console → Apps → Google Workspace → Gmail",
  "Open “Authenticate email”, pick the domain, then Generate new record",
  "Publish the value Google gives you at google._domainkey",
  "Come back to Google and press Start authentication",
];

/* --------------------------------------------------------------------------
 * Ground truth, from a message that actually went
 *
 * A selector cannot be discovered from DNS — it travels in the s= tag of the
 * DKIM-Signature header. Probing common names is a guess. The BCC copy that
 * every send already puts in your own mailbox carries the real answer, so
 * pasting its headers settles what probing can only estimate.
 * ----------------------------------------------------------------------- */

export interface AuthResultsSummary {
  spf?: string;
  dkim?: string;
  dmarc?: string;
  /** The domain DKIM actually signed for — the alignment question. */
  signingDomain?: string;
  /** The selector, ready to be saved so future checks stop guessing. */
  selector?: string;
  headerFrom?: string;
  aligned?: boolean;
  notes: string[];
}

export function parseAuthResults(raw: string): AuthResultsSummary {
  const text = raw.replace(/\r/g, "");
  const verdict = (k: string) =>
    new RegExp(`\\b${k}\\s*=\\s*([a-z]+)`, "i").exec(text)?.[1]?.toLowerCase();

  const signingDomain =
    /header\.d\s*=\s*([^\s;,]+)/i.exec(text)?.[1]?.toLowerCase() ??
    /header\.i\s*=\s*@?([^\s;,]+)/i.exec(text)?.[1]?.toLowerCase();
  const selector = /DKIM-Signature[\s\S]{0,400}?\bs\s*=\s*([A-Za-z0-9._-]+)/i
    .exec(text)?.[1];
  const headerFrom = /header\.from\s*=\s*([^\s;,]+)/i
    .exec(text)?.[1]
    ?.toLowerCase();

  const notes: string[] = [];
  const dkim = verdict("dkim");
  let aligned: boolean | undefined;
  if (signingDomain && headerFrom) {
    aligned =
      signingDomain === headerFrom || signingDomain.endsWith(`.${headerFrom}`);
    if (dkim === "pass" && !aligned) {
      // The trap this control exists to expose: Google signs Workspace mail
      // with its own key when you have not published one, so Gmail reports
      // dkim=pass while DMARC still sees no aligned signature.
      notes.push(
        `DKIM passed, but it signed for ${signingDomain}, not ${headerFrom}. That is the provider's own key, so DMARC still counts this as unsigned — publishing your own DKIM record is what fixes it.`,
      );
    }
  }
  if (verdict("dmarc") === "fail") {
    notes.push("DMARC failed on this message, which is what a recipient sees.");
  }
  if (selector) {
    notes.push(`Selector in use: ${selector}. Save it so checks stop guessing.`);
  }
  if (!dkim && !verdict("spf") && !verdict("dmarc")) {
    notes.push(
      "No authentication results found in that text. Paste the Authentication-Results header, or the whole message source.",
    );
  }
  return {
    spf: verdict("spf"),
    dkim,
    dmarc: verdict("dmarc"),
    signingDomain,
    selector,
    headerFrom,
    aligned,
    notes,
  };
}

/** The worst of the three — what the send window warns about. */
export function worstStatus(checks: AuthCheck[]): AuthStatus {
  if (checks.some((c) => c.status === "fail")) return "fail";
  if (checks.some((c) => c.status === "warn")) return "warn";
  if (checks.some((c) => c.status === "unknown")) return "unknown";
  return "pass";
}

/** One sentence for the send window. Empty when there is nothing to say. */
export function authWarning(
  domain: string,
  spf: AuthCheck,
  dkim: AuthCheck,
  dmarc: AuthCheck,
): string {
  const missing: string[] = [];
  if (spf.status === "fail") missing.push("SPF");
  if (dkim.status === "fail") missing.push("DKIM");
  if (missing.length === 2) {
    return `${domain} has neither an SPF nor a DKIM record, so this message is unauthenticated and may be filtered as spam.`;
  }
  if (missing.length === 1) {
    return `${domain} has no ${missing[0]} record, which weakens delivery to strict recipients.`;
  }
  if (dmarc.status === "fail") {
    return `${domain} publishes no DMARC record. Mail should still deliver, but you have no visibility into what is sending as you.`;
  }
  // Nothing is said when the check could not run: "we could not verify your
  // DNS" on the send window is noise at the one moment it cannot be acted on.
  if (worstStatus([spf, dkim, dmarc]) === "unknown") return "";
  if (worstStatus([spf, dkim, dmarc]) === "warn") {
    return `Email authentication for ${domain} is incomplete — see Settings → Email.`;
  }
  return "";
}

export function domainOf(address: string): string {
  return (address.split("@")[1] ?? "").trim().toLowerCase();
}

/* --------------------------------------------------------------------------
 * Fetching
 *
 * Cached in memory for ten minutes, never in the database. A stored verdict
 * is a claim about DNS that DNS can invalidate without this app being
 * involved — "SPF: pass, checked three weeks ago" is a lie with a timestamp
 * on it, and the panel's whole value is being true now. The cache dies on
 * reload and cannot mislead across days.
 * ----------------------------------------------------------------------- */

import { supabase } from "./supabase";

const TTL_MS = 10 * 60 * 1000;
let cached: { at: number; key: string; records: AuthRecords } | null = null;
let inflight: Promise<AuthRecords | null> | null = null;

export function invalidateEmailAuth() {
  cached = null;
}

export async function fetchEmailAuth(opts: {
  domain?: string;
  dkimSelector?: string;
  force?: boolean;
} = {}): Promise<AuthRecords | null> {
  const key = `${opts.domain ?? ""}|${opts.dkimSelector ?? ""}`;
  if (
    !opts.force &&
    cached &&
    cached.key === key &&
    Date.now() - cached.at < TTL_MS
  ) {
    return cached.records;
  }
  if (inflight && !opts.force) return inflight;
  inflight = (async () => {
    const { data, error } = await supabase.functions.invoke("email-auth-check", {
      body: { domain: opts.domain, dkimSelector: opts.dkimSelector },
    });
    inflight = null;
    if (error) return null;
    const records = (data as { records?: AuthRecords })?.records ?? null;
    if (records) cached = { at: Date.now(), key, records };
    return records;
  })();
  return inflight;
}

/** Run all three checks over a set of records. */
export function evaluate(
  records: AuthRecords,
  opts: { knownSelector?: string } = {},
): { spf: AuthCheck; dkim: AuthCheck & { selector?: string }; dmarc: DmarcCheck } {
  // "Does this authorise our sender" is only a meaningful question about our
  // own sending domain — asking it of an ad-hoc lookup produces a warning
  // about someone else's perfectly correct record.
  const isOwn = !!records.fromDomain && records.domain === records.fromDomain;
  return {
    spf: checkSpf(records.apex, {
      unreachable: records.unreachable,
      includeChain: records.includeChain,
      expectInclude: isOwn ? expectedIncludeFor(records.smtpHost) : undefined,
    }),
    dkim: checkDkim(records.dkim, {
      unreachable: records.unreachable,
      selectorKnown: !!opts.knownSelector,
    }),
    dmarc: checkDmarc(records.dmarc, {
      domain: records.domain,
      unreachable: records.unreachable,
    }),
  };
}
