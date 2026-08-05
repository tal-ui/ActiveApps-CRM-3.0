import { useCallback, useEffect, useState } from "react";
import { Banknote, Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  dateToMs,
  DEFAULT_CURRENCY,
  fmtCurrency,
  fmtDate,
  msToDateInput,
} from "../lib/format";
import {
  Button,
  ConfirmModal,
  EmptyState,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Spinner,
} from "./ui";

interface Payment {
  id: string;
  amount: number | string;
  paid_at: number;
  method: string;
  reference: string | null;
  notes: string | null;
}

const METHODS: [string, string][] = [
  ["bank_transfer", "Bank Transfer"],
  ["credit_card", "Credit Card"],
  ["check", "Check"],
  ["cash", "Cash"],
  ["paypal", "PayPal"],
  ["other", "Other"],
];

const methodLabel = (v: string) =>
  METHODS.find(([value]) => value === v)?.[1] ?? v;

/**
 * Payment ledger for one invoice. Recording a payment is the only way an
 * invoice becomes "paid" — the DB rolls amount_paid/balance up from these
 * rows and flips the status when the balance clears, so this panel never
 * writes the invoice itself.
 */
export default function InvoicePayments({
  invoice,
  onChanged,
  openSignal = 0,
}: {
  invoice: Record<string, unknown>;
  onChanged: () => void;
  /** Bumped by the parent to pop the Record Payment modal open. */
  openSignal?: number;
}) {
  const { profile } = useAuth();
  const invoiceId = String(invoice.id ?? "");
  const currency = String(invoice.currency ?? DEFAULT_CURRENCY);
  const balance = Number(invoice.balance ?? 0);

  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(msToDateInput(Date.now()));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("invoice_payments")
      .select("id, amount, paid_at, method, reference, notes")
      .eq("invoice_id", invoiceId)
      .eq("is_deleted", false)
      .order("paid_at", { ascending: false });
    if (err) setError(err.message);
    setPayments((data ?? []) as Payment[]);
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openForm = useCallback(() => {
    setError("");
    // Default to whatever is still outstanding — the common case is paying
    // the invoice off in full.
    setAmount(balance > 0 ? String(+balance.toFixed(2)) : "");
    setPaidAt(msToDateInput(Date.now()));
    setMethod("bank_transfer");
    setReference("");
    setNotes("");
    setShowForm(true);
  }, [balance]);

  // The parent's "Record Payment" button drives this through a counter.
  useEffect(() => {
    if (openSignal > 0) openForm();
    // openForm changes with the balance; only the signal should reopen it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  async function save() {
    const value = parseFloat(amount);
    if (!Number.isFinite(value) || value === 0) {
      setError("Enter a payment amount.");
      return;
    }
    setBusy(true);
    setError("");
    const now = Date.now();
    const { error: err } = await supabase.from("invoice_payments").insert({
      invoice_id: invoiceId,
      amount: value,
      paid_at: dateToMs(paidAt) ?? now,
      method,
      reference: reference.trim() || null,
      notes: notes.trim() || null,
      created_by_id: profile?.id ?? "system",
      created_at: now,
      updated_at: now,
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setShowForm(false);
    await load();
    onChanged();
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    const { error: err } = await supabase
      .from("invoice_payments")
      .update({ is_deleted: true, updated_at: Date.now() })
      .eq("id", removing.id);
    setBusy(false);
    setRemoving(null);
    if (err) {
      setError(err.message);
      return;
    }
    await load();
    onChanged();
  }

  const total = Number(invoice.total_amount ?? 0);
  const paid = Number(invoice.amount_paid ?? 0);
  const pct = total > 0 ? Math.min(100, (paid / total) * 100) : 0;

  return (
    <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2.5">
          <Banknote size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Payments
          </h3>
        </div>
        <Button variant="subtle" onClick={openForm}>
          <Plus size={14} strokeWidth={2} />
          Record Payment
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {/* Collected vs outstanding */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-1.5">
          <span className="label-mono">
            {fmtCurrency(paid, currency)} of {fmtCurrency(total, currency)}
          </span>
          <span
            className={`font-[var(--font-mono)] text-xs ${
              balance > 0 ? "text-[#D9B96A]" : "text-[var(--mint)]"
            }`}
          >
            {balance > 0 ? `${fmtCurrency(balance, currency)} due` : "settled"}
          </span>
        </div>
        <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full bg-[var(--mint)] transition-all duration-700"
            style={{ width: `${Math.max(pct > 0 ? 2 : 0, pct)}%` }}
          />
        </div>
      </div>

      {payments === null ? (
        <Spinner />
      ) : payments.length === 0 ? (
        <EmptyState message="No payments recorded yet." />
      ) : (
        <div className="rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.06)] overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--section-darker)]">
                {["Date", "Method", "Reference", "Amount", ""].map((h, i) => (
                  <th
                    key={h || i}
                    className={`px-3 py-2 label-mono ${i === 3 ? "text-right" : "text-left"}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-t border-[rgba(255,255,255,0.04)]">
                  <td className="px-3 py-2 text-sm text-[var(--text-mid)]">
                    {fmtDate(p.paid_at)}
                  </td>
                  <td className="px-3 py-2 text-sm text-[var(--text-mid)]">
                    {methodLabel(p.method)}
                  </td>
                  <td className="px-3 py-2 text-sm text-[var(--text-faint)]">
                    {p.reference || "—"}
                  </td>
                  <td className="px-3 py-2 text-sm text-right font-[var(--font-mono)] text-[var(--foreground)]">
                    {fmtCurrency(Number(p.amount ?? 0), currency)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setRemoving(p)}
                      className="text-[var(--text-faint)] hover:text-[#F2697A] transition-colors cursor-pointer"
                      aria-label="Remove payment"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal title="Record Payment" onClose={() => setShowForm(false)}>
          <div className="space-y-4">
            {error && <ErrorNote message={error} />}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <FieldLabel required>Amount</FieldLabel>
                <Input
                  type="number"
                  step="any"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  autoFocus
                />
                {balance > 0 && (
                  <p className="text-xs text-[var(--text-faint)] mt-1.5">
                    {fmtCurrency(balance, currency)} outstanding
                  </p>
                )}
              </div>
              <div>
                <FieldLabel required>Date Received</FieldLabel>
                <Input
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
              <div>
                <FieldLabel required>Method</FieldLabel>
                <Select value={method} onChange={(e) => setMethod(e.target.value)}>
                  {METHODS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel>Reference</FieldLabel>
                <Input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="Transfer ID, check #…"
                />
              </div>
            </div>
            <div>
              <FieldLabel>Notes</FieldLabel>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <p className="text-xs text-[var(--text-faint)]">
              The invoice status follows the balance: it flips to Paid on its
              own once the full amount is received.
            </p>
            <div className="flex justify-end gap-3 pt-1">
              <Button variant="subtle" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button onClick={save} disabled={busy}>
                {busy ? "Saving…" : "Record Payment"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {removing && (
        <ConfirmModal
          title="Remove Payment"
          confirmLabel="Remove"
          destructive
          busy={busy}
          onConfirm={remove}
          onClose={() => setRemoving(null)}
        >
          <p>
            Remove the {fmtCurrency(Number(removing.amount ?? 0), currency)}{" "}
            payment from {fmtDate(removing.paid_at)}? The invoice balance and
            status will be recalculated.
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}
