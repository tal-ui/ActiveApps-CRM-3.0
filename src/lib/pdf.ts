import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";

export interface ReportEntry {
  date: number;
  duration: number;
  is_billable: boolean;
  hourly_rate: number | null;
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

  /* --- Summary boxes --- */
  const totalHours = entries.reduce((s, e) => s + e.duration, 0);
  const billableHours = entries
    .filter((e) => e.is_billable)
    .reduce((s, e) => s + e.duration, 0);
  const nonBillable = totalHours - billableHours;
  const billableValue = entries
    .filter((e) => e.is_billable)
    .reduce((s, e) => s + e.duration * (e.hourly_rate ?? 0), 0);

  const boxes = [
    { label: "TOTAL HOURS", value: totalHours.toFixed(1) },
    { label: "BILLABLE", value: billableHours.toFixed(1) },
    { label: "NON-BILLABLE", value: nonBillable.toFixed(1) },
    {
      label: "BILLABLE VALUE",
      value: `$${billableValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
    },
  ];
  const boxW = (pageWidth - margin * 2 - 3 * 10) / 4;
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

  /* --- Detail table grouped by project --- */
  const byProject = new Map<string, ReportEntry[]>();
  for (const e of [...entries].sort((a, b) => a.date - b.date)) {
    if (!byProject.has(e.project)) byProject.set(e.project, []);
    byProject.get(e.project)!.push(e);
  }

  const body: RowInput[] = [];
  for (const [project, rows] of byProject.entries()) {
    body.push([
      {
        content: project,
        colSpan: 5,
        styles: {
          fillColor: NAVY,
          textColor: MINT,
          fontStyle: "bold",
          fontSize: 9,
        },
      },
    ]);
    for (const e of rows) {
      body.push([
        fmtD(e.date),
        e.task || "—",
        e.description || "—",
        project,
        { content: e.duration.toFixed(2), styles: { halign: "right" } },
      ]);
    }
    const subtotal = rows.reduce((s, e) => s + e.duration, 0);
    body.push([
      {
        content: `Subtotal — ${project}`,
        colSpan: 4,
        styles: { fontStyle: "bold", halign: "right", fillColor: LIGHT },
      },
      {
        content: subtotal.toFixed(2),
        styles: { fontStyle: "bold", halign: "right", fillColor: LIGHT },
      },
    ]);
  }
  body.push([
    {
      content: "TOTAL",
      colSpan: 4,
      styles: {
        fontStyle: "bold",
        halign: "right",
        fillColor: MINT,
        textColor: NAVY,
      },
    },
    {
      content: totalHours.toFixed(2),
      styles: {
        fontStyle: "bold",
        halign: "right",
        fillColor: MINT,
        textColor: NAVY,
      },
    },
  ]);

  autoTable(doc, {
    startY: 198,
    margin: { left: margin, right: margin, bottom: 46 },
    head: [["Date", "Task", "Description", "Project", "Hours"]],
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
      0: { cellWidth: 52 },
      1: { cellWidth: 110 },
      3: { cellWidth: 95 },
      4: { cellWidth: 48, halign: "right" },
    },
  });

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
