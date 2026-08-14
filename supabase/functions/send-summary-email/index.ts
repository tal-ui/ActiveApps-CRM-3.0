// send-summary-email — emails a client the month's paperwork: the hours
// breakdown the CRM renders, and the legal tax document Green Invoice issued.
//
// Deploy with verify_jwt = true. Beyond that this function checks the caller is
// an admin: issuing a document to yourself is one thing, mailing a client on
// the company's behalf is another.
//
// The subject and body arrive already rendered from the browser, so what the
// sender read in the modal is exactly what the client receives — there is no
// second rendering that could disagree.
//
// The Gmail app password lives only here, in integrations.config (key =
// "email_smtp"). The browser writes it and never reads it back.
import { createClient } from "npm:@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@^9";

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

const API_BASE = "https://api.greeninvoice.co.il/api/v1";
/** Gmail refuses anything past 25 MB, and does it opaquely. Stop earlier. */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

type Row = Record<string, unknown>;

function truncate(s: unknown, n: number): string {
  const v = String(s ?? "");
  return v.length > n ? v.slice(0, n) : v;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanAddresses(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [
    ...new Set(
      v.map((a) => str(a).trim()).filter((a) => a && EMAIL_RE.test(a)),
    ),
  ];
}

interface SendRequest {
  /** Verify the SMTP credentials. Sends nothing unless testTo is given. */
  test?: boolean;
  testTo?: string;
  /** Do everything except hand the message to Gmail. */
  dryRun?: boolean;
  /** Diagnostic: report the shape of existing Green Invoice documents. */
  probe?: boolean;
  summaryId?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  hoursPdfBase64?: string;
  hoursPdfFilename?: string;
  /** Escape hatch: a tax PDF downloaded by hand from the provider's web UI. */
  taxPdfBase64?: string;
  /**
   * Rehearsal only. Attaches the watermarked preview document instead of the
   * legal one, and is refused for any recipient outside the issuer's domain.
   */
  usePreviewDocument?: boolean;
}

interface SmtpConfig {
  username: string;
  app_password: string;
  from_name: string;
  from_address: string;
  reply_to: string;
  default_bcc: string;
}

/* ---------------------------------------------------------------------------
 * Credentials
 * ------------------------------------------------------------------------- */

async function getSmtpConfig(): Promise<SmtpConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("connected, config")
    .eq("key", "email_smtp")
    .maybeSingle();
  if (!data || data.connected !== true) return null;
  const cfg = (data.config ?? {}) as Row;
  const username = str(cfg.username).trim();
  const password = str(cfg.app_password);
  if (!username || !password) return null;
  const from = str(cfg.from_address).trim() || username;
  return {
    username,
    app_password: password,
    from_name: str(cfg.from_name).trim(),
    from_address: from,
    reply_to: str(cfg.reply_to).trim() || from,
    default_bcc: str(cfg.default_bcc).trim(),
  };
}

