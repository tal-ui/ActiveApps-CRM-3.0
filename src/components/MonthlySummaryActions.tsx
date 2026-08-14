import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FileDown, Mail, Receipt } from "lucide-react";
import { supabase } from "../lib/supabase";
import { invalidateLookup } from "../lib/lookups";
import { useAuth, type Profile } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { loadSummaryEmailContext } from "../lib/summaryEmail";
import { Button, ConfirmModal, ErrorNote } from "./ui";
import SummaryEmailModal from "./SummaryEmailModal";

/**
 * File an exported breakdown against the summary that produced it.
 *
 * The storage path and file name are derived from the month, so re-exporting
 * replaces the previous export rather than piling up near-identical PDFs — and
 * a file the user uploaded by hand, under any other name, is never matched.
 *
 * Returns an error message, or null. The caller has already saved the PDF
 * locally: filing is a side effect, and a Storage failure must not cost anyone
 * their download.
 */
async function fileExport(
  summaryId: string,
  filename: string,
  blob: Blob,
  profile: Profile | null,
): Promise<string | null> {
  const path = `monthly_summaries/${summaryId}/${filename}`;
  const { error: upErr } = await supabase.storage
    .from("attachments")
    .upload(path, blob, { contentType: "application/pdf", upsert: true });
  if (upErr) return upErr.message;

  const { data: prior } = await supabase
    .from("attachments")
    .select("id")
    .eq("entity_type", "monthly_summaries")
    .eq("entity_id", summaryId)
    .eq("file_name", filename);

  const { data: inserted, error: insErr } = await supabase
    .from("attachments")
    .insert({
      entity_type: "monthly_summaries",
      entity_id: summaryId,
      file_name: filename,
      storage_path: path,
      mime_type: "application/pdf",
      size_bytes: blob.size,
      uploaded_by_id: profile?.id ?? "system",
      uploaded_by_email: profile?.email ?? null,
      created_at: Date.now(),
    })
    .select("id")
    .single();
  if (insErr) {
    // Only ours to clean up when no earlier export already occupied this path.
    if (!prior?.length) {
      await supabase.storage.from("attachments").remove([path]);
    }
    return insErr.message;
  }

  // Old rows go last, and by row only: they share the path with the file just
  // written, so removing the object would delete the new export too.
  const priorIds = (prior ?? []).map((r) => (r as { id: string }).id);
  if (priorIds.length > 0) {
    await supabase.from("attachments").delete().in("id", priorIds);
  }
  void insertAudit(profile, {
    action: "upload",
    entity_type: "attachment",
    entity_id: (inserted as { id: string } | null)?.id ?? null,
    summary: `Exported ${filename} to monthly_summaries/${summaryId}`,
  });
  return null;
}

/**
 * The two things you do with a monthly summary once the hours are in: bill it,
 * then send the client the paperwork.
 *
 * The billing half calls the same generate_invoice_from_summary() the Financial
 * dashboard uses, so a manual run and a dashboard run produce identical
 * invoices. The summary is the billing unit: one invoice covers the month's
 * billable hours across every project they belong to.
 */
