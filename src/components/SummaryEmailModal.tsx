import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Mail, Paperclip, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { describeFunctionError } from "../lib/functionError";
import { fmtCurrency, fmtHours } from "../lib/format";
import { useWorkspaceSettings } from "../lib/workspaceSettings";
import {
  buildTemplateVars,
  missingPlaceholders,
  renderTemplate,
} from "../lib/emailTemplate";
import {
  loadSummaryEmailContext,
  type SummaryEmailContext,
} from "../lib/summaryEmail";
import { authWarning, evaluate, fetchEmailAuth } from "../lib/emailAuth";
import {
  Button,
  ConfirmModal,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Spinner,
  Textarea,
} from "./ui";

interface AttachmentInfo {
  name: string;
  bytes: number;
  source: string;
}

function fmtBytes(n: number): string {
  return n > 1024 * 1024
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-xs text-[#D9B96A]">
      <AlertTriangle size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * Sends a client the month's invoice email: the hours breakdown and the legal
 * tax document, with the template filled in and editable.
 *
 * Nothing is enabled until a dry run has proved both attachments actually
 * resolve. Gating on "the invoice has a document number" would only prove a
 * number exists — the bytes are a separate question, and finding that out
 * after composing an email to a paying client is the wrong time.
 */
export default function SummaryEmailModal({
  summaryId,
  onClose,
  onSent,
}: {
  summaryId: string;
  onClose: () => void;
  onSent: () => void;
}) {
  const settings = useWorkspaceSettings();

  const [ctx, setCtx] = useState<SummaryEmailContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");

  const [hoursPdf, setHoursPdf] = useState<{ b64: string; name: string } | null>(
    null,
  );
  const [manualTaxPdf, setManualTaxPdf] = useState<string>("");
  const [attachments, setAttachments] = useState<AttachmentInfo[] | null>(null);
  const [resolveError, setResolveError] = useState("");
  const [checking, setChecking] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [authNote, setAuthNote] = useState("");

  const invoice = ctx?.invoice ?? null;
  const issued = !!invoice?.external_doc_number;

  /* ---- load, render the PDF, fill the template ---- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { context, error: err } = await loadSummaryEmailContext(summaryId);
      if (cancelled) return;
      if (err || !context) {
        setError(err ?? "Could not load this summary.");
        setLoading(false);
        return;
      }
      setCtx(context);
      setTo(context.account.email ?? context.contacts[0]?.email ?? "");
      setLoading(false);

      // Built here rather than server-side: the renderer is jsPDF in the
      // browser, and building it here guarantees the attached file is the same
      // one Export PDF produces.
      try {
        // Loaded on demand, like every other caller: a static import would
        // drag jsPDF and autotable into the main bundle.
        const { monthlyReportFilename, renderMonthlyReportBase64 } =
          await import("../lib/pdf");
        const b64 = await renderMonthlyReportBase64({
          monthLabel: context.monthLabel,
          projectFilter: context.reportSubtitle,
          entries: context.entries,
        });
        if (!cancelled) {
          setHoursPdf({ b64, name: monthlyReportFilename(context.monthLabel) });
        }
      } catch (e) {
        if (!cancelled) {
          setResolveError(
            `Could not build the hours breakdown: ${(e as Error)?.message}`,
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [summaryId]);

  // Fired in parallel with everything else and never awaited by anything.
  // Deliberately not folded into the dryRun call, which gates Send: hanging
  // the send button on a DNS round trip to produce a warning that never blocks
  // would be exactly backwards. A module cache makes reopens free.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const records = await fetchEmailAuth();
      if (cancelled || !records) return;
      const { spf, dkim, dmarc } = evaluate(records);
      setAuthNote(authWarning(records.domain, spf, dkim, dmarc));
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const vars = useMemo(() => {
    if (!ctx) return null;
    return buildTemplateVars(ctx, {
      name: settings.emailSenderName,
      phone: settings.emailSenderPhone,
      email: settings.emailSenderEmail,
    }, settings);
  }, [ctx, settings]);

  useEffect(() => {
    if (!vars) return;
    setSubject(renderTemplate(settings.emailSubjectTemplate, vars));
    setBody(renderTemplate(settings.emailBodyTemplate, vars));
  }, [vars, settings.emailSubjectTemplate, settings.emailBodyTemplate]);

  // Checked against the TEMPLATES, not the rendered text: rendering has
  // already replaced {{sender_name}} with "", so scanning the output finds
  // nothing and the guard silently never fires. That is how a subject reading
  // "Invoice # 50033 -  - June 2026" got through the first time.
  const blanks = useMemo(() => {
    if (!vars) return [];
    return [
      ...new Set([
        ...missingPlaceholders(settings.emailSubjectTemplate, vars),
        ...missingPlaceholders(settings.emailBodyTemplate, vars),
      ]),
    ];
  }, [vars, settings.emailSubjectTemplate, settings.emailBodyTemplate]);

  /* ---- prove both attachments resolve before enabling Send ---- */
  useEffect(() => {
    if (!ctx || !hoursPdf || (!issued && !manualTaxPdf)) return;
    let cancelled = false;
    setChecking(true);
    setResolveError("");
    (async () => {
      const { data, error: err } = await supabase.functions.invoke(
        "send-summary-email",
        {
          body: {
            dryRun: true,
            summaryId,
            to: splitAddresses(to),
            cc: splitAddresses(cc),
            subject: subject || "(pending)",
            body: body || "(pending)",
            hoursPdfBase64: hoursPdf.b64,
            hoursPdfFilename: hoursPdf.name,
            ...(manualTaxPdf ? { taxPdfBase64: manualTaxPdf } : {}),
          },
        },
      );
      if (cancelled) return;
      setChecking(false);
      if (err) {
        setResolveError(await describeFunctionError(err));
        setAttachments(null);
        return;
      }
      setAttachments(
        ((data as { attachments?: AttachmentInfo[] })?.attachments ?? []),
      );
    })();
    return () => {
      cancelled = true;
    };
    // Recipients and copy do not change what resolves, so the dry run is not
    // re-fired while someone is typing an address.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, hoursPdf, issued, manualTaxPdf, summaryId]);

  async function send() {
    if (!ctx || !hoursPdf) return;
    setSending(true);
    setError("");
    setNote("");
    const { error: err } = await supabase.functions.invoke(
      "send-summary-email",
      {
        body: {
          summaryId,
          to: splitAddresses(to),
          cc: splitAddresses(cc),
          subject,
          body,
          hoursPdfBase64: hoursPdf.b64,
          hoursPdfFilename: hoursPdf.name,
          ...(manualTaxPdf ? { taxPdfBase64: manualTaxPdf } : {}),
        },
      },
    );
    setSending(false);
    setConfirming(false);
    if (err) {
      setError(await describeFunctionError(err));
      return;
    }
    onSent();
    onClose();
  }

  const recipients = splitAddresses(to);
  const canSend =
    !!ctx &&
    !!hoursPdf &&
    recipients.length > 0 &&
    !!attachments &&
    attachments.length >= 2 &&
    blanks.length === 0 &&
    !checking &&
    !sending;

  const previousSend = ctx?.lastSend ?? null;

  return (
    <>
      <Modal
        title="Send to Client"
        // Closing mid-send would leave a half-finished email with no feedback.
        onClose={sending ? () => {} : onClose}
        wide
      >
        {loading ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            {error && <ErrorNote message={error} />}
            {note && <p className="text-sm text-[var(--mint)]">{note}</p>}

            {/* Figures come from the invoice and are not editable: an editable
                money field is an invitation to contradict the tax document. */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Fact label="Tax Invoice #" value={vars?.doc_number || "—"} />
              <Fact
                label="Amount + VAT"
                value={
                  invoice
                    ? `${vars?.amount_net} + ${invoice.tax_rate}%`
                    : "—"
                }
              />
              <Fact
                label="Total incl. VAT"
                value={
                  invoice
                    ? fmtCurrency(invoice.total_amount, invoice.currency)
                    : "—"
                }
              />
              <Fact
                label="Hours"
                value={ctx ? fmtHours(ctx.billableHours) : "—"}
              />
            </div>

            {!issued && !manualTaxPdf && (
              <div className="rounded-[var(--radius-md)] border border-[rgba(217,185,106,0.3)] bg-[rgba(217,185,106,0.06)] p-3 space-y-2">
                <Warning>
                  This invoice has no tax document yet, and the subject line
                  quotes its number. Issue it from the invoice first — or attach
                  a PDF you downloaded from Green Invoice yourself.
                </Warning>
                {invoice && (
                  <a
                    className="text-xs text-[var(--mint)] underline"
                    href={`/invoices/${invoice.id}`}
                  >
                    Open invoice {invoice.invoice_number}
                  </a>
                )}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel required>To</FieldLabel>
                <Input
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  placeholder="billing@client.com"
                />
                {ctx && ctx.contacts.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {ctx.contacts.map((c) => (
                      <button
                        key={c.email}
                        type="button"
                        onClick={() =>
                          setTo((v) =>
                            splitAddresses(v).includes(c.email)
                              ? v
                              : [...splitAddresses(v), c.email].join(", "),
                          )
                        }
                        className="text-xs px-2 py-1 rounded-full border border-[rgba(255,255,255,0.1)] text-[var(--text-mid)] hover:text-[var(--mint)]"
                      >
                        + {c.name || c.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <FieldLabel>Cc</FieldLabel>
                <Input
                  value={cc}
                  onChange={(e) => setCc(e.target.value)}
                  placeholder="optional, comma separated"
                />
              </div>
            </div>

            <div>
              <FieldLabel required>Subject</FieldLabel>
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </div>
            <div>
              <FieldLabel required>Message</FieldLabel>
              <Textarea
                rows={14}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-[var(--font-mono)] text-xs"
              />
            </div>

            {/* Attachments */}
            <div className="rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.06)] p-4 space-y-2">
              <p className="label-mono flex items-center gap-2">
                <Paperclip size={12} strokeWidth={2} />
                Attachments
              </p>
              {checking && (
                <p className="text-xs text-[var(--text-faint)]">
                  Checking both documents…
                </p>
              )}
              {attachments?.map((a) => (
                <p key={a.name} className="text-sm text-[var(--text-light)]">
                  {a.name}{" "}
                  <span className="text-xs text-[var(--text-faint)]">
                    {fmtBytes(a.bytes)} · {a.source.replace(/_/g, " ")}
                  </span>
                </p>
              ))}
              {resolveError && (
                <div className="space-y-2">
                  <ErrorNote message={resolveError} />
                  <label className="inline-flex items-center gap-2 text-xs text-[var(--mint)] cursor-pointer">
                    <Upload size={13} strokeWidth={2} />
                    Attach the tax invoice PDF yourself
                    <input
                      type="file"
                      accept="application/pdf"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        const buf = new Uint8Array(await file.arrayBuffer());
                        let binary = "";
                        const CHUNK = 0x8000;
                        for (let i = 0; i < buf.length; i += CHUNK) {
                          binary += String.fromCharCode(
                            ...buf.subarray(i, i + CHUNK),
                          );
                        }
                        setManualTaxPdf(btoa(binary));
                      }}
                    />
                  </label>
                </div>
              )}
            </div>

            {/* Everything worth knowing before this leaves. */}
            {ctx && (
              <div className="space-y-1.5">
                {ctx.unbilledBillableCount > 0 && (
                  <Warning>
                    {ctx.unbilledBillableCount} billable{" "}
                    {ctx.unbilledBillableCount === 1 ? "entry is" : "entries are"}{" "}
                    on this summary but not on the invoice — they appear in the
                    breakdown and are <em>not</em> in the amount.
                  </Warning>
                )}
                {ctx.outOfMonthCount > 0 && (
                  <Warning>
                    {ctx.outOfMonthCount}{" "}
                    {ctx.outOfMonthCount === 1 ? "entry is" : "entries are"}{" "}
                    dated outside {ctx.monthLabel}, while the billing period
                    line quotes the calendar month.
                  </Warning>
                )}
                {!ctx.reportSubtitle && (
                  <Warning>
                    This account's name is in Hebrew, which the PDF engine
                    cannot render — the breakdown will show the month alone. Set
                    a Latin short name on the account to fix it.
                  </Warning>
                )}
                {blanks.length > 0 && (
                  <Warning>
                    Nothing to fill {blanks.map((b) => `{{${b}}}`).join(", ")}{" "}
                    with, so the message would go out with a gap in it. Fill
                    these in on Settings → Email; sending is blocked until then.
                  </Warning>
                )}
                {authNote && (
                  <Warning>
                    {authNote}{" "}
                    <a
                      href="/settings/email"
                      className="underline"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Settings → Email
                    </a>
                  </Warning>
                )}
                {previousSend && (
                  <Warning>
                    Already emailed on{" "}
                    {new Date(previousSend.sent_at).toLocaleDateString()} to{" "}
                    {previousSend.to_addresses.join(", ")}.
                  </Warning>
                )}
              </div>
            )}

            <div className="flex justify-end gap-3 pt-1">
              <Button variant="subtle" onClick={onClose} disabled={sending}>
                Cancel
              </Button>
              <Button
                onClick={() => (previousSend ? setConfirming(true) : send())}
                disabled={!canSend}
              >
                <Mail size={15} strokeWidth={1.5} />
                {sending
                  ? "Sending…"
                  : recipients.length === 1
                    ? `Send to ${recipients[0]}`
                    : `Send to ${recipients.length} recipients`}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Only on a re-send. A confirm on every send just trains people to
          click through it. */}
      {confirming && (
        <ConfirmModal
          title="Send this again?"
          confirmLabel="Send again"
          busy={sending}
          onConfirm={send}
          onClose={() => setConfirming(false)}
        >
          <p>
            {ctx?.account.name} was already emailed this month's invoice on{" "}
            {previousSend
              ? new Date(previousSend.sent_at).toLocaleDateString()
              : ""}
            .
          </p>
          <p>
            This sends {subject} to {recipients.join(", ")} again, with both
            documents attached.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] rounded-[var(--radius-md)] p-3">
      <p className="label-mono mb-1">{label}</p>
      <p className="font-[var(--font-mono)] text-sm text-[var(--foreground)]">
        {value}
      </p>
    </div>
  );
}

function splitAddresses(v: string): string[] {
  return v
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
