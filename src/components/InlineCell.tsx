import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import type { FieldDef } from "../lib/objects";
import { useLookupOptions } from "../lib/lookups";
import { dateToMs, msToDateInput } from "../lib/format";
import { Input, Select } from "./ui";
import SearchableSelect from "./SearchableSelect";
import FieldValue from "./FieldValue";

/**
 * Inline-editable table cell. Display mode shows the regular FieldValue with
 * a hover pencil; edit mode swaps in a type-appropriate editor:
 *   date → native date picker · picklist/boolean → dropdown ·
 *   lookup → search-and-select combobox · text/number → input.
 * Enter/blur saves, Escape cancels. Booleans toggle directly on click.
 */
export default function InlineCell({
  field,
  record,
  lookupMaps,
  onSave,
  onEditingChange,
}: {
  field: FieldDef;
  record: Record<string, unknown>;
  lookupMaps: Record<string, Record<string, string>>;
  onSave: (value: unknown) => Promise<string | null>;
  onEditingChange?: (editing: boolean) => void;
}) {
  const raw = record[field.name];
  const [editing, setEditingState] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lookupOptions = useLookupOptions(
    editing && field.type === "lookup" ? field.lookup : undefined,
  );

  function setEditing(v: boolean) {
    setEditingState(v);
    onEditingChange?.(v);
  }

  // Clear the error flash after a moment
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(""), 3000);
    return () => clearTimeout(t);
  }, [error]);

  function start(e: React.MouseEvent) {
    e.stopPropagation();
    if (field.type === "date") {
      setDraft(raw == null ? "" : msToDateInput(Number(raw)));
    } else {
      setDraft(raw == null ? "" : String(raw));
    }
    setEditing(true);
  }

  async function commit(nextRaw: unknown) {
    setBusy(true);
    const err = await onSave(nextRaw);
    setBusy(false);
    setEditing(false);
    if (err) setError(err);
  }

  function parseDraft(v: string): unknown {
    if (v === "") return null;
    if (field.type === "date") return dateToMs(v);
    if (field.type === "number" || field.type === "currency") {
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    }
    return v;
  }

  function saveDraft(v: string) {
    const parsed = parseDraft(v);
    const current = raw ?? null;
    if (parsed === current || String(parsed ?? "") === String(current ?? "")) {
      setEditing(false);
      return;
    }
    void commit(parsed);
  }

  // Booleans: no edit mode — toggle in place
  if (field.type === "boolean") {
    return (
      <button
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          void commit(!raw);
        }}
        aria-label={`Toggle ${field.label}`}
        title={error || undefined}
        className={`cursor-pointer disabled:opacity-50 ${error ? "text-[#F2697A]" : ""}`}
      >
        {raw ? (
          <Check size={16} strokeWidth={2} className="text-[var(--mint)]" />
        ) : (
          <X size={16} strokeWidth={1.5} className="text-[var(--text-faint)]" />
        )}
      </button>
    );
  }

  if (!editing) {
    return (
      <div
        className={`group/cell flex items-center gap-1.5 min-w-0 ${
          error ? "rounded ring-1 ring-[#F2697A]" : ""
        }`}
        title={error || undefined}
      >
        <span className="min-w-0 truncate">
          <FieldValue field={field} record={record} lookupMaps={lookupMaps} />
        </span>
        <button
          onClick={start}
          aria-label={`Edit ${field.label}`}
          className="opacity-0 group-hover/cell:opacity-100 focus:opacity-100 text-[var(--text-faint)] hover:text-[var(--mint)] cursor-pointer transition-all shrink-0"
        >
          <Pencil size={12} strokeWidth={1.5} />
        </button>
      </div>
    );
  }

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  if (field.type === "picklist") {
    return (
      <div onClick={stop} className="min-w-[150px]">
        <Select
          autoFocus
          disabled={busy}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            saveDraft(e.target.value);
          }}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setEditing(false);
          }}
          className="!py-1.5 text-sm"
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      </div>
    );
  }

  if (field.type === "lookup") {
    return (
      <div onClick={stop} className="min-w-[210px]">
        <SearchableSelect
          options={lookupOptions}
          value={draft}
          defaultOpen
          onChange={(v) => {
            setDraft(v);
            void commit(v === "" ? null : v);
          }}
          className="[&>button]:!py-1.5"
        />
      </div>
    );
  }

  if (field.type === "textarea") {
    return (
      <textarea
        autoFocus
        disabled={busy}
        rows={3}
        value={draft}
        onClick={stop}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => saveDraft(draft)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setEditing(false);
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) saveDraft(draft);
        }}
        className="w-full min-w-[220px] bg-[var(--section-darker)] border border-[var(--mint)] rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--foreground)] focus:outline-none resize-y"
      />
    );
  }

  const inputType =
    field.type === "date"
      ? "date"
      : field.type === "number" || field.type === "currency"
        ? "number"
        : "text";

  return (
    <div onClick={stop} className="min-w-[150px]">
      <Input
        autoFocus
        type={inputType}
        step={inputType === "number" ? "any" : undefined}
        disabled={busy}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => {
          if (inputType === "date") {
            try {
              e.currentTarget.showPicker?.();
            } catch {
              /* needs user activation; the calendar icon still works */
            }
          }
        }}
        onBlur={() => saveDraft(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") saveDraft(draft);
          if (e.key === "Escape") setEditing(false);
        }}
        className="!py-1.5 text-sm"
      />
    </div>
  );
}
