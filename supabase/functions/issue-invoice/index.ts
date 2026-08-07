// issue-invoice — hands a CRM invoice to Green Invoice (חשבונית ירוקה) so it
// comes back as a legally issued Israeli tax document with a real document
// number and, where the law requires one, an allocation number (מספר הקצאה).
//
// Deploy with verify_jwt = true — browser calls via supabase.functions.invoke
// carry the user's JWT, so only signed-in users can reach this function.
// No external call is ever made unless an admin has stored credentials in the
// integrations table (key = "green_invoice"). The API secret lives only here;
// the browser writes it and never reads it back.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// CORS — required so the browser app can call this function via
// supabase.functions.invoke. The browser sends an OPTIONS preflight first;
// without these headers + an OPTIONS handler the browser blocks the call.
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

const API_BASE = "https://api.greeninvoice.co.il/api/v1";

/**
 * Green Invoice document types.
 *   305 — חשבונית מס (tax invoice)
 *   320 — חשבונית מס קבלה (tax invoice + receipt, for money already received)
 *   400 — קבלה (receipt)
 *   405 — חשבון עסקה / חשבונית for an עוסק פטור, who may not issue a 305
 */
const DOC_TAX_INVOICE = 305;
const DOC_TAX_INVOICE_RECEIPT = 320;
const DOC_EXEMPT_INVOICE = 405;

/**
 * Green Invoice vatType: 0 means the price we send is taxable and VAT is added
 * on top; 1 means the line is exempt.
 *
 * Established by preview, not by the docs. With these values swapped, both
 * test invoices failed with error 2422 ("receipts total doesn't match payments
 * total") in opposite directions: an 18% invoice marked exempt totalled its
 * ex-VAT subtotal against a VAT-inclusive receipt, and a 0% invoice marked
 * taxable had 18% added to a receipt that had none.
 */
const VAT_TAXABLE = 0;
const VAT_EXEMPT = 1;

interface IssueRequest {
  invoiceId?: string;
  test?: boolean;
  /** Validate the document against the API without issuing anything. */
  preview?: boolean;
}

interface Credentials {
  id: string;
  secret: string;
}

type Row = Record<string, unknown>;

function truncate(s: unknown, n: number): string {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) : str;
}

