import { useState } from "react";
import { Banknote, Download, ExternalLink, Eye, Send, Stamp } from "lucide-react";
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
  const [note, setNote] = useState("");
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

  // Turns a Green Invoice error envelope into something worth reading. The
  // provider's own validation message is the most useful thing we can show —
  // it names the field that's wrong.
  async function describeFunctionError(e: unknown): Promise<string> {
    if (e instanceof FunctionsHttpError) {
      let body: { error?: string; detail?: string } | null = null;
      try {
        body = (await e.context.json()) as { error?: string; detail?: string };
      } catch {
        /* error body wasn't JSON */
      }
      if (body?.error === "not_configured") {
        return "Green Invoice isn't connected yet — add the API credentials in Settings → Tax Invoicing.";
      }
      if (body?.error === "invalid_key") {
        return "Green Invoice rejected the API credentials.";
      }
      if (body?.detail) {
        // Provider errors arrive as a JSON string; surface the message alone.
        try {
          const inner = JSON.parse(body.detail) as { errorMessage?: string };
          if (inner?.errorMessage) return `Green Invoice: ${inner.errorMessage}`;
        } catch {
          /* not nested JSON — show it as-is */
        }
        return body.detail;
      }
      return e.message;
    }
    return String((e as Error)?.message ?? e);
  }

  // Builds the document at Green Invoice and shows it, without allocating a
  // number or creating anything. Safe to run on a draft.
  async function previewTaxInvoice() {
    setBusy(true);
    setError("");
    setNote("");
    const { data, error: e } = await supabase.functions.invoke("issue-invoice", {
      body: { preview: true, invoiceId: invoice.id },
    });
    setBusy(false);
    if (e) {
      setError(await describeFunctionError(e));
      return;
    }
    const pdf = (data as { pdfBase64?: string; url?: string } | null)?.pdfBase64;
    const url = (data as { url?: string } | null)?.url;
    if (pdf) {
      // The preview comes back as a base64 PDF, so turn it into a blob URL
      // rather than a data: URI — Chrome blocks top-level data: navigation.
      const bytes = Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0));
      const blobUrl = URL.createObjectURL(
        new Blob([bytes], { type: "application/pdf" }),
      );
      window.open(blobUrl, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
      setNote("Green Invoice accepted this document. Nothing was issued.");
      return;
    }
    if (url) {
      window.open(url, "_blank", "noopener");
      return;
    }
    setNote("Green Invoice accepted this document, but returned no preview to show.");
  }

  // Hands the invoice to Green Invoice so it comes back with a legal document
  // number. The edge function holds the credentials; the browser never does.
  async function issueTaxInvoice() {
    setBusy(true);
    setError("");
    setNote("");
    const { error: e } = await supabase.functions.invoke("issue-invoice", {
      body: { invoiceId: invoice.id },
    });
    setBusy(false);
    if (!e) {
      onChanged();
      return;
    }
    setError(`Could not issue the tax invoice — ${await describeFunctionError(e)}`);
    // A failed issue records issue_error on the invoice, so refresh either way.
    onChanged();
  }

  return (
    <>
      {error && (
        <div className="w-full order-last">
          <ErrorNote message={error} />
        </div>
      )}
      {note && (
        <div className="w-full order-last bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--mint)]">
          {note}
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
      {/* Preview is offered on drafts too — checking the document before it
          goes out is exactly when it's most useful. Nothing is allocated. */}
      {!docNumber && status !== "cancelled" && (
        <Button variant="ghost" disabled={busy} onClick={previewTaxInvoice}>
          <Eye size={14} strokeWidth={1.5} />
          Preview Tax Invoice
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
