import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Mail, Receipt } from "lucide-react";
import { supabase } from "../lib/supabase";
import { invalidateLookup } from "../lib/lookups";
import { useAuth } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { Button, ConfirmModal, ErrorNote } from "./ui";
import SummaryEmailModal from "./SummaryEmailModal";

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

  const issued = !!invoice?.external_doc_number;

  return (
    <>
      {error && (
        <div className="w-full order-last">
          <ErrorNote message={error} />
        </div>
      )}

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
