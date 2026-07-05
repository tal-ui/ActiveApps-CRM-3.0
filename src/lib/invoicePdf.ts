import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtMoneyAscii } from "./format";

const NAVY: [number, number, number] = [12, 18, 26];
const MINT: [number, number, number] = [60, 201, 152];
const GRAY: [number, number, number] = [110, 114, 120];
const LIGHT: [number, number, number] = [244, 246, 248];

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  issueDate: number;
  dueDate: number;
  accountName: string;
  projectName: string | null;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  lines: { description: string; quantity: number; unitPrice: number; total: number }[];
}

export interface QuotePdfData {
  quoteNumber: string;
  status: string;
  createdAt: number;
  validUntil: number;
  accountName: string;
  opportunityName: string | null;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  lines: { description: string; quantity: number; unitPrice: number; total: number }[];
}

// Superset shape shared by invoice and quote PDFs — identical layout, only the
// labels/strings differ. The thin wrappers below pass the exact strings.
export interface DocumentPdfData {
  title: string; // "INVOICE" | "QUOTE"
  number: string;
  partyLabel: string; // "BILLED TO" | "PREPARED FOR"
  partyName: string;
  subLine: string | null; // e.g. "Project: X" | "Opportunity: Y"
  meta: [string, string][]; // right-hand label/value rows
  qtyHeader: string; // "Hours / Qty" | "Qty"
  totalLabel: string; // "TOTAL DUE" | "TOTAL"
  filename: string;
  currency: string;
  subtotal: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  notes: string | null;
  lines: { description: string; quantity: number; unitPrice: number; total: number }[];
}

// ISO-code display (e.g. "ILS 1,234.00") — jsPDF's built-in fonts lack some
// currency glyphs such as ₪, so we avoid symbols in the PDF.
function money(n: number, currency: string): string {
  return fmtMoneyAscii(n, currency);
}