async function getGreenInvoiceToken(): Promise<string> {
  const { data } = await supabase
    .from("integrations")
    .select("connected, config")
    .eq("key", "green_invoice")
    .maybeSingle();
  if (!data || data.connected !== true) return "";
  const cfg = (data.config ?? {}) as Row;
  const id = str(cfg.api_key_id);
  const secret = str(cfg.api_secret);
  if (!id || !secret) return "";
  try {
    const res = await fetch(`${API_BASE}/account/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, secret }),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as Row;
    return str(body.token ?? body.jwt);
  } catch {
    return "";
  }
}

/* ---------------------------------------------------------------------------
 * Retrieving the issued document's PDF
 *
 * The client's email carries the legal document itself, so we need its bytes,
 * not a link. Which endpoint yields them is genuinely unknown: the vendor's
 * reference is not machine-readable and no document has ever been issued
 * through this integration. So every plausible shape is tried in turn and each
 * attempt is reported, because the log is what makes the first real failure
 * diagnosable in one pass.
 * ------------------------------------------------------------------------- */

/**
 * An HTML login or error page served with 200 OK is the realistic failure
 * mode. Emailing that to a client named "Tax-Invoice-12345.pdf" is far worse
 * than failing, so nothing is trusted until it actually looks like a PDF.
 */
function looksLikePdf(bytes: Uint8Array): boolean {
  if (bytes.length < 1024) return false;
  return (
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function documentUrl(doc: Row): string {
  const url = doc.url as Row | string | null | undefined;
  if (typeof url === "string") return url;
  const u = (url ?? null) as Row | null;
  return str(u?.origin ?? u?.he ?? u?.en ?? doc.urlOrigin ?? doc.docUrl ?? "");
}

/** A fetchable link out of a download-links response, flat or wrapped. */
function linkFrom(doc: Row | null): string {
  if (!doc) return "";
  const links = (doc.links ?? doc) as Row;
  return str(links.origin ?? links.he ?? links.en ?? "") || documentUrl(doc);
}

async function giGet(token: string, path: string): Promise<Row | null> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as Row;
  } catch {
    return null;
  }
}

async function getPdfFromUrl(
  url: string,
  attempts: string[],
  label: string,
): Promise<Uint8Array | null> {
  try {
    // No Authorization header — these are signed links, and sending a bearer
    // token to a redirect target would leak it.
    const res = await fetch(url);
    if (!res.ok) {
      attempts.push(`${label} -> HTTP ${res.status}`);
      return null;
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!looksLikePdf(bytes)) {
      attempts.push(
        `${label} -> ${bytes.length}B of ${res.headers.get("content-type") ?? "unknown"}, not a PDF`,
      );
      return null;
    }
    attempts.push(`${label} -> ok (${bytes.length}B)`);
    return bytes;
  } catch (e) {
    attempts.push(`${label} -> ${truncate((e as Error)?.message, 120)}`);
    return null;
  }
}

/**
 * Recover the provider's document id from its number. issue-invoice guesses
 * the id lives at `doc.id`; if the real response nests it, external_doc_id
 * lands null and both id-based strategies are dead on arrival. This is the way
 * back, and it costs one call.
 */
async function findDocumentId(token: string, number: string): Promise<string> {
  try {
    const res = await fetch(`${API_BASE}/documents/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ pageSize: 10, page: 1, number }),
    });
    if (!res.ok) return "";
    const body = (await res.json()) as Row;
    const items = (body.items ?? body.data ?? []) as Row[];
    const hit = items.find((d) => String(d.number ?? "") === number);
    return str(hit?.id ?? items[0]?.id ?? "");
  } catch {
    return "";
  }
}

interface PdfResult {
  bytes?: Uint8Array;
  source?: string;
  attempts: string[];
}

