import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import {
  INK,
  INK_FAINT,
  MARGIN,
  RULE,
  bytesToBase64,
  brandSettings,
  drawBadge,
  drawFooter,
  drawLabel,
  drawRule,
  drawSectionHeading,
  drawStatTiles,
  drawWordmark,
  onAccent,
  registerMono,
  tableEnd,
  tableTheme,
  type RGB,
} from "./pdfBrand";

export { bytesToBase64 };

export interface ReportEntry {
  date: number;
  duration: number;
  is_billable: boolean;
  description: string | null;
  project: string;
  task: string;
}

function fmtD(ms: number): string {
  const d = new Date(Number(ms));
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

export interface MonthlyReportOpts {
  monthLabel: string;
  /** Rendered in the subtitle — callers pass the account name. */
  projectFilter: string;
  entries: ReportEntry[];
}

/** `ActiveApps-Hours-July-2026.pdf` — shared by the download and the email. */
export function monthlyReportFilename(monthLabel: string): string {
  // Deliberately fixed rather than derived from workspaceName: the monthly
  // summary identifies a previous export by this exact name when it replaces
  // one, so a rename would orphan every attachment already filed.
  return `ActiveApps-Hours-${monthLabel.replace(/\s+/g, "-")}.pdf`;
}

// Uppercase and terse: the head is set in the brand's mono label face, which
// is wider than Helvetica, and "Delivered / Completion Date" wrapped to three
// lines in a 66pt column.
const HEAD = ["ITEM", "DELIVERED", "SUBJECT", "DESCRIPTION", "HOURS"];

const COLUMNS = {
  0: { cellWidth: 36, halign: "center" as const },
  1: { cellWidth: 66 },
  2: { cellWidth: 100 },
  // Description takes all remaining width (~263pt on A4)
  4: { cellWidth: 50, halign: "right" as const },
};

/**
 * Renders the report and hands back the document instead of saving it, so the
 * same bytes can be downloaded or attached to an email. Browser-only: the
 * wordmark logo and the brand's mono face are both fetched.
 */
export async function buildMonthlyReport(
  opts: MonthlyReportOpts,
): Promise<jsPDF> {
  const { monthLabel, projectFilter, entries } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentW = pageWidth - MARGIN * 2;

  const mono = await registerMono(doc);
  const { accent, footerText } = await brandSettings();

  /* --- Header: the brand's light print variant --- */
  await drawWordmark(doc, mono, MARGIN, 34);
  drawRule(doc, MARGIN, 76, contentW, accent, 1);

  /* Who and when lead the page. The document type is obvious from the context
     it arrives in — attached to the month's invoice — while the two things a
     reader checks first are the client and the period, so those carry the
     weight and the document type becomes an eyebrow above them. */
  const client = projectFilter.trim();
  // The account name can be absent: summaryEmail drops it rather than print
  // Hebrew the built-in fonts cannot render. The document type then takes the
  // headline back rather than leaving a blank line.
  const headline = client || "Monthly Hours Breakdown";
  if (client) {
    drawLabel(doc, "Monthly Hours Breakdown", MARGIN, 98, {
      mono,
      size: 7,
      color: INK_FAINT,
    });
  }

  // The period, as a badge — the accent reads as ink on a fill where it would
  // fail as type on white. Drawn first so the headline knows what room it has.
  const badgeW = drawBadge(doc, mono, monthLabel, MARGIN + contentW, 118, {
    fill: accent,
    size: 11,
    align: "right",
  });

  doc.setFont("helvetica", "bold");
  doc.setTextColor(...INK);
  // Shrink to fit rather than run under the badge: client names vary wildly in
  // length and a collision would be silent.
  const room = contentW - badgeW - 16;
  let headlineSize = 24;
  doc.setFontSize(headlineSize);
  while (headlineSize > 12 && doc.getTextWidth(headline) > room) {
    headlineSize -= 1;
    doc.setFontSize(headlineSize);
  }
  doc.text(headline, MARGIN, 122);

  /* --- The one figure the month comes down to. Non-billable work is not part
         of this document, so it is neither listed nor counted here. --- */
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  const billable = sorted.filter((e) => e.is_billable);
  const billableHours = billable.reduce((s, e) => s + e.duration, 0);

  const tilesEnd = drawStatTiles(
    doc,
    mono,
    MARGIN,
    148,
    (contentW - 20) / 3,
    [{ label: "Billable Hours", value: billableHours.toFixed(2), accented: true }],
    accent,
  );

  /* --- Detail table, numbered from 1 and sorted by date.
         Labour hours only — no commercial numbers anywhere in this document. --- */
  const itemRows = (list: ReportEntry[]): RowInput[] =>
    list.map((e, i) => [
      { content: String(i + 1), styles: { halign: "center" as const } },
      fmtD(e.date),
      e.task || "—",
      e.description || "—",
      { content: e.duration.toFixed(2), styles: { halign: "right" as const } },
    ]);

  const totalRow = (hours: number, fill: RGB, text: RGB): RowInput => [
    {
      content: "TOTAL HOURS",
      colSpan: 4,
      styles: { fontStyle: "bold", halign: "right", fillColor: fill, textColor: text },
    },
    {
      content: hours.toFixed(2),
      styles: { fontStyle: "bold", halign: "right", fillColor: fill, textColor: text },
    },
  ];

  const drawTable = (startY: number, body: RowInput[]) => {
    autoTable(doc, {
      startY,
      margin: { left: MARGIN, right: MARGIN, bottom: 52 },
      head: [HEAD],
      body,
      columnStyles: COLUMNS,
      // A hairline under each row instead of a box around each cell. Anchored
      // to the row, not the cell: a wrapped description makes the row taller
      // than the Item cell, and a cell-anchored rule then cuts through it.
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index !== 0) return;
        drawRule(doc, data.cell.x, data.cell.y + data.row.height, contentW, RULE, 0.4);
      },
      ...tableTheme(mono),
    });
    return tableEnd(doc, startY);
  };

  /** Keep a heading with its table rather than orphaning it at a page foot. */
  const headingAt = (y: number, title: string, meta: string): number => {
    if (y + 72 > pageHeight - 52) {
      doc.addPage();
      y = 60;
    }
    return drawSectionHeading(doc, mono, MARGIN, y, contentW, title, { accent, meta });
  };

  // The section's meta is the item count, not its hours — the hours are
  // already the tile above and the total row below.
  const y = headingAt(
    tilesEnd + 34,
    "Billable Items",
    `${billable.length} ${billable.length === 1 ? "item" : "items"}`,
  );
  drawTable(y, [...itemRows(billable), totalRow(billableHours, accent, onAccent(accent))]);

  drawFooter(doc, mono, { footerText, pageNumbers: true });
  return doc;
}

/** Unchanged behaviour for the Export PDF button: build, then download. */
export async function generateMonthlyReport(
  opts: MonthlyReportOpts,
): Promise<void> {
  const doc = await buildMonthlyReport(opts);
  doc.save(monthlyReportFilename(opts.monthLabel));
}

/** The same document as bytes, for attaching to an email. */
export async function renderMonthlyReportBytes(
  opts: MonthlyReportOpts,
): Promise<Uint8Array> {
  const doc = await buildMonthlyReport(opts);
  // arraybuffer rather than datauristring: jsPDF injects a nonstandard
  // ";filename=generated.pdf" segment into that URI, so splitting on "," to
  // recover the base64 is fragile.
  return new Uint8Array(doc.output("arraybuffer"));
}

/** Base64 with no data: prefix — what JSON transport to an edge function wants. */
export async function renderMonthlyReportBase64(
  opts: MonthlyReportOpts,
): Promise<string> {
  return bytesToBase64(await renderMonthlyReportBytes(opts));
}