async function loadLogoDataUrl(): Promise<string | null> {
  try {
    const res = await fetch("/aa-logo.png");
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function generateDocumentPdf(data: DocumentPdfData): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  /* Header — light print variant */
  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, 34, 30, 30);
    } catch {
      /* optional */
    }
  }
  const wordmarkX = logo ? margin + 40 : margin;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(...NAVY);
  doc.text("ACTIVE", wordmarkX, 50);
  const activeW = doc.getTextWidth("ACTIVE");
  doc.setTextColor(...MINT);
  doc.text("APPS", wordmarkX + activeW, 50);
  doc.setFont("courier", "normal");
  doc.setFontSize(7);
  doc.setTextColor(94, 98, 104);
  doc.text("T E C H   O R C H E S T R A T I O N", wordmarkX, 62);

  // Document title + number (right aligned)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(...NAVY);
  doc.text(data.title, pageWidth - margin, 50, { align: "right" });
  doc.setFont("courier", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...MINT);
  doc.text(data.number, pageWidth - margin, 66, { align: "right" });

  /* Meta block */
  const metaY = 110;
  doc.setFont("courier", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...GRAY);
  doc.text(data.partyLabel, margin, metaY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...NAVY);
  doc.text(data.partyName, margin, metaY + 16);
  if (data.subLine) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text(data.subLine, margin, metaY + 30);
  }

  data.meta.forEach(([label, value], i) => {
    const y = metaY + i * 16;
    doc.setFont("courier", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...GRAY);
    doc.text(label, pageWidth - margin - 130, y);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(value, pageWidth - margin, y, { align: "right" });
  });

  /* Line items */
  autoTable(doc, {
    startY: 170,
    margin: { left: margin, right: margin },
    head: [["Description", data.qtyHeader, "Unit Price", "Amount"]],
    body: data.lines.map((l) => [
      l.description,
      { content: l.quantity.toFixed(2), styles: { halign: "right" as const } },
      { content: money(l.unitPrice, data.currency), styles: { halign: "right" as const } },
      { content: money(l.total, data.currency), styles: { halign: "right" as const } },
    ]),
    theme: "grid",
    styles: {
      fontSize: 9,
      cellPadding: 6,
      textColor: [40, 44, 50],
      lineColor: [225, 228, 232],
      lineWidth: 0.5,
    },
    headStyles: {
      fillColor: NAVY,
      textColor: [255, 255, 255],
      fontStyle: "bold",
      fontSize: 8,
    },
    columnStyles: {
      1: { cellWidth: 80 },
      2: { cellWidth: 90 },
      3: { cellWidth: 95 },
    },
  });

  /* Totals box */
  const afterTable =
    (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
      ?.finalY ?? 300;
  const totalsX = pageWidth - margin - 200;
  let ty = afterTable + 18;
  const totalRow = (label: string, value: string, strong = false) => {
    if (strong) {
      doc.setFillColor(...MINT);
      doc.roundedRect(totalsX - 8, ty - 11, 208, 20, 3, 3, "F");
      doc.setTextColor(...NAVY);
    } else {
      doc.setTextColor(...GRAY);
    }
    doc.setFont(strong ? "helvetica" : "courier", strong ? "bold" : "normal");
    doc.setFontSize(strong ? 10 : 8);
    doc.text(label, totalsX, ty);
    doc.text(value, pageWidth - margin, ty, { align: "right" });
    ty += 20;
  };
  totalRow("SUBTOTAL", money(data.subtotal, data.currency));
  if (data.taxRate > 0) {
    totalRow(`TAX (${data.taxRate}%)`, money(data.taxAmount, data.currency));
  }
  totalRow(data.totalLabel, money(data.totalAmount, data.currency), true);

  /* Notes */
  if (data.notes) {
    doc.setFillColor(...LIGHT);
    doc.roundedRect(margin, ty + 6, pageWidth - margin * 2, 36, 4, 4, "F");
    doc.setFont("courier", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text("NOTES", margin + 10, ty + 20);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(60, 65, 72);
    doc.text(doc.splitTextToSize(data.notes, pageWidth - margin * 2 - 20), margin + 10, ty + 32);
  }

  /* Footer */
  const pageHeight = doc.internal.pageSize.getHeight();
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...GRAY);
  doc.text("Generated by ActiveApps CRM", margin, pageHeight - 24);
  doc.text("activeapps.io", pageWidth - margin, pageHeight - 24, { align: "right" });

  doc.save(data.filename);
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<void> {
  return generateDocumentPdf({
    title: "INVOICE",
    number: data.invoiceNumber,
    partyLabel: "BILLED TO",
    partyName: data.accountName,
    subLine: data.projectName ? `Project: ${data.projectName}` : null,
    meta: [
      ["ISSUE DATE", fmtDate(data.issueDate)],
      ["DUE DATE", fmtDate(data.dueDate)],
      ["STATUS", data.status.toUpperCase()],
    ],
    qtyHeader: "Hours / Qty",
    totalLabel: "TOTAL DUE",
    filename: `${data.invoiceNumber}.pdf`,
    currency: data.currency,
    subtotal: data.subtotal,
    taxRate: data.taxRate,
    taxAmount: data.taxAmount,
    totalAmount: data.totalAmount,
    notes: data.notes,
    lines: data.lines,
  });
}

export function generateQuotePdf(data: QuotePdfData): Promise<void> {
  return generateDocumentPdf({
    title: "QUOTE",
    number: data.quoteNumber,
    partyLabel: "PREPARED FOR",
    partyName: data.accountName,
    subLine: data.opportunityName ? `Opportunity: ${data.opportunityName}` : null,
    meta: [
      ["QUOTE DATE", fmtDate(data.createdAt)],
      ["VALID UNTIL", fmtDate(data.validUntil)],
      ["STATUS", data.status.toUpperCase()],
    ],
    qtyHeader: "Qty",
    totalLabel: "TOTAL",
    filename: `${data.quoteNumber}.pdf`,
    currency: data.currency,
    subtotal: data.subtotal,
    taxRate: data.taxRate,
    taxAmount: data.taxAmount,
    totalAmount: data.totalAmount,
    notes: data.notes,
    lines: data.lines,
  });
}