async function fetchTaxPdf(token: string, invoice: Row): Promise<PdfResult> {
  const attempts: string[] = [];
  const number = str(invoice.external_doc_number);
  let id = str(invoice.external_doc_id);

  // 0. Already captured. A legal document never changes, so once we hold it a
  //    re-send never depends on the provider being reachable.
  const cached = str(invoice.doc_pdf_path);
  if (cached) {
    const { data } = await supabase.storage.from("attachments").download(cached);
    if (data) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      if (looksLikePdf(bytes)) {
        attempts.push("storage cache -> ok");
        return { bytes, source: "cached", attempts };
      }
    }
    attempts.push("storage cache -> miss");
  }

  if (!token) {
    attempts.push("green invoice not connected");
    return { attempts };
  }

  if (!id && number) {
    id = await findDocumentId(token, number);
    attempts.push(
      id ? `documents/search -> id ${id}` : "documents/search -> no match",
    );
  }

  if (id) {
    const links = await giGet(token, `/documents/${id}/download/links`);
    const linkUrl = linkFrom(links);
    if (linkUrl) {
      const bytes = await getPdfFromUrl(linkUrl, attempts, "download/links");
      if (bytes) return { bytes, source: "download_links", attempts };
    } else {
      attempts.push("download/links -> no url in response");
    }

    const doc = await giGet(token, `/documents/${id}`);
    const url = documentUrl(doc ?? {});
    if (url) {
      const bytes = await getPdfFromUrl(url, attempts, "GET /documents/{id}");
      if (bytes) return { bytes, source: "document_url", attempts };
    } else {
      attempts.push("GET /documents/{id} -> no url in response");
    }
  } else {
    attempts.push("no document id - id strategies skipped");
  }

  const stored = str(invoice.external_doc_url);
  if (stored) {
    const bytes = await getPdfFromUrl(stored, attempts, "external_doc_url");
    if (bytes) return { bytes, source: "stored_url", attempts };
  }

  // The raw issue response may already hold the PDF the way preview does.
  // Costs no network call, and it is the one strategy that cannot be defeated
  // by a wrong guess about endpoints.
  const raw = (invoice.provider_response ?? {}) as Row;
  for (const key of ["file", "pdf", "document"]) {
    const b64 = str(raw[key]);
    if (b64.length > 1000) {
      try {
        const bytes = base64ToBytes(b64);
        if (looksLikePdf(bytes)) {
          attempts.push(`provider_response.${key} -> ok (${bytes.length}B)`);
          return { bytes, source: `provider_response.${key}`, attempts };
        }
      } catch {
        /* not base64 */
      }
    }
  }
  attempts.push("provider_response -> no embedded PDF");

  return { attempts };
}

async function cacheTaxPdf(
  invoiceId: string,
  number: string,
  bytes: Uint8Array,
): Promise<void> {
  const safe = (number || "tax-document").replace(/[^\w.-]+/g, "_");
  const path = `invoices/${invoiceId}/${safe}.pdf`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (error) return;
  await supabase
    .from("invoices")
    .update({ doc_pdf_path: path, doc_pdf_fetched_at: Date.now() })
    .eq("id", invoiceId);
}

/* ---------------------------------------------------------------------------
 * Transport
 * ------------------------------------------------------------------------- */

interface Attachment {
  filename: string;
  content: string; // base64
  bytes: number;
  source: string;
}

function makeTransport(cfg: SmtpConfig) {
  // Built per invocation and closed in a finally: edge isolates are reused,
  // and a hoisted transport surfaces its dead socket as a baffling ECONNRESET
  // on the second send only.
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true, // 465 is implicit TLS
    auth: { user: cfg.username, pass: cfg.app_password },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  });
}

function isAuthFailure(message: string): boolean {
  return /535|534|5\.7\.8|5\.7\.9|invalid login|username and password/i.test(
    message,
  );
}

