import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import {
  INK,
  INK_FAINT,
  MARGIN,
  RULE,
  bytesToBase64,
  brandSettings,
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  doc.text("Monthly Hours Breakdown", MARGIN, 104);

  // The account name can be absent — summaryEmail drops it rather than print
  // Hebrew the built-in fonts cannot render — so the separator is conditional
  // instead of leaving a line ending in a dangling middot.
  const subtitle = [monthLabel, projectFilter.trim()].filter(Boolean).join("  ·  ");
  drawLabel(doc, subtitle, MARGIN, 120, {
    mono,
    size: 8,
    color: INK_FAINT,
    bold: false,
    // Lightly tracked: this line names the client, and a reader copying it out
    // should get the name back rather than its letters.
    track: 0.04,
  });

  /* --- The month in three figures.
         Only billable work is itemised below, so naming the internal hours
         here is what lets the three numbers be reconciled: without it, a
         reader seeing a total larger than the billable figure has no account
         of the difference. --- */
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  const billable = sorted.filter((e) => e.is_billable);
  const sum = (list: ReportEntry[]) => list.reduce((s, e) => s + e.duration, 0);
  const billableHours = sum(billable);
  const internalHours = sum(sorted.filter((e) => !e.is_billable));
  const totalHours = billableHours + internalHours;

  const tilesEnd = drawStatTiles(
    doc,
    mono,
    MARGIN,
    138,
    contentW,
    [
      { label: "Total Hours", value: totalHours.toFixed(2) },
      { label: "Billable", value: billableHours.toFixed(2), accented: true },
      { label: "Internal", value: internalHours.toFixed(2) },
    ],
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

  // Billable work only. Non-billable entries are deliberately not itemised —
  // they are internal, and the client is not being asked to read them. The
  // Internal tile above still names and quantifies them, so the three figures
  // reconcile on their face even though the hours behind one of them are not
  // listed.
  const y = headingAt(tilesEnd + 34, "Billable Items", `${billableHours.toFixed(2)} hrs`);
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
