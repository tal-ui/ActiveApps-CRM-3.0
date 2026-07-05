import { useEffect, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import type { ObjectDef } from "../lib/objects";
import { useLookupOptions } from "../lib/lookups";
import { dateToMs, fmtDate } from "../lib/format";
import { Button, FieldLabel, Input, Select } from "./ui";

export type ListFilter = {
  field: string;
  op: "eq" | "range";
  value?: string;
  from?: string;
  to?: string;
};

const FILTERABLE_TYPES = ["picklist", "boolean", "lookup", "date"];

function FilterChip({
  def,
  filter,
  onRemove,
}: {
  def: ObjectDef;
  filter: ListFilter;
  onRemove: () => void;
}) {
  const field = def.fields.find((f) => f.name === filter.field);
  const lookupOptions = useLookupOptions(
    field?.type === "lookup" ? field.lookup : undefined,
  );

  let text = filter.value ?? "";
  if (field) {
    if (filter.op === "range") {
      text = `${filter.from ? fmtDate(dateToMs(filter.from)) : "…"} → ${
        filter.to ? fmtDate(dateToMs(filter.to)) : "…"
      }`;
    } else if (field.type === "boolean") {
      text = filter.value === "true" ? "Yes" : "No";
    } else if (field.type === "picklist") {
      text = field.options?.find((o) => o.value === filter.value)?.label ?? text;
    } else if (field.type === "lookup") {
      text = lookupOptions.find((o) => o.value === filter.value)?.label ?? text;
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 bg-[var(--navy-surface)] border border-[rgba(255,255,255,0.12)] rounded-full px-3 py-1 text-xs text-[var(--text-mid)]">
      <span className="truncate max-w-[220px]">
        {field?.label ?? filter.field}: {text}
      </span>
      <button
        onClick={onRemove}
        className="text-[var(--text-dim)] hover:text-[var(--foreground)] cursor-pointer transition-colors shrink-0"
        aria-label="Remove filter"
      >
        <X size={12} strokeWidth={1.5} />
      </button>
    </span>
  );
}

export default function FilterBar({
  def,
  filters,
  onChange,
}: {
  def: ObjectDef;
  filters: ListFilter[];
  onChange: (filters: ListFilter[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const fields = def.fields.filter(
    (f) => FILTERABLE_TYPES.includes(f.type) && !f.hidden,
  );
  const field = fields.find((f) => f.name === fieldName);
  const lookupOptions = useLookupOptions(
    field?.type === "lookup" ? field.lookup : undefined,
  );

  // Close the popover on any mousedown outside of it.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function reset() {
    setFieldName("");
    setValue("");
    setFrom("");
    setTo("");
  }

  function addFilter() {
    if (!field) return;
    const next: ListFilter =
      field.type === "date"
        ? { field: field.name, op: "range", from, to }
        : { field: field.name, op: "eq", value };
    onChange([...filters, next]);
    reset();
    setOpen(false);
  }

  const canAdd = field && (field.type === "date" ? Boolean(from || to) : value !== "");

  return (
    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
      <div ref={wrapRef} className="relative w-full sm:w-auto">
        <Button
          variant="ghost"
          onClick={() => {
            setOpen(!open);
            reset();
          }}
        >
          <Filter size={15} strokeWidth={1.5} />
          Add filter
        </Button>
        {open && (
          <div className="absolute left-0 right-0 sm:right-auto top-full mt-2 z-30 sm:w-72 bg-[var(--card)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-md)] p-3 space-y-3 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
            <div>
              <FieldLabel>Field</FieldLabel>
              <Select
                value={fieldName}
                onChange={(e) => {
                  setFieldName(e.target.value);
                  setValue("");
                  setFrom("");
                  setTo("");
                }}
              >
                <option value="">Select field…</option>
                {fields.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.label}
                  </option>
                ))}
              </Select>
            </div>
            {field?.type === "picklist" && (
              <div>
                <FieldLabel>Value</FieldLabel>
                <Select value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Select…</option>
                  {(field.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {field?.type === "boolean" && (
              <div>
                <FieldLabel>Value</FieldLabel>
                <Select value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Select…</option>
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </Select>
              </div>
            )}
            {field?.type === "lookup" && (
              <div>
                <FieldLabel>Value</FieldLabel>
                <Select value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Select…</option>
                  {lookupOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {field?.type === "date" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel>From</FieldLabel>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <FieldLabel>To</FieldLabel>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <Button disabled={!canAdd} onClick={addFilter}>
                Add
              </Button>
            </div>
          </div>
        )}
      </div>
      {filters.map((f, i) => (
        <FilterChip
          key={`${f.field}-${i}`}
          def={def}
          filter={f}
          onRemove={() => onChange(filters.filter((_, j) => j !== i))}
        />
      ))}
    </div>
  );
}