/* ---------------------------------------------------------------------------
 * Handler
 * ------------------------------------------------------------------------- */

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = (await req.json()) as SendRequest;

    // Mailing a client is more consequential than issuing a document to
    // yourself, so this function checks the role rather than trusting any
    // authenticated session.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    const { data: userData } = await supabase.auth.getUser(jwt);
    const userId = userData?.user?.id ?? "";
    if (!userId) return json(401, { error: "unauthorized" });
    // profiles.id is the CRM's own id, NOT the auth user id — the two differ,
    // and auth_user_id is the join. Matching on id would 403 everybody.
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role, email, full_name")
      .eq("auth_user_id", userId)
      .maybeSingle();
    const role = str((profile as Row | null)?.role);
    if (role !== "admin") return json(403, { error: "forbidden" });
    const actorEmail = str((profile as Row | null)?.email);
    const actorId = str((profile as Row | null)?.id);

    // Diagnostic: what do this account's existing Green Invoice documents
    // look like? Verifies the retrieval strategies without issuing anything.
    // Key names and link shapes only — never document contents.
    //
    // Deliberately ahead of the SMTP check: this asks the provider a question
    // and sends no mail, so it must work before an app password exists.
    if (body.probe === true) {
      const token = await getGreenInvoiceToken();
      if (!token) return json(400, { error: "not_configured" });
      const res = await fetch(`${API_BASE}/documents/search`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ pageSize: 5, page: 1 }),
      });
      if (!res.ok) {
        return json(502, {
          error: "probe_failed",
          detail: truncate(await res.text(), 800),
        });
      }
      const found = (await res.json()) as Row;
      const items = ((found.items ?? found.data ?? []) as Row[]).slice(0, 3);
      const report: Row[] = [];
      for (const item of items) {
        const id = str(item.id);
        const links = id
          ? await giGet(token, `/documents/${id}/download/links`)
          : null;
        const full = id ? await giGet(token, `/documents/${id}`) : null;
        const linkUrl = linkFrom(links);
        let linkFetch: string | null = null;
        if (linkUrl) {
          const probeAttempts: string[] = [];
          await getPdfFromUrl(linkUrl, probeAttempts, "link");
          linkFetch = probeAttempts[0] ?? null;
        }
        report.push({
          searchKeys: Object.keys(item).sort(),
          id,
          number: str(item.number ?? item.docNumber ?? ""),
          type: item.type ?? null,
          downloadLinksKeys: links ? Object.keys(links).sort() : null,
          downloadLinksUrl: truncate(linkUrl, 100) || null,
          linkFetch,
          documentKeys: full ? Object.keys(full).sort() : null,
          documentUrl: truncate(documentUrl(full ?? {}), 100) || null,
        });
      }
      return json(200, {
        ok: true,
        probe: true,
        searchResponseKeys: Object.keys(found).sort(),
        total: found.total ?? null,
        documents: report,
      });
    }

    // Nullable on purpose: a dry run resolves attachments and sends nothing,
    // so it has to work before an app password exists — otherwise the modal
    // cannot tell you whether the documents are retrievable until you have
    // already set up Gmail.
    const cfg = await getSmtpConfig();

    // Credential check. With no testTo this performs EHLO + AUTH + QUIT and
    // sends nothing at all.
    if (body.test === true) {
      if (!cfg) return json(400, { error: "smtp_not_configured" });
      const transport = makeTransport(cfg);
      try {
        await transport.verify();
        const testTo = str(body.testTo).trim();
        if (!testTo) return json(200, { ok: true, verified: true });
        // A test message may only go to the sender themselves or their own
        // domain — never to a client, however the caller phrases it.
        const domain = cfg.from_address.split("@")[1] ?? "";
        const allowed =
          testTo === actorEmail ||
          testTo === cfg.from_address ||
          (!!domain && testTo.endsWith(`@${domain}`));
        if (!EMAIL_RE.test(testTo) || !allowed) {
          return json(422, {
            error: "test_recipient_refused",
            detail:
              "A test message can only be sent to your own address or your own domain.",
          });
        }
        const info = await transport.sendMail({
          from: `"${cfg.from_name || cfg.username}" <${cfg.from_address}>`,
          to: [testTo],
          replyTo: cfg.reply_to,
          subject: "ActiveApps CRM — email test",
          text:
            "This is a test message from ActiveApps CRM.\n\n" +
            "If you are reading it, the Gmail app password works and client " +
            "invoice emails will send from this address.",
        });
        return json(200, {
          ok: true,
          verified: true,
          sentTo: testTo,
          messageId: str((info as Row).messageId),
        });
      } catch (e) {
        const detail = truncate((e as Error)?.message ?? String(e), 500);
        if (isAuthFailure(detail)) return json(401, { error: "smtp_invalid_key" });
        return json(502, { error: "smtp_failed", detail });
      } finally {
        transport.close();
      }
    }

    /* ---- a real send ---- */

    const summaryId = str(body.summaryId);
    const subject = str(body.subject).trim();
    const emailBody = str(body.body);
    if (!summaryId || !subject || !emailBody) {
      return json(400, { error: "bad_request" });
    }

    const to = cleanAddresses(body.to);
    const cc = cleanAddresses(body.cc);
    const bcc = cleanAddresses(body.bcc);
    if (cfg?.default_bcc && !bcc.includes(cfg.default_bcc)) {
      // Gmail does not file SMTP submissions in Sent, so this copy is both the
      // archive and the human-checkable proof the message really went.
      bcc.push(cfg.default_bcc);
    }
    if (to.length === 0) return json(422, { error: "no_recipients" });

    const { data: summary } = await supabase
      .from("monthly_summaries")
      .select("id, name, account_id")
      .eq("id", summaryId)
      .maybeSingle();
    if (!summary) return json(404, { error: "not_found" });

    const { data: invoice } = await supabase
      .from("invoices")
      .select(
        "id, invoice_number, external_doc_id, external_doc_number, external_doc_url, doc_pdf_path, provider_response",
      )
      .eq("monthly_summary_id", summaryId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (!invoice) return json(404, { error: "not_found" });

    const inv = invoice as Row;
    const docNumber = str(inv.external_doc_number);
    const previewMode = body.usePreviewDocument === true;
    if (!docNumber && !previewMode && !body.taxPdfBase64) {
      return json(409, { error: "not_issued" });
    }

    const attachments: Attachment[] = [];
    const attemptLog: string[] = [];

    const hoursB64 = str(body.hoursPdfBase64);
    if (hoursB64) {
      attachments.push({
        filename: str(body.hoursPdfFilename) || "Monthly-Hours.pdf",
        content: hoursB64,
        bytes: Math.floor((hoursB64.length * 3) / 4),
        source: "crm",
      });
    }

    // The tax document, in order of trustworthiness.
    const manual = str(body.taxPdfBase64);
    if (manual) {
      const bytes = base64ToBytes(manual);
      if (!looksLikePdf(bytes)) {
        return json(422, {
          error: "bad_attachment",
          detail: "The uploaded file is not a PDF.",
        });
      }
      attachments.push({
        filename: `Tax-Invoice-${docNumber || "document"}.pdf`,
        content: manual,
        bytes: bytes.length,
        source: "manual_upload",
      });
    } else if (previewMode) {
      // Rehearsal path: the watermarked preview stands in for the legal
      // document so the two-attachment shape can be exercised end to end.
      // Hard-gated to the issuer's own domain — this must never reach a client.
      const domain = cfg?.from_address.split("@")[1] ?? "";
      const outside = [...to, ...cc].filter(
        (a) => a !== actorEmail && !(domain && a.endsWith(`@${domain}`)),
      );
      if (outside.length > 0) {
        return json(422, {
          error: "preview_recipient_refused",
          detail: `A watermarked preview document may only be sent to your own domain. Refused: ${outside.join(", ")}`,
        });
      }
      // Delegated to issue-invoice rather than rebuilt here: buildDocumentPayload
      // is the single place that knows how to describe a document, and a second
      // copy would make previewing prove nothing.
      const fn = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/issue-invoice`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: authHeader,
          },
          body: JSON.stringify({ preview: true, invoiceId: inv.id }),
        },
      );
      if (!fn.ok) {
        return json(502, {
          error: "tax_pdf_unavailable",
          detail: truncate(await fn.text(), 500),
        });
      }
      const previewBody = (await fn.json()) as Row;
      const b64 = str(previewBody.pdfBase64);
      if (!b64) {
        return json(502, {
          error: "tax_pdf_unavailable",
          detail: "The preview returned no document.",
        });
      }
      attachments.push({
        filename: `PREVIEW-Tax-Invoice-${str(inv.invoice_number)}.pdf`,
        content: b64,
        bytes: Math.floor((b64.length * 3) / 4),
        source: "preview",
      });
    } else {
      const token = await getGreenInvoiceToken();
      const found = await fetchTaxPdf(token, inv);
      attemptLog.push(...found.attempts);
      if (!found.bytes) {
        return json(502, {
          error: "tax_pdf_unavailable",
          detail: found.attempts.join("; "),
        });
      }
      if (found.source !== "cached") {
        await cacheTaxPdf(str(inv.id), docNumber, found.bytes);
      }
      attachments.push({
        filename: `Tax-Invoice-${docNumber}.pdf`,
        content: bytesToBase64(found.bytes),
        bytes: found.bytes.length,
        source: str(found.source),
      });
    }

    const totalBytes = attachments.reduce((s, a) => s + a.bytes, 0);
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      return json(413, {
        error: "too_large",
        detail: `${(totalBytes / 1024 / 1024).toFixed(1)} MB of attachments; the limit is 15 MB.`,
      });
    }

    const manifest = attachments.map((a) => ({
      name: a.filename,
      bytes: a.bytes,
      source: a.source,
    }));

    if (body.dryRun === true) {
      // Everything except transport — this is what lets the modal prove both
      // attachments resolve before it enables Send.
      return json(200, {
        ok: true,
        dryRun: true,
        smtpConfigured: !!cfg,
        to,
        cc,
        bcc,
        attachments: manifest,
        attempts: attemptLog,
      });
    }

    if (!cfg) return json(400, { error: "smtp_not_configured" });
    const transport = makeTransport(cfg);
    let messageId = "";
    let sendError = "";
    try {
      const info = await transport.sendMail({
        from: `"${cfg.from_name || cfg.username}" <${cfg.from_address}>`,
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        replyTo: cfg.reply_to,
        subject,
        // Plain text only. The template is plain text; an HTML alternative is
        // a second thing that can disagree with the first.
        text: emailBody,
        attachments: attachments.map((a) => ({
          filename: a.filename,
          content: a.content,
          encoding: "base64",
          contentType: "application/pdf",
        })),
      });
      messageId = str((info as Row).messageId);
    } catch (e) {
      sendError = truncate((e as Error)?.message ?? String(e), 500);
    } finally {
      transport.close();
    }

    // Logged on both outcomes, with the service role, so a browser that dies
    // mid-request still leaves the record. A failed row carrying the retrieval
    // log is what makes the unverified provider path debuggable in production.
    const { data: logRow } = await supabase
      .from("email_log")
      .insert({
        entity_type: "monthly_summary",
        entity_id: summaryId,
        invoice_id: str(inv.id),
        account_id: str((summary as Row).account_id),
        to_addresses: to,
        cc_addresses: cc,
        bcc_addresses: bcc,
        subject,
        body: emailBody,
        attachments: manifest.map((a) => a.name),
        attachment_meta: manifest,
        status: sendError ? "failed" : "sent",
        error: sendError
          ? [sendError, ...attemptLog].join(" | ")
          : null,
        provider_message_id: messageId || null,
        sent_by_id: actorId || userId,
        sent_by_email: actorEmail || null,
        sent_at: Date.now(),
      })
      .select("id")
      .single();

    if (sendError) {
      if (isAuthFailure(sendError)) {
        return json(401, { error: "smtp_invalid_key", detail: sendError });
      }
      return json(502, { error: "smtp_failed", detail: sendError });
    }

    await supabase
      .from("monthly_summaries")
      .update({ emailed_at: Date.now(), updated_at: Date.now() })
      .eq("id", summaryId);

    return json(200, {
      ok: true,
      messageId,
      logId: str((logRow as Row | null)?.id),
      to,
      cc,
      bcc,
      attachments: manifest,
    });
  } catch (e) {
    return json(500, {
      error: "unexpected",
      detail: truncate((e as Error)?.message ?? String(e), 500),
    });
  }
});
