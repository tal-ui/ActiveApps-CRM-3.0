import { useState } from "react";
import type { FieldDef } from "../lib/objects";
import FieldValue from "./FieldValue";
import InlineCell from "./InlineCell";

export default function DataTable({
  columns,
  rows,
  lookupMaps,
  onRowClick,
  sortField,
  sortAsc,
  onSort,
  editable = false,
  onSaveCell,
}: {
  columns: FieldDef[];
  rows: Record<string, unknown>[];
  lookupMaps: Record<string, Record<string, string>>;
  onRowClick?: (row: Record<string, unknown>) => void;
  sortField?: string;
  sortAsc?: boolean;
  onSort?: (field: string) => void;
  editable?: boolean;
  onSaveCell?: (
    rowId: string,
    field: FieldDef,
    value: unknown,
  ) => Promise<string | null>;
}) {
  // Cell currently in edit mode — its td must not clip the editor popover
  const [editingCell, setEditingCell] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[rgba(255,255,255,0.06)]">
      <table className="w-full">
        <thead>
          <tr className="bg-[var(--section-darker)] border-b border-[rgba(255,255,255,0.06)]">
            {columns.map((c) => (
              <th
                key={c.name}
                onClick={onSort ? () => onSort(c.name) : undefined}
                className={`px-4 py-3 text-left font-[var(--font-mono)] font-medium text-[0.62rem] uppercase tracking-[0.15em] text-[var(--text-faint)] whitespace-nowrap ${
                  onSort ? "cursor-pointer hover:text-[var(--text-mid)] transition-colors select-none" : ""
                }`}
              >
                {c.label}
                {sortField === c.name && (
                  <span className="ml-1 text-[var(--mint)]">
                    {sortAsc ? "↑" : "↓"}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={String(row.id)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-[rgba(255,255,255,0.04)] last:border-b-0 transition-colors duration-200 hover:bg-[var(--navy-surface)] ${
                onRowClick ? "cursor-pointer" : ""
              }`}
            >
              {columns.map((c) => {
                const cellKey = `${row.id}:${c.name}`;
                const canEdit = editable && onSaveCell && !c.readOnly;
                return (
                  <td
                    key={c.name}
                    className={`px-4 py-3 text-[var(--text-mid)] text-sm whitespace-nowrap max-w-[260px] ${
                      editingCell === cellKey
                        ? "overflow-visible relative z-10"
                        : "overflow-hidden text-ellipsis"
                    }`}
                  >
                    {canEdit ? (
                      <InlineCell
                        field={c}
                        record={row}
                        lookupMaps={lookupMaps}
                        onSave={(v) => onSaveCell(String(row.id), c, v)}
                        onEditingChange={(e) =>
                          setEditingCell(e ? cellKey : null)
                        }
                      />
                    ) : (
                      <FieldValue field={c} record={row} lookupMaps={lookupMaps} />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