export default function MonthlySummaryActions({
  summary,
  onChanged,
}: {
  summary: Record<string, unknown>;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [invoice, setInvoice] = useState<{
    id: string;
    invoice_number: string;
    external_doc_number: string | null;
  } | null>(null);

  const summaryId = String(summary.id ?? "");
  const status = String(summary.status ?? "");
  const alreadyInvoiced = status === "invoiced" || status === "paid";
  const emailedAt = summary.emailed_at ? Number(summary.emailed_at) : null;

  useEffect(() => {
    if (!summaryId) return;
    supabase
      .from("invoices")
      .select("id, invoice_number, external_doc_number")
      .eq("monthly_summary_id", summaryId)
      .eq("is_deleted", false)
      .maybeSingle()
      .then(({ data }) => {
        setInvoice(
          data as {
            id: string;
            invoice_number: string;
            external_doc_number: string | null;
          } | null,
        );
      });
  }, [summaryId, status]);

  async function generate() {
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc(
      "generate_invoice_from_summary",
      { p_summary_id: summaryId },
    );
    setBusy(false);
    setConfirming(false);
    if (err) {
      setError(err.message);
      return;
    }
    invalidateLookup("invoices");
    onChanged();
    if (data) navigate(`/invoices/${String(data)}`);
  }

  /**
   * The same breakdown the client is emailed, and the same one Time Tracking
   * exports — one renderer, so the three can't drift.
   */
  async function exportPdf() {
    setExporting(true);
    setError("");
    try {
      const { context, error: ctxErr } = await loadSummaryEmailContext(summaryId);
      if (ctxErr || !context) {
        setError(ctxErr ?? "Could not load this summary.");
        return;
      }
      // Loaded on demand: a static import drags jsPDF into the main bundle.
      const { buildMonthlyReport, monthlyReportFilename } = await import(
        "../lib/pdf"
      );
      // Built once and used twice — rendering a second time for the attachment
      // would lay the whole document out again and refetch the logo.
      const doc = await buildMonthlyReport({
        monthLabel: context.monthLabel,
        projectFilter: context.reportSubtitle,
        entries: context.entries,
      });
      const filename = monthlyReportFilename(context.monthLabel);
      doc.save(filename);
      const filingError = await fileExport(
        summaryId,
        filename,
        doc.output("blob"),
        profile,
      );
      if (filingError) {
        setError(
          `The PDF downloaded, but filing it against this summary failed: ${filingError}`,
        );
        return;
      }
      onChanged();
    } catch (e) {
      setError(`Could not build the breakdown: ${(e as Error)?.message}`);
    } finally {
      setExporting(false);
    }
  }

  const issued = !!invoice?.external_doc_number;

  return (
    <>
      {error && (
        <div className="w-full order-last">
          <ErrorNote message={error} />
        </div>
      )}

      <Button variant="ghost" disabled={exporting} onClick={exportPdf}>
        <FileDown size={14} strokeWidth={1.5} />
        {exporting ? "Exporting…" : "Export PDF"}
      </Button>

      {!alreadyInvoiced && (
        <Button disabled={busy} onClick={() => setConfirming(true)}>
          <Receipt size={14} strokeWidth={1.5} />
          Generate Invoice
        </Button>
      )}

      {/* Rendered disabled rather than hidden when the tax document is still
          missing: an invisible control reads as a missing feature, and the
          reason is the thing worth saying. */}
      {invoice && (
        <Button
          variant={issued ? "subtle" : "ghost"}
          disabled={busy || !issued}
          title={
            issued
              ? undefined
              : `Issue the tax invoice on ${invoice.invoice_number} first — the email quotes its number.`
          }
          onClick={() => setEmailing(true)}
        >
          <Mail size={14} strokeWidth={1.5} />
          {emailedAt ? "Resend to Client" : "Send to Client"}
        </Button>
      )}

      {emailedAt && (
        <span className="label-mono self-center">
          emailed {new Date(emailedAt).toLocaleDateString()}
        </span>
      )}

      {confirming && (
        <ConfirmModal
          title="Generate Invoice"
          confirmLabel="Generate"
          busy={busy}
          onConfirm={generate}
          onClose={() => setConfirming(false)}
        >
          <p>
            Create a draft invoice for this month's billable hours, across
            every project they belong to.
          </p>
          <p>
            Those time entries are marked billed and this summary moves to
            Invoiced, so it can't be billed twice.
          </p>
        </ConfirmModal>
      )}

      {emailing && (
        <SummaryEmailModal
          summaryId={summaryId}
          onClose={() => setEmailing(false)}
          onSent={() => {
            void insertAudit(profile, {
              action: "email_sent",
              entity_type: "monthly_summary",
              entity_id: summaryId,
              summary: `Emailed tax invoice ${invoice?.external_doc_number ?? ""} for ${String(summary.name ?? "")}`,
            });
            onChanged();
          }}
        />
      )}
    </>
  );
}
