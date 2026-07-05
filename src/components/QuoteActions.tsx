import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Download,
  ExternalLink,
  Send,
  XCircle,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { invalidateLookup, useLookupMaps } from "../lib/lookups";
import { nextInvoiceNumber } from "../lib/docNumber";
import { DEFAULT_CURRENCY } from "../lib/format";
import { Button, ConfirmModal, ErrorNote } from "./ui";

export default function QuoteActions({
  quote,
  onChanged,
}: {
  quote: Record<string, unknown>;
  onChanged: () => void;
}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const maps = useLookupMaps(["accounts", "opportunities"]);
  const status = String(quote.status ?? "");
  const quoteNumber = String(quote.quote_number ?? "Quote");

  async function setStatus(next: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    const { error: err } = await supabase
      .from("quotes")
      .update({ status: next, updated_at: Date.now() })
      .eq("id", quote.id as string);
    if (err) {
      setBusy(false);
      setError(err.message);
      return;
    }
    await insertAudit(profile, {
      action: "status_change",
      entity_type: "quote",
      entity_id: quote.id as string,
      summary: `Quote ${quoteNumber} marked ${next}`,
    });
    setBusy(false);
    onChanged();
  }

  async function downloadPdf() {
    if (busy) return;
    setBusy(true);
    setError("");
    const { generateQuotePdf } = await import("../lib/invoicePdf");
    const { data: lines } = await supabase
      .from("quote_line_items")
      .select("description, quantity, unit_price, total_price")
      .eq("quote_id", quote.id as string)
      .order("created_at", { ascending: true });
    await generateQuotePdf({
      quoteNumber,
      status,
      createdAt: Number(quote.created_at ?? Date.now()),
      validUntil: Number(quote.valid_until ?? Date.now()),
      accountName: maps.accounts?.[String(quote.account_id ?? "")] ?? "Client",
      opportunityName: quote.opportunity_id
        ? (maps.opportunities?.[String(quote.opportunity_id)] ?? null)
        : null,
      currency: String(quote.currency ?? DEFAULT_CURRENCY),
      subtotal: Number(quote.subtotal ?? 0),
      taxRate: Number(quote.tax_rate ?? 0),
      taxAmount: Number(quote.tax_amount ?? 0),
      totalAmount: Number(quote.total_amount ?? 0),
      notes: (quote.notes as string) ?? null,
      lines: ((lines ?? []) as {
        description: string;
        quantity: number | string;
        unit_price: number | string;
        total_price: number | string;
      }[]).map((l) => ({
        description: l.description,
        quantity: Number(l.quantity ?? 0),
        unitPrice: Number(l.unit_price ?? 0),
        total: Number(l.total_price ?? 0),
      })),
    });
    setBusy(false);
  }

  async function convertToInvoice() {
    if (busy) return;
    setBusy(true);
    setError("");
    const now = Date.now();
    const invoiceNumber = await nextInvoiceNumber();

    const { data: lines, error: linesErr } = await supabase
      .from("quote_line_items")
      .select("*")
      .eq("quote_id", quote.id as string)
      .order("created_at", { ascending: true });
    if (linesErr) {
      setBusy(false);
      setError(linesErr.message);
      return;
    }

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        invoice_number: invoiceNumber,
        account_id: quote.account_id,
        project_id: null,
        status: "draft",
        issue_date: now,
        due_date: now + 30 * 86400000, // Net 30
        subtotal: Number(quote.subtotal ?? 0),
        tax_rate: Number(quote.tax_rate ?? 0),
        tax_amount: Number(quote.tax_amount ?? 0),
        total_amount: Number(quote.total_amount ?? 0),
        currency: String(quote.currency ?? "") || DEFAULT_CURRENCY,
        notes: `Converted from quote ${quoteNumber}`,
        created_by_id: profile?.id ?? "system",
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (invErr || !invoice) {
      setBusy(false);
      setError(invErr?.message ?? "Failed to create invoice.");
      return;
    }
    const invoiceId = (invoice as { id: string }).id;

    for (const line of (lines ?? []) as Record<string, unknown>[]) {
      // invoice_line_items has no updated_at column in the schema
      const { error: liErr } = await supabase.from("invoice_line_items").insert({
        invoice_id: invoiceId,
        description: (line.description as string) ?? "Service",
        quantity: Number(line.quantity ?? 0),
        unit_price: Number(line.unit_price ?? 0),
        total_price: Number(line.total_price ?? 0),
        created_at: now,
      });
      if (liErr) {
        setBusy(false);
        setError(`Invoice created but a line item failed: ${liErr.message}`);
        return;
      }
    }

    const { error: qErr } = await supabase
      .from("quotes")
      .update({ invoice_id: invoiceId, updated_at: now })
      .eq("id", quote.id as string);
    if (qErr) {
      setBusy(false);
      setError(`Invoice created but the quote was not linked: ${qErr.message}`);
      return;
    }

    await insertAudit(profile, {
      action: "convert",
      entity_type: "quote",
      entity_id: quote.id as string,
      summary: `Converted quote ${quoteNumber} to invoice ${invoiceNumber}`,
    });
    invalidateLookup("invoices");
    setBusy(false);
    setConfirmOpen(false);
    navigate(`/invoices/${invoiceId}`);
  }

  return (
    <>
      {status === "draft" && (
        <Button disabled={busy} onClick={() => setStatus("sent")}>
          <Send size={14} strokeWidth={1.5} />
          Mark Sent
        </Button>
      )}
      {status === "sent" && (
        <>
          <Button disabled={busy} onClick={() => setStatus("accepted")}>
            <CheckCircle2 size={14} strokeWidth={1.5} />
            Mark Accepted
          </Button>
          <Button variant="subtle" disabled={busy} onClick={() => setStatus("declined")}>
            <XCircle size={14} strokeWidth={1.5} />
            Mark Declined
          </Button>
        </>
      )}
      {status === "accepted" && !quote.invoice_id && (
        <Button disabled={busy} onClick={() => setConfirmOpen(true)}>
          <ArrowRight size={14} strokeWidth={1.5} />
          Convert to Invoice
        </Button>
      )}
      {Boolean(quote.invoice_id) && (
        <Button
          variant="subtle"
          disabled={busy}
          onClick={() => navigate(`/invoices/${quote.invoice_id}`)}
        >
          <ExternalLink size={14} strokeWidth={1.5} />
          View Invoice
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={downloadPdf}>
        <Download size={14} strokeWidth={1.5} />
        PDF
      </Button>
      {error && !confirmOpen && <ErrorNote message={error} />}
      {confirmOpen && (
        <ConfirmModal
          title="Convert to Invoice"
          confirmLabel="Convert"
          busy={busy}
          onConfirm={convertToInvoice}
          onClose={() => setConfirmOpen(false)}
        >
          {error && <ErrorNote message={error} />}
          <p>
            This creates a <span className="text-[var(--mint)]">draft invoice</span>{" "}
            from quote {quoteNumber} with its line items, links it back to this
            quote, and opens the new invoice.
          </p>
        </ConfirmModal>
      )}
    </>
  );
}
