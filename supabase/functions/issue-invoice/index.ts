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

interface IssueRequest {
  invoiceId?: string;
  test?: boolean;
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
  const url = doc.url as Row | string | null | undefined;
  const resolvedUrl =
    typeof url === "string"
      ? url
      : str(
          (url as Row | null)?.origin ??
            (url as Row | null)?.he ??
            (url as Row | null)?.en ??
            doc.urlOrigin ??
            doc.docUrl ??
            "",
        );
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

Deno.serve(async (req: Request) => {
  // Handle CORS preflight — must return before any body parsing.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let invoiceId = "";
  try {
    const body = (await req.json()) as IssueRequest;

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

    const { data: invoice } = await supabase
      .from("invoices")
      .select(
        "id, invoice_number, account_id, status, currency, subtotal, tax_rate, total_amount, amount_paid, balance, notes, external_doc_number",
      )
      .eq("id", invoiceId)
      .maybeSingle();
    if (!invoice) return json(404, { error: "not_found" });

    // Issuing twice would create a second legal document for one debt.
    if (invoice.external_doc_number) {
      return json(409, {
        error: "already_issued",
        detail: `Invoice ${invoice.invoice_number} was already issued as ${invoice.external_doc_number}.`,
      });
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
      return json(422, {
        error: "no_lines",
        detail: "An invoice needs at least one line item before it can be issued.",
      });
    }

    const acc = (account ?? {}) as Row;
    const taxRate = num(invoice.tax_rate);
    const fullyPaid = num(invoice.balance) <= 0 && num(invoice.amount_paid) > 0;

    const payload = {
      type: documentType(str(settings.issuerBusinessType), fullyPaid),
      lang: "he",
      currency: str(invoice.currency) || "ILS",
      // Amounts are already exact; let the provider echo them rather than
      // re-rounding the total.
      rounding: false,
      // Prices we send exclude VAT; the provider adds it at the given rate.
      vatType: taxRate > 0 ? 1 : 0,
      description: `${str(invoice.invoice_number)}`,
      remarks: str(invoice.notes),
      client: {
        name: str(acc.legal_name) || str(acc.name),
        taxId: str(acc.tax_id),
        emails: acc.email ? [str(acc.email)] : [],
        phone: str(acc.phone),
        address: str(acc.address),
        city: str(acc.city),
        country: str(acc.country) || "IL",
        add: true,
      },
      income: (lines as Row[]).map((l) => ({
        description: str(l.description),
        quantity: num(l.quantity),
        price: num(l.unit_price),
        currency: str(invoice.currency) || "ILS",
        vatType: taxRate > 0 ? 1 : 0,
      })),
      // A combined tax-invoice-receipt has to state how the money arrived.
      ...(fullyPaid
        ? {
            payment: [
              {
                type: 4, // other / bank transfer
                amount: num(invoice.amount_paid),
                currency: str(invoice.currency) || "ILS",
              },
            ],
          }
        : {}),
    };

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
    if (invoiceId) {
      await supabase
        .from("invoices")
        .update({ issue_error: detail, updated_at: Date.now() })
        .eq("id", invoiceId);
    }
    return json(500, { error: "unexpected", detail });
  }
});
