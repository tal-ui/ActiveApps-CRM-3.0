import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { invalidateLookup, useLookupMaps } from "../lib/lookups";
import { nextQuoteNumber } from "../lib/docNumber";
import {
  DEFAULT_CURRENCY,
  dateToMs,
  fmtCurrency,
  msToDateInput,
} from "../lib/format";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Spinner,
  Textarea,
} from "./ui";

interface OppLine {
  service_id: string | null;
  description: string | null;
  quantity: number | string | null;
  unit_price: number | string | null;
  total_price: number | string | null;
}

export default function QuoteCreateModal({
  opportunity,
  onClose,
  onCreated,
}: {
  opportunity: Record<string, unknown>;
  onClose: () => void;
  onCreated: (quoteId: string) => void;
}) {
  const { profile } = useAuth();
  const maps = useLookupMaps(["services"]);
  const currency = String(opportunity.currency ?? "") || DEFAULT_CURRENCY;
  const [validUntil, setValidUntil] = useState(
    msToDateInput(Date.now() + 30 * 86400000),
  );
  const [taxRate, setTaxRate] = useState("0");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<OppLine[] | null>(null);

  useEffect(() => {
    supabase
      .from("opportunity_line_items")
      .select("*")
      .eq("opportunity_id", opportunity.id as string)
      .then(({ data }) => setLines((data ?? []) as OppLine[]));
  }, [opportunity.id]);

  // Proposed quote lines: the opportunity's line items, or a single line from
  // the opportunity itself when it has none.
  const proposed = useMemo(() => {
    if (!lines) return null;
    if (lines.length === 0) {
      const amount = Number(opportunity.amount ?? 0);
      return [
        {
          service_id: null as string | null,
          description: String(opportunity.name ?? "Service"),
          quantity: 1,
          unit_price: amount,
          total_price: amount,
        },
      ];
    }
    return lines.map((l) => {
      const quantity = Number(l.quantity ?? 1);
      const unitPrice = Number(l.unit_price ?? 0);
      return {
        service_id: l.service_id ?? null,
        description:
          l.description ??
          (l.service_id ? maps.services?.[l.service_id] : undefined) ??
          "Service",
        quantity,
        unit_price: unitPrice,
        total_price:
          l.total_price != null
            ? Number(l.total_price)
            : +(quantity * unitPrice).toFixed(2),
      };
    });
  }, [lines, maps, opportunity]);

  const totals = useMemo(() => {
    const subtotal = +(proposed ?? [])
      .reduce((s, l) => s + Number(l.total_price ?? 0), 0)
      .toFixed(2);
    const rate = parseFloat(taxRate) || 0;
    const taxAmount = +((subtotal * rate) / 100).toFixed(2);
    return { subtotal, rate, taxAmount, total: +(subtotal + taxAmount).toFixed(2) };
  }, [proposed, taxRate]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || !proposed) return;
    setBusy(true);
    setError("");
    const now = Date.now();
    const me = profile?.id ?? "system";
    const quoteNumber = await nextQuoteNumber();

    const { data: quote, error: qErr } = await supabase
      .from("quotes")
      .insert({
        quote_number: quoteNumber,
        account_id: opportunity.account_id,
        opportunity_id: opportunity.id,
        status: "draft",
        valid_until: dateToMs(validUntil),
        subtotal: totals.subtotal,
        tax_rate: totals.rate,
        tax_amount: totals.taxAmount,
        total_amount: totals.total,
        currency,
        notes: notes.trim() || null,
        owner_id: me,
        created_by_id: me,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (qErr || !quote) {
      setBusy(false);
      setError(qErr?.message ?? "Failed to create quote.");
      return;
    }
    const quoteId = (quote as { id: string }).id;

    for (const line of proposed) {
      // quote_line_items has no updated_at column in the schema
      const { error: liErr } = await supabase.from("quote_line_items").insert({
        quote_id: quoteId,
        service_id: line.service_id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        total_price: line.total_price,
        created_at: now,
      });
      if (liErr) {
        setBusy(false);
        setError(`Quote created but a line item failed: ${liErr.message}`);
        return;
      }
    }

    await insertAudit(profile, {
      action: "convert",
      entity_type: "quote",
      entity_id: quoteId,
      summary: `Created quote ${quoteNumber} from opportunity ${String(opportunity.name ?? "")}`,
    });
    invalidateLookup("quotes");
    setBusy(false);
    onCreated(quoteId);
  }

  return (
    <Modal title="Create Quote" onClose={onClose} wide>
      <p className="text-sm text-[var(--text-mid)] mb-5">
        Creates a <span className="text-[var(--mint)]">Quote</span> from this
        opportunity, carrying over the account and line items.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Valid Until</FieldLabel>
            <Input
              type="date"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Tax Rate (%)</FieldLabel>
            <Input
              type="number"
              step="any"
              value={taxRate}
              onChange={(e) => setTaxRate(e.target.value)}
              placeholder="17"
            />
          </div>
        </div>

        {!proposed ? (
          <Spinner />
        ) : (
          <>
            <div className="rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.06)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--section-darker)]">
                    {["Line Item", "Qty", "Unit Price", "Amount"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left label-mono">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {proposed.map((l, i) => (
                    <tr key={i} className="border-t border-[rgba(255,255,255,0.04)]">
                      <td className="px-3 py-2 text-sm text-[var(--text-light)]">
                        {l.description}
                      </td>
                      <td className="px-3 py-2 text-sm font-[var(--font-mono)] text-[var(--text-mid)]">
                        {Number(l.quantity).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-sm font-[var(--font-mono)] text-[var(--text-mid)]">
                        {fmtCurrency(l.unit_price, currency)}
                      </td>
                      <td className="px-3 py-2 text-sm font-[var(--font-mono)] text-[var(--foreground)]">
                        {fmtCurrency(l.total_price, currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col items-end gap-1 text-sm">
              <p className="text-[var(--text-mid)]">
                Subtotal:{" "}
                <span className="font-[var(--font-mono)] text-[var(--text-light)]">
                  {fmtCurrency(totals.subtotal, currency)}
                </span>
              </p>
              {totals.rate > 0 && (
                <p className="text-[var(--text-mid)]">
                  Tax ({totals.rate}%):{" "}
                  <span className="font-[var(--font-mono)] text-[var(--text-light)]">
                    {fmtCurrency(totals.taxAmount, currency)}
                  </span>
                </p>
              )}
              <p className="text-[var(--text-mid)]">
                Total:{" "}
                <span className="font-[var(--font-mono)] font-bold text-[var(--mint)]">
                  {fmtCurrency(totals.total, currency)}
                </span>
              </p>
            </div>
          </>
        )}

        <div>
          <FieldLabel>Notes</FieldLabel>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Terms, assumptions…"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy || !proposed}>
            {busy ? "Creating…" : "Create Quote"}
            <ArrowRight size={16} strokeWidth={2} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
