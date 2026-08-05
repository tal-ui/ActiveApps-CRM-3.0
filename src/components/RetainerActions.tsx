import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pause, Play, Wand2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { invalidateLookup } from "../lib/lookups";
import { fmtCurrency, fmtDate } from "../lib/format";
import { Button, ConfirmModal, ErrorNote } from "./ui";

/**
 * Actions on a retainer schedule. "Generate Now" calls the same
 * generate_recurring_invoice() function the hourly cron uses, so a manual run
 * and an automatic one produce identical invoices and advance the schedule
 * the same way.
 */
export default function RetainerActions({
  retainer,
  onChanged,
}: {
  retainer: Record<string, unknown>;
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const status = String(retainer.status ?? "");

  async function setStatus(next: string) {
    setBusy(true);
    setError("");
    const { error: err } = await supabase
      .from("recurring_invoices")
      .update({ status: next, updated_at: Date.now() })
      .eq("id", retainer.id as string);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    onChanged();
  }

  async function generateNow() {
    setBusy(true);
    setError("");
    const { data, error: err } = await supabase.rpc(
      "generate_recurring_invoice",
      { p_schedule_id: retainer.id as string },
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

  return (
    <>
      {error && (
        <div className="w-full order-last">
          <ErrorNote message={error} />
        </div>
      )}
      {status === "active" && (
        <>
          <Button disabled={busy} onClick={() => setConfirming(true)}>
            <Wand2 size={14} strokeWidth={1.5} />
            Generate Now
          </Button>
          <Button variant="subtle" disabled={busy} onClick={() => setStatus("paused")}>
            <Pause size={14} strokeWidth={1.5} />
            Pause
          </Button>
        </>
      )}
      {status === "paused" && (
        <Button disabled={busy} onClick={() => setStatus("active")}>
          <Play size={14} strokeWidth={1.5} />
          Resume
        </Button>
      )}

      {confirming && (
        <ConfirmModal
          title="Generate Invoice Now"
          confirmLabel="Generate"
          busy={busy}
          onConfirm={generateNow}
          onClose={() => setConfirming(false)}
        >
          <p>
            Create a draft invoice for{" "}
            {fmtCurrency(
              Number(retainer.amount ?? 0),
              String(retainer.currency ?? "ILS"),
            )}{" "}
            now, outside the normal schedule?
          </p>
          <p>
            This also advances the next invoice date past{" "}
            {fmtDate(Number(retainer.next_run_date ?? 0))}, so the scheduled run
            won't produce a duplicate.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
