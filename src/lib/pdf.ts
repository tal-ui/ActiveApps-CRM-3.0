import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";

export interface ReportEntry {
  date: number;
  duration: number;
  is_billable: boolean;
  description: string | null;
  project: string;
  task: string;
}

const NAVY: [number, number, number] = [12, 18, 26];
const MINT: [number, number, number] = [60, 201, 152];
const GRAY: [number, number, number] = [110, 114, 120];
const LIGHT: [number, number, number] = [244, 246, 248];

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

function fmtD(ms: number): string {
  return new Date(Number(ms)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export async function generateMonthlyReport(opts: {
  monthLabel: string;
  projectFilter: string;
  entries: ReportEntry[];
}): Promise<void> {
  const { monthLabel, projectFilter, entries } = opts;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 40;

  /* --- Header (light print variant: navy + mint on white) --- */
  const logo = await loadLogoDataUrl();
  if (logo) {
    try {
      doc.addImage(logo, "PNG", margin, 34, 30, 30);
    } catch {
      /* logo optional */
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

  doc.setFont("helvetica", "bold");
  doc.setFontSize(19);
  doc.setTextColor(...NAVY);
  doc.text("Monthly Hours Breakdown", margin, 102);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...GRAY);
  doc.text(`${monthLabel}  ·  ${projectFilter}`, margin, 118);

  /* --- Summary boxes — labor hours only, no commercial numbers --- */
  const totalHours = entries.reduce((s, e) => s + e.duration, 0);
  const billableHours = entries
    .filter((e) => e.is_billable)
    .reduce((s, e) => s + e.duration, 0);
  const nonBillable = totalHours - billableHours;

  const boxes = [
    { label: "TOTAL HOURS", value: totalHours.toFixed(1) },
    { label: "BILLABLE", value: billableHours.toFixed(1) },
    { label: "UNBILLED", value: nonBillable.toFixed(1) },
  ];
  const boxW = (pageWidth - margin * 2 - 2 * 10) / 3;
  boxes.forEach((b, i) => {
    const x = margin + i * (boxW + 10);
    doc.setFillColor(...LIGHT);
    doc.setDrawColor(225, 228, 232);
    doc.roundedRect(x, 134, boxW, 46, 4, 4, "FD");
    doc.setFont("courier", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...GRAY);
    doc.text(b.label, x + 10, 150);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(...NAVY);
    doc.text(b.value, x + 10, 168);
  });

  /* --- Two detail tables: billable items (main), then unbilled items.
         Rows are auto-numbered from 1 per table and sorted by date
         ascending; totals are labor hours only. --- */
  const sorted = [...entries].sort((a, b) => a.date - b.date);
  const billable = sorted.filter((e) => e.is_billable);
  const unbilled = sorted.filter((e) => !e.is_billable);

  const HEAD = [
    "Item #",
    "Delivered / Completion Date",
    "Subject",
    "Description",
    "Project",
    "# of Hours",
  ];

  const itemRows = (list: ReportEntry[]): RowInput[] =>
    list.map((e, i) => [
      { content: String(i + 1), styles: { halign: "center" as const } },
      fmtD(e.date),
      e.task || "—",
      e.description || "—",
      e.project,
      { content: e.duration.toFixed(2), styles: { halign: "right" as const } },
    ]);

  const drawTable = (startY: number, body: RowInput[]) => {
    autoTable(doc, {
      startY,
      margin: { left: margin, right: margin, bottom: 46 },
      head: [HEAD],
      body,
      theme: "grid",
      styles: {
        fontSize: 8.5,
        cellPadding: 5,
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
        0: { cellWidth: 36, halign: "center" },
        1: { cellWidth: 66 },
        2: { cellWidth: 100 },
        4: { cellWidth: 90 },
        5: { cellWidth: 50, halign: "right" },
      },
    });
    return (
      (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable
        ?.finalY ?? startY
    );
  };

  const pageHeightAll = doc.internal.pageSize.getHeight();
  const sectionHeading = (y: number, title: string): number => {
    // Keep the heading with its table — break the page if too close to the bottom
    if (y + 64 > pageHeightAll - 46) {
      doc.addPage();
      y = 50;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...NAVY);
    doc.text(title, margin, y);
    return y + 8;
  };

  /* Billable items — main table, ends with the billable hours total */
  let y = sectionHeading(206, "Billable Items");
  const billableBody = itemRows(billable);
  billableBody.push([
    {
      content: "TOTAL HOURS",
      colSpan: 5,
      styles: {
        fontStyle: "bold",
        halign: "right",
        fillColor: MINT,
        textColor: NAVY,
      },
    },
    {
      content: billableHours.toFixed(2),
      styles: {
        fontStyle: "bold",
        halign: "right",
        fillColor: MINT,
        textColor: NAVY,
      },
    },
  ]);
  y = drawTable(y, billableBody);

  /* Unbilled items */
  y = sectionHeading(y + 26, "Unbilled Items");
  if (unbilled.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...GRAY);
    doc.text("No unbilled items this period.", margin, y + 12);
  } else {
    drawTable(y, itemRows(unbilled));
  }

  /* --- Footer on every page --- */
  const pageCount = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...GRAY);
    doc.text("Generated by ActiveApps CRM", margin, pageHeight - 24);
    doc.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - margin,
      pageHeight - 24,
      { align: "right" },
    );
  }

  doc.save(`ActiveApps-Hours-${monthLabel.replace(/\s+/g, "-")}.pdf`);
}
