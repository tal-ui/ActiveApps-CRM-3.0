import { useState } from "react";
import { CheckCircle2, Download, Send } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLookupMaps } from "../lib/lookups";
import { Button } from "./ui";

export default function InvoiceActions({
  invoice,
  onChanged,
}: {
  invoice: Record<string, unknown>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const maps = useLookupMaps(["accounts", "projects"]);
  const status = String(invoice.status ?? "");

  async function setStatus(next: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    await supabase
      .from("invoices")
      .update({ status: next, updated_at: Date.now(), ...extra })
      .eq("id", invoice.id as string);
    setBusy(false);
    onChanged();
  }

  async function downloadPdf() {
    setBusy(true);
    const { generateInvoicePdf } = await import("../lib/invoicePdf");
    const { data: lines } = await supabase
      .from("invoice_line_items")
      .select("description, quantity, unit_price, total_price")
      .eq("invoice_id", invoice.id as string)
      .order("created_at", { ascending: true });
    await generateInvoicePdf({
      invoiceNumber: String(invoice.invoice_number ?? "INV"),
      status,
      issueDate: Number(invoice.issue_date ?? Date.now()),
      dueDate: Number(invoice.due_date ?? Date.now()),
      accountName:
        maps.accounts?.[String(invoice.account_id ?? "")] ?? "Client",
      projectName: invoice.project_id
        ? (maps.projects?.[String(invoice.project_id)] ?? null)
        : null,
      currency: String(invoice.currency ?? "USD"),
      subtotal: Number(invoice.subtotal ?? 0),
      taxRate: Number(invoice.tax_rate ?? 0),
      taxAmount: Number(invoice.tax_amount ?? 0),
      totalAmount: Number(invoice.total_amount ?? 0),
      notes: (invoice.notes as string) ?? null,
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

  return (
    <>
      {status === "draft" && (
        <Button disabled={busy} onClick={() => setStatus("sent")}>
          <Send size={14} strokeWidth={1.5} />
          Mark Sent
        </Button>
      )}
      {(status === "sent" || status === "overdue") && (
        <Button disabled={busy} onClick={() => setStatus("paid", { paid_date: Date.now() })}>
          <CheckCircle2 size={14} strokeWidth={1.5} />
          Mark Paid
        </Button>
      )}
      <Button variant="ghost" disabled={busy} onClick={downloadPdf}>
        <Download size={14} strokeWidth={1.5} />
        PDF
      </Button>
    </>
  );
}
