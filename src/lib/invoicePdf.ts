import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { fmtDate, fmtMoneyAscii } from "./format";
import {
  INK,
  INK_FAINT,
  INK_SOFT,
  MARGIN,
  RADIUS,
  RULE,
  SURFACE,
  brandSettings,
  drawFooter,
  drawLabel,
  drawRule,
  drawWordmark,
  onAccent,
  registerMono,
  tableEnd,
  tableTheme,
} from "./pdfBrand";

/**
 * Issuer identity for a legally-formed Israeli tax invoice: the business's
 * name and ח.פ. / ע.מ. have to appear on the document.
 *
 * NOTE: jsPDF's built-in fonts carry no Hebrew glyphs (the same reason this
 * file prints "ILS 1,234.00" rather than ₪). Hebrew entered in these fields
 * will not render — use Latin text until a Hebrew font is embedded.
 */
export interface PdfIssuer {
  legalName: string;
  taxId: string;
  address: string;
  phone: string;
  email: string;
}

export interface InvoicePdfData {
  invoiceNumber: string;
  status: string;
  issueDate: number;
  dueDate: number;
  accountName: string;
  accountTaxId?: string | null;
  accountAddress?: string | null;
  projectName: string | null;
  currency: string;
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid?: number;
  balance?: number;
  legalDocNumber?: string | null;
  allocationNumber?: string | null;
  issuer?: PdfIssuer;
  footerText?: string;
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
  partyLines?: (string | null | undefined)[]; // tax id, address …
  subLine: string | null; // e.g. "Project: X" | "Opportunity: Y"
  meta: [string, string][]; // right-hand label/value rows
  qtyHeader: string; // "Hours / Qty" | "Qty"
  totalLabel: string; // "TOTAL DUE" | "TOTAL"
  filename: string;
  currency: string;
  subtotal: number;
  discountPercent?: number;
  discountAmount?: number;
  taxRate: number;
  taxAmount: number;
  totalAmount: number;
  /** Extra rows under the total, e.g. amount paid / balance due. */
  extraTotals?: [string, string][];
  issuer?: PdfIssuer;
  footerText?: string;
  notes: string | null;
  lines: { description: string; quantity: number; unitPrice: number; total: number }[];
}

// ISO-code display (e.g. "ILS 1,234.00") — jsPDF's built-in fonts lack some
// currency glyphs such as ₪, so we avoid symbols in the PDF.
function money(n: number, currency: string): string {
  return fmtMoneyAscii(n, currency);
}