function num(v: unknown): number {
  return Number(v ?? 0) || 0;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

// Returns the stored Green Invoice credentials, or null when the row is
// missing, disconnected, or incomplete. Callers must never contact the
// provider when this returns null.
async function getCredentials(): Promise<Credentials | null> {
  const { data } = await supabase
    .from("integrations")
    .select("connected, config")
    .eq("key", "green_invoice")
    .maybeSingle();
  if (!data || data.connected !== true) return null;
  const cfg = (data.config ?? {}) as {
    api_key_id?: unknown;
    api_secret?: unknown;
  };
  const id = cfg.api_key_id;
  const secret = cfg.api_secret;
  if (typeof id !== "string" || !id) return null;
  if (typeof secret !== "string" || !secret) return null;
  return { id, secret };
}

/**
 * Exchange the API key pair for a JWT. Tokens are short-lived (~30 minutes),
 * so this runs per invocation rather than being cached — issuing an invoice is
 * rare enough that the extra round trip costs nothing.
 *
 * Returns the token, or the upstream Response when the exchange failed so the
 * caller can map the status onto our error envelope.
 */
async function getToken(
  creds: Credentials,
): Promise<{ token: string } | { failure: Response }> {
  const res = await fetch(`${API_BASE}/account/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: creds.id, secret: creds.secret }),
  });
  if (!res.ok) return { failure: res };
  const body = (await res.json()) as { token?: unknown; jwt?: unknown };
  const token = body.token ?? body.jwt;
  if (typeof token !== "string" || !token) {
    return {
      failure: new Response("token missing from provider response", {
        status: 502,
      }),
    };
  }
  return { token };
}

async function workspaceIssuer(): Promise<Row> {
  const { data } = await supabase
    .from("workspace_settings")
    .select("settings")
    .limit(1)
    .maybeSingle();
  return ((data as { settings?: Row } | null)?.settings ?? {}) as Row;
}

/**
 * Which document to ask for. An עוסק פטור may not issue a tax invoice at all;
 * for everyone else, an invoice whose money has already arrived is issued as a
 * combined tax invoice + receipt, which is what the client actually needs.
 */
function documentType(businessType: string, fullyPaid: boolean): number {
  if (businessType === "osek_patur") return DOC_EXEMPT_INVOICE;
  return fullyPaid ? DOC_TAX_INVOICE_RECEIPT : DOC_TAX_INVOICE;
}

/**
 * Green Invoice wants ISO 3166-1 alpha-2 country codes, but CRM accounts hold
 * whatever was typed into the Country field ("Israel", "USA"). Translate the
 * common spellings and return null for anything unrecognised.
 *
 * Guessing is not an option here: marking an export client as Israeli would
 * put 18% VAT on an invoice that should be zero-rated, so an unknown value has
 * to stop the document rather than be quietly defaulted.
 */
const COUNTRY_CODES: Record<string, string> = {
  israel: "IL", "ישראל": "IL",
  usa: "US", "u.s.a.": "US", "united states": "US",
  "united states of america": "US", america: "US",
  uk: "GB", "united kingdom": "GB", england: "GB", "great britain": "GB",
  germany: "DE", deutschland: "DE", france: "FR", spain: "ES", italy: "IT",
  netherlands: "NL", holland: "NL", belgium: "BE", austria: "AT",
  switzerland: "CH", ireland: "IE", portugal: "PT", greece: "GR",
  cyprus: "CY", poland: "PL", romania: "RO", bulgaria: "BG", hungary: "HU",
  czechia: "CZ", "czech republic": "CZ", ukraine: "UA", turkey: "TR",
  sweden: "SE", norway: "NO", denmark: "DK", finland: "FI", estonia: "EE",
  canada: "CA", mexico: "MX", brazil: "BR", argentina: "AR",
  australia: "AU", "new zealand": "NZ", india: "IN", japan: "JP",
  china: "CN", "hong kong": "HK", singapore: "SG", "south korea": "KR",
  "south africa": "ZA", uae: "AE", "united arab emirates": "AE",
};

function countryCode(raw: unknown): string | null {
  const v = str(raw).trim();
  // No country recorded: the issuer is Israeli, so IL is the safe reading.
  if (!v) return "IL";
  if (/^[A-Za-z]{2}$/.test(v)) return v.toUpperCase();
  return COUNTRY_CODES[v.toLowerCase()] ?? null;
}

/**
 * Pull a document *link* out of a response.
 *
 * Deliberately does not fall back to `file`: the preview endpoint returns the
 * whole PDF base64-encoded under that key, and storing 100KB of blob in
 * external_doc_url would be worse than storing nothing.
 */
function documentUrl(doc: Row): string {
  const url = doc.url as Row | string | null | undefined;
  if (typeof url === "string") return url;
  return str(
    (url as Row | null)?.origin ??
      (url as Row | null)?.he ??
      (url as Row | null)?.en ??
      doc.urlOrigin ??
      doc.docUrl ??
      "",
  );
}

/**
 * Map the provider's response onto our columns.
 *
 * The exact field names are not pinned down: Green Invoice's published API
 * reference is not machine-readable, so this reads every shape the field has
 * been seen under and keeps the raw response in provider_response. The first
 * real issuance settles the question, and correcting this is a one-line change
 * — the document itself is never lost, because the raw JSON is stored.
 */
function mapDocument(doc: Row): {
  external_doc_id: string | null;
  external_doc_number: string | null;
  external_doc_url: string | null;
  allocation_number: string | null;
} {
  const resolvedUrl = documentUrl(doc);
  const number = doc.number ?? doc.docNumber ?? doc.documentNumber;
  const allocation =
    doc.allocationNumber ?? doc.allocation_num ?? doc.confirmationNumber;
  return {
    external_doc_id: str(doc.id) || null,
    external_doc_number: number == null ? null : String(number),
    external_doc_url: resolvedUrl || null,
    allocation_number: allocation == null ? null : String(allocation),
  };
}

/**
 * Load an invoice and turn it into the Green Invoice document payload.
 *
 * Preview and issue both go through here, and that is deliberate: a preview
 * only proves something if it sends byte-identical JSON to what issuing would
 * send. Two separately-built payloads would make previewing meaningless.
 */
async function buildDocumentPayload(
  invoiceId: string,
): Promise<{ payload: Row } | { failure: Response }> {
  const { data: invoice } = await supabase
    .from("invoices")
    .select(
      "id, invoice_number, account_id, status, currency, subtotal, tax_rate, total_amount, amount_paid, balance, paid_date, notes, external_doc_number",
    )
    .eq("id", invoiceId)
    .maybeSingle();
  if (!invoice) return { failure: json(404, { error: "not_found" }) };

  // Issuing twice would create a second legal document for one debt.
  if (invoice.external_doc_number) {
    return {
      failure: json(409, {
        error: "already_issued",
        detail: `Invoice ${invoice.invoice_number} was already issued as ${invoice.external_doc_number}.`,
      }),
    };
  }

  const [{ data: lines }, { data: account }, settings] = await Promise.all([
    supabase
      .from("invoice_line_items")
      .select("description, quantity, unit_price, total_price")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true }),
    supabase
      .from("accounts")
      .select("name, legal_name, tax_id, email, phone, address, city, country")
      .eq("id", str(invoice.account_id))
      .maybeSingle(),
    workspaceIssuer(),
  ]);

  if (!lines || lines.length === 0) {
    return {
      failure: json(422, {
        error: "no_lines",
        detail: "An invoice needs at least one line item before it can be issued.",
      }),
    };
  }

  const acc = (account ?? {}) as Row;
  const country = countryCode(acc.country);
  if (!country) {
    return {
      failure: json(422, {
        error: "bad_country",
        detail:
          `The account "${str(acc.name)}" has Country set to "${str(acc.country)}", ` +
          `which Green Invoice doesn't recognise. Use a two-letter country code ` +
          `(IL, US, GB…) on the account and try again.`,
      }),
    };
  }

  const taxRate = num(invoice.tax_rate);
  const fullyPaid = num(invoice.balance) <= 0 && num(invoice.amount_paid) > 0;
  const currency = str(invoice.currency) || "ILS";

  // Receipt date, YYYY-MM-DD. Green Invoice rejects an empty or future date
  // (error 2426), so fall back to today and never send tomorrow — a clock
  // skew between us and them must not fail a document.
  const paymentDate = new Date(
    Math.min(num(invoice.paid_date) || Date.now(), Date.now()),
  )
    .toISOString()
    .slice(0, 10);

  return {
    payload: {
      type: documentType(str(settings.issuerBusinessType), fullyPaid),
      lang: "he",
      currency,
      // Amounts are already exact; let the provider echo them rather than
      // re-rounding the total.
      rounding: false,
      // Line prices exclude VAT — the CRM's subtotal is the ex-VAT figure and
      // the provider adds VAT itself, so the totals agree on both sides.
      vatType: taxRate > 0 ? VAT_TAXABLE : VAT_EXEMPT,
      description: str(invoice.invoice_number),
      ...(str(invoice.notes) ? { remarks: str(invoice.notes) } : {}),
      // Only send client keys we actually have. An empty string is a value as
      // far as the API is concerned, and a blank taxId or address gets
      // validated and rejected rather than treated as "not supplied".
      client: {
        name: str(acc.legal_name) || str(acc.name),
        country,
        add: true,
        ...(str(acc.tax_id) ? { taxId: str(acc.tax_id) } : {}),
        ...(acc.email ? { emails: [str(acc.email)] } : {}),
        ...(str(acc.phone) ? { phone: str(acc.phone) } : {}),
        ...(str(acc.address) ? { address: str(acc.address) } : {}),
        ...(str(acc.city) ? { city: str(acc.city) } : {}),
      },
      income: (lines as Row[]).map((l) => ({
        description: str(l.description),
        quantity: num(l.quantity),
        price: num(l.unit_price),
        currency,
        vatType: taxRate > 0 ? VAT_TAXABLE : VAT_EXEMPT,
      })),
      // A combined tax-invoice-receipt has to state how the money arrived.
      // The amount key is `price`, matching the income lines — sending
      // `amount` made Green Invoice read the receipt as zero and reject it
      // with error 2434.
      ...(fullyPaid
        ? {
            payment: [
              {
                type: 4, // other / bank transfer
                price: num(invoice.amount_paid),
                currency,
                date: paymentDate,
              },
            ],
          }
        : {}),
    },
  };
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight — must return before any body parsing.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let invoiceId = "";
  // Tracked for the catch below: a preview must leave the invoice untouched
  // even when something throws unexpectedly.
  let isPreview = false;
  try {
    const body = (await req.json()) as IssueRequest;
    isPreview = body.preview === true;

    // Invariant: never contact Green Invoice without stored, connected creds.
    const creds = await getCredentials();
    if (!creds) return json(400, { error: "not_configured" });

    const tokenResult = await getToken(creds);
    if ("failure" in tokenResult) {
      const res = tokenResult.failure;
      if (res.status === 401 || res.status === 403) {
        return json(401, { error: "invalid_key" });
      }
      return json(502, {
        error: "upstream",
        detail: truncate(await res.text(), 500),
      });
    }
    const token = tokenResult.token;

    // The Test button only proves the credentials work — it issues nothing.
    if (body.test === true) return json(200, { ok: true });

    if (typeof body.invoiceId !== "string" || !body.invoiceId) {
      return json(400, { error: "bad_request" });
    }
    invoiceId = body.invoiceId;

    const built = await buildDocumentPayload(invoiceId);
    if ("failure" in built) return built.failure;
    const { payload } = built;

    // Preview validates the exact same document against the API without
    // allocating anything, so nothing here may touch the invoice row.
    if (body.preview === true) {
      const res = await fetch(`${API_BASE}/documents/preview`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // The provider names the offending field — pass it straight through,
        // that diagnosis is the whole point of previewing.
        const detail = truncate(await res.text(), 800);
        if (res.status === 401 || res.status === 403) {
          return json(401, { error: "invalid_key" });
        }
        return json(422, { error: "preview_rejected", detail });
      }
      // Verified against the live API: the preview response is exactly
      // { file: "<base64 PDF>" } — no link, no document number, and the
      // rendered page is watermarked "for illustration only".
      const doc = (await res.json()) as Row;
      return json(200, {
        ok: true,
        preview: true,
        documentType: payload.type,
        pdfBase64: str(doc.file) || null,
        url: documentUrl(doc) || null,
      });
    }

    const res = await fetch(`${API_BASE}/documents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = truncate(await res.text(), 500);
      // Record why it failed so the invoice itself carries the diagnosis.
      await supabase
        .from("invoices")
        .update({ issue_error: detail, updated_at: Date.now() })
        .eq("id", invoiceId);
      if (res.status === 401 || res.status === 403) {
        return json(401, { error: "invalid_key" });
      }
      return json(502, { error: "upstream", detail });
    }

    const doc = (await res.json()) as Row;
    const mapped = mapDocument(doc);

    const { error: updateError } = await supabase
      .from("invoices")
      .update({
        ...mapped,
        provider_response: doc,
        issued_at: Date.now(),
        issue_error: null,
        updated_at: Date.now(),
      })
      .eq("id", invoiceId);
    if (updateError) {
      // The document exists at the provider even though we failed to record
      // it — say so loudly rather than letting it look like a clean failure.
      return json(500, {
        error: "issued_but_not_saved",
        detail: `Green Invoice issued document ${mapped.external_doc_number ?? "(number unknown)"} but the CRM could not store it: ${updateError.message}`,
        document: mapped,
      });
    }

    return json(200, { ok: true, ...mapped });
  } catch (e) {
    const detail = truncate((e as Error)?.message ?? String(e), 500);
    if (invoiceId && !isPreview) {
      await supabase
        .from("invoices")
        .update({ issue_error: detail, updated_at: Date.now() })
        .eq("id", invoiceId);
    }
    return json(500, { error: "unexpected", detail });
  }
});
