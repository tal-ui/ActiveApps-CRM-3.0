import type { FieldDef } from "./objects";
import { msToDateInput } from "./format";

function escapeCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cellValue(
  field: FieldDef,
  row: Record<string, unknown>,
  lookupMaps: Record<string, Record<string, string>>,
): string {
  const raw = row[field.name];
  if (raw === null || raw === undefined) return "";
  if (field.type === "lookup" && field.lookup) {
    return lookupMaps[field.lookup]?.[String(raw)] ?? String(raw);
  }
  if (field.type === "date") return msToDateInput(raw as number);
  if (field.type === "boolean") return raw ? "Yes" : "No";
  return String(raw);
}

export function downloadCsv(
  filename: string,
  columns: FieldDef[],
  rows: Record<string, unknown>[],
  lookupMaps: Record<string, Record<string, string>>,
): void {
  const lines = [
    columns.map((c) => escapeCell(c.label)).join(","),
    ...rows.map((row) =>
      columns.map((c) => escapeCell(cellValue(c, row, lookupMaps))).join(","),
    ),
  ];
  const blob = new Blob(["\uFEFF" + lines.join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
