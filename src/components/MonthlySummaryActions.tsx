import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Receipt } from "lucide-react";
import { supabase } from "../lib/supabase";
import { invalidateLookup } from "../lib/lookups";
import { Button, ConfirmModal, ErrorNote } from "./ui";

/**
 * "Generate Invoice" on a monthly summary. Calls the same
 * generate_invoice_from_summary() the Financial dashboard uses, so a manual
 * run and a dashboard run produce identical invoices.
 *
 * The summary is the billing unit: one invoice covers the month's billable
 * hours across every project they belong to.
 */
export default function MonthlySummaryActions({
  summary,
  onChanged,
}: {
  summary: Record<string, unknown>;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const status = String(summary.status ?? "");
  const alreadyInvoiced = status === "invoiced" || status === "paid";

  async function generate() {
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc(
      "generate_invoice_from_summary",
      { p_summary_id: summary.id as string },
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

  if (alreadyInvoiced) return null;

  return (
    <>
      {error && (
        <div className="w-full order-last">
          <ErrorNote message={error} />
        </div>
      )}
      <Button disabled={busy} onClick={() => setConfirming(true)}>
        <Receipt size={14} strokeWidth={1.5} />
        Generate Invoice
      </Button>

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
    </>
  );
}
