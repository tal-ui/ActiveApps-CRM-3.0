import { useState } from "react";
import { Banknote, Download, ExternalLink, Send, Stamp } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useLookupMaps } from "../lib/lookups";
import { fetchWorkspaceSettings } from "../lib/workspaceSettings";
import { DEFAULT_CURRENCY } from "../lib/format";
import { Button, ErrorNote } from "./ui";

export default function InvoiceActions({
  invoice,
  onChanged,
  onRecordPayment,
}: {
  invoice: Record<string, unknown>;
  onChanged: () => void;
  onRecordPayment: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const maps = useLookupMaps(["accounts", "projects"]);
  const status = String(invoice.status ?? "");
  const docNumber = invoice.external_doc_number
    ? String(invoice.external_doc_number)
    : "";
  const docUrl = invoice.external_doc_url ? String(invoice.external_doc_url) : "";

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
    const [{ data: lines }, settings, { data: account }] = await Promise.all([
      supabase
        .from("invoice_line_items")
        .select("description, quantity, unit_price, total_price")
        .eq("invoice_id", invoice.id as string)
        .order("created_at", { ascending: true }),
      fetchWorkspaceSettings(),
      supabase
        .from("accounts")
        .select("name, legal_name, tax_id, address, city, country")
        .eq("id", String(invoice.account_id ?? ""))
        .maybeSingle(),
    ]);
    const acc = account as {
      name?: string;
      legal_name?: string | null;
      tax_id?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
    } | null;
    await generateInvoicePdf({
      invoiceNumber: String(invoice.invoice_number ?? "INV"),
      status,
      issueDate: Number(invoice.issue_date ?? Date.now()),
      dueDate: Number(invoice.due_date ?? Date.now()),
      accountName:
        acc?.legal_name?.trim() ||
        acc?.name ||
        maps.accounts?.[String(invoice.account_id ?? "")] ||
        "Client",
      accountTaxId: acc?.tax_id ?? null,
      accountAddress:
        [acc?.address, acc?.city, acc?.country].filter(Boolean).join(", ") ||
        null,
      projectName: invoice.project_id
        ? (maps.projects?.[String(invoice.project_id)] ?? null)
        : null,
      currency: String(invoice.currency ?? DEFAULT_CURRENCY),
      subtotal: Number(invoice.subtotal ?? 0),
      taxRate: Number(invoice.tax_rate ?? 0),
      taxAmount: Number(invoice.tax_amount ?? 0),
      totalAmount: Number(invoice.total_amount ?? 0),
      amountPaid: Number(invoice.amount_paid ?? 0),
      balance: Number(invoice.balance ?? 0),
      legalDocNumber: docNumber || null,
      allocationNumber: invoice.allocation_number
        ? String(invoice.allocation_number)
        : null,
      issuer: {
        legalName: settings.issuerLegalName,
        taxId: settings.issuerTaxId,
        address: settings.issuerAddress,
        phone: settings.issuerPhone,
        email: settings.issuerEmail,
      },
      footerText: settings.pdfFooterText,
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

  // Hands the invoice to Green Invoice so it comes back with a legal document
  // number. The edge function holds the credentials; the browser never does.
  async function issueTaxInvoice() {
    setBusy(true);
    setError("");
    const { error: e } = await supabase.functions.invoke("issue-invoice", {
      body: { invoiceId: invoice.id },
    });
    setBusy(false);
    if (!e) {
      onChanged();
      return;
    }
    if (e instanceof FunctionsHttpError) {
      let body: { error?: string; detail?: string } | null = null;
      try {
        body = (await e.context.json()) as { error?: string; detail?: string };
      } catch {
        /* error body wasn't JSON */
      }
      if (body?.error === "not_configured") {
        setError(
          "Green Invoice isn't connected yet — add the API key in Settings → Workspace.",
        );
        return;
      }
      if (body?.error === "invalid_key") {
        setError("Green Invoice rejected the API credentials.");
        return;
      }
      setError(`Could not issue the tax invoice: ${body?.detail ?? e.message}`);
      onChanged();
      return;
    }
    setError(`Could not issue the tax invoice: ${String((e as Error).message ?? e)}`);
  }

  return (
    <>
      {error && (
        <div className="w-full order-last">
          <ErrorNote message={error} />
        </div>
      )}
      {status === "draft" && (
        <Button disabled={busy} onClick={() => setStatus("sent")}>
          <Send size={14} strokeWidth={1.5} />
          Mark Sent
        </Button>
      )}
      {status !== "cancelled" && Number(invoice.balance ?? 0) > 0 && (
        <Button disabled={busy} onClick={onRecordPayment}>
          <Banknote size={14} strokeWidth={1.5} />
          Record Payment
        </Button>
      )}
      {!docNumber && (status === "sent" || status === "overdue" || status === "paid") && (
        <Button variant="subtle" disabled={busy} onClick={issueTaxInvoice}>
          <Stamp size={14} strokeWidth={1.5} />
          {busy ? "Issuing…" : "Issue Tax Invoice"}
        </Button>
      )}
      {docNumber &&
        (docUrl ? (
          <a
            href={docUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-xs font-[var(--font-mono)] text-[var(--mint)] hover:underline cursor-pointer"
          >
            <ExternalLink size={13} strokeWidth={1.5} />
            {docNumber}
          </a>
        ) : (
          <span className="text-xs font-[var(--font-mono)] text-[var(--mint)]">
            {docNumber}
          </span>
        ))}
      <Button variant="ghost" disabled={busy} onClick={downloadPdf}>
        <Download size={14} strokeWidth={1.5} />
        PDF
      </Button>
    </>
  );
}