export async function generateDocumentPdf(data: DocumentPdfData): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = MARGIN;
  const contentW = pageWidth - margin * 2;

  const mono = await registerMono(doc);
  const brand = await brandSettings();
  const accent = brand.accent;

  /* Header — the brand's light print variant, shared with the hours report */
  await drawWordmark(doc, mono, margin, 34);

  // Document title + number, right aligned against the wordmark.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);
  doc.setTextColor(...INK);
  doc.text(data.title, pageWidth - margin, 50, { align: "right" });
  // Untracked and unaltered: this is the number a client's finance system
  // copies or parses off the document, and wide tracking makes a PDF extractor
  // read it back as "5 0 0 3 3".
  drawLabel(doc, data.number, pageWidth - margin, 66, {
    mono,
    size: 10,
    color: INK,
    align: "right",
    uppercase: false,
    track: 0,
  });

  drawRule(doc, margin, 78, contentW, accent, 1);

  // Issuer identity — required on an Israeli tax invoice.
  const issuerLines = data.issuer
    ? [
        data.issuer.legalName,
        data.issuer.taxId ? `Tax ID: ${data.issuer.taxId}` : "",
        data.issuer.address,
        [data.issuer.phone, data.issuer.email].filter(Boolean).join("  ·  "),
      ].filter((l) => l && l.trim())
    : [];
  issuerLines.forEach((line, i) => {
    doc.setFont("helvetica", i === 0 ? "bold" : "normal");
    doc.setFontSize(i === 0 ? 8 : 7.5);
    doc.setTextColor(...(i === 0 ? INK_SOFT : INK_FAINT));
    doc.text(line, margin, 94 + i * 10);
  });

  /* Meta block — pushed down far enough to clear the issuer block */
  const metaY = Math.max(126, 94 + issuerLines.length * 10 + 14);
  drawLabel(doc, data.partyLabel, margin, metaY, { mono, size: 7 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(data.partyName, margin, metaY + 16);
  let partyY = metaY + 16;
  for (const line of (data.partyLines ?? []).filter((l): l is string => !!l && !!l.trim())) {
    partyY += 12;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...INK_FAINT);
    doc.text(line, margin, partyY);
  }
  if (data.subLine) {
    partyY += 13;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...INK_SOFT);
    doc.text(data.subLine, margin, partyY);
  }

  data.meta.forEach(([label, value], i) => {
    const y = metaY + i * 16;
    drawLabel(doc, label, pageWidth - margin - 130, y, { mono, size: 7 });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(value, pageWidth - margin, y, { align: "right" });
  });

  /* Line items */
  autoTable(doc, {
    startY: Math.max(partyY, metaY + data.meta.length * 16) + 22,
    margin: { left: margin, right: margin, bottom: 52 },
    // Uppercase to match the label treatment the mono head is set in.
    head: [["DESCRIPTION", data.qtyHeader.toUpperCase(), "UNIT PRICE", "AMOUNT"]],
    body: data.lines.map((l) => [
      l.description,
      { content: l.quantity.toFixed(2), styles: { halign: "right" as const } },
      { content: money(l.unitPrice, data.currency), styles: { halign: "right" as const } },
      { content: money(l.total, data.currency), styles: { halign: "right" as const } },
    ]),
    columnStyles: {
      1: { cellWidth: 80 },
      2: { cellWidth: 90 },
      3: { cellWidth: 95 },
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index !== 0) return;
      drawRule(doc, data.cell.x, data.cell.y + data.row.height, contentW, RULE, 0.4);
    },
    ...tableTheme(mono),
  });

  /* Totals box */
  const afterTable = tableEnd(doc, 300);
  const totalsX = pageWidth - margin - 200;
  let ty = afterTable + 22;
  const totalRow = (label: string, value: string, strong = false) => {
    if (strong) {
      doc.setFillColor(...accent);
      doc.roundedRect(totalsX - 8, ty - 11, 208, 20, RADIUS - 2, RADIUS - 2, "F");
      const ink = onAccent(accent);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...ink);
      doc.text(label, totalsX, ty);
      doc.text(value, pageWidth - margin, ty, { align: "right" });
    } else {
      drawLabel(doc, label, totalsX, ty, { mono, size: 7.5, bold: false });
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(...INK_SOFT);
      doc.text(value, pageWidth - margin, ty, { align: "right" });
    }
    ty += 20;
  };
  totalRow("SUBTOTAL", money(data.subtotal, data.currency));
  // The discount is shown, not folded into the line prices — the client sees
  // the agreed rate and the reduction separately.
  if ((data.discountPercent ?? 0) > 0) {
    totalRow(
      `DISCOUNT (${data.discountPercent}%)`,
      `-${money(data.discountAmount ?? 0, data.currency)}`,
    );
  }
  if (data.taxRate > 0) {
    totalRow(`VAT (${data.taxRate}%)`, money(data.taxAmount, data.currency));
  }
  totalRow(data.totalLabel, money(data.totalAmount, data.currency), true);
  for (const [label, value] of data.extraTotals ?? []) {
    totalRow(label, value);
  }

  /* Notes */
  if (data.notes) {
    const body = doc.splitTextToSize(data.notes, contentW - 20) as string[];
    const boxH = 26 + body.length * 11;
    doc.setFillColor(...SURFACE);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, ty + 6, contentW, boxH, RADIUS, RADIUS, "FD");
    drawLabel(doc, "Notes", margin + 10, ty + 21, { mono, size: 6.5 });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...INK_SOFT);
    doc.text(body, margin + 10, ty + 34);
  }

  // The caller's footerText wins; otherwise the workspace setting, which is
  // the same value InvoiceActions already passes in.
  drawFooter(doc, mono, {
    footerText: data.footerText?.trim() || brand.footerText,
  });

  doc.save(data.filename);
}

export function generateInvoicePdf(data: InvoicePdfData): Promise<void> {
  // Once the invoice has been issued through the provider, the legal document
  // number is the one that identifies it — the internal number becomes a
  // reference, so both are shown.
  const meta: [string, string][] = [
    ["ISSUE DATE", fmtDate(data.issueDate)],
    ["DUE DATE", fmtDate(data.dueDate)],
    ["STATUS", data.status.toUpperCase()],
  ];
  // When issued, the provider's number becomes the document's identity and
  // the internal number stays on as a cross-reference.
  if (data.legalDocNumber) meta.push(["INTERNAL REF", data.invoiceNumber]);
  if (data.allocationNumber) meta.push(["ALLOCATION #", data.allocationNumber]);

  const extraTotals: [string, string][] = [];
  if ((data.amountPaid ?? 0) > 0) {
    extraTotals.push(["PAID", money(data.amountPaid ?? 0, data.currency)]);
    extraTotals.push(["BALANCE DUE", money(data.balance ?? 0, data.currency)]);
  }

  return generateDocumentPdf({
    // Only a document the provider has actually issued may call itself a tax
    // invoice; anything else is still an internal draft.
    title: data.legalDocNumber ? "TAX INVOICE" : "INVOICE",
    number: data.legalDocNumber || data.invoiceNumber,
    partyLabel: "BILLED TO",
    partyName: data.accountName,
    partyLines: [
      data.accountTaxId ? `Tax ID: ${data.accountTaxId}` : null,
      data.accountAddress,
    ],
    subLine: data.projectName ? `Projects: ${data.projectName}` : null,
    meta,
    qtyHeader: "Hours / Qty",
    totalLabel: "TOTAL DUE",
    filename: `${data.legalDocNumber || data.invoiceNumber}.pdf`,
    currency: data.currency,
    subtotal: data.subtotal,
    discountPercent: data.discountPercent,
    discountAmount: data.discountAmount,
    taxRate: data.taxRate,
    taxAmount: data.taxAmount,
    totalAmount: data.totalAmount,
    extraTotals,
    issuer: data.issuer,
    footerText: data.footerText,
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
