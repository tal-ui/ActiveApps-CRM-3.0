import { useEffect, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import type { ObjectDef } from "../lib/objects";
import { useLookupOptions } from "../lib/lookups";
import {
  opsForType,
  opChipLabel,
  type FilterOp,
  type ListFilter,
} from "../lib/filters";
import { dateToMs, fmtDate, fmtNumber } from "../lib/format";
import { Button, FieldLabel, Input, Select } from "./ui";
import SearchableSelect from "./SearchableSelect";

export type { ListFilter } from "../lib/filters";

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
    } else if (field.type === "date") {
      text = filter.value ? fmtDate(dateToMs(filter.value)) : "";
    } else if (field.type === "boolean") {
      text = filter.value === "true" ? "Yes" : "No";
    } else if (field.type === "picklist") {
      text = field.options?.find((o) => o.value === filter.value)?.label ?? text;
    } else if (field.type === "lookup") {
      text = lookupOptions.find((o) => o.value === filter.value)?.label ?? text;
    } else if (field.type === "number" || field.type === "currency") {
      text = filter.value ? fmtNumber(Number(filter.value)) : "";
    }
  }
  const opText = field ? opChipLabel(filter.op, field.type) : filter.op;

  return (
    <span className="inline-flex items-center gap-1.5 bg-[var(--navy-surface)] border border-[rgba(255,255,255,0.12)] rounded-full px-3 py-1 text-xs text-[var(--text-mid)]">
      <span className="truncate max-w-[240px]">
        {field?.label ?? filter.field} {opText} {text}
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
  const [op, setOp] = useState<FilterOp>("eq");
  const [value, setValue] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);

  const fields = def.fields.filter((f) => !f.hidden);
  const field = fields.find((f) => f.name === fieldName);
  const ops = field ? opsForType(field.type) : [];
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
    setOp("eq");
    setValue("");
    setFrom("");
    setTo("");
  }

  function addFilter() {
    if (!field) return;
    const next: ListFilter =
      op === "range"
        ? { field: field.name, op, from, to }
        : { field: field.name, op, value };
    onChange([...filters, next]);
    reset();
    setOpen(false);
  }

  const canAdd =
    field && (op === "range" ? Boolean(from || to) : value !== "");

  const valueEditor = (() => {
    if (!field) return null;
    if (op === "range") {
      return (
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
      );
    }
    switch (field.type) {
      case "date":
        return (
          <Input type="date" value={value} onChange={(e) => setValue(e.target.value)} />
        );
      case "number":
      case "currency":
        return (
          <Input
            type="number"
            step="any"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Value"
          />
        );
      case "picklist":
        return (
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        );
      case "boolean":
        return (
          <Select value={value} onChange={(e) => setValue(e.target.value)}>
            <option value="">Select…</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </Select>
        );
      case "lookup":
        return (
          <SearchableSelect
            options={lookupOptions}
            value={value}
            onChange={setValue}
            placeholder="Search…"
          />
        );
      default:
        return (
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Text…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canAdd) addFilter();
            }}
          />
        );
    }
  })();

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
          <div className="absolute left-0 right-0 sm:right-auto top-full mt-2 z-30 sm:w-80 bg-[var(--card)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-md)] p-3 space-y-3 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
            <div>
              <FieldLabel>Field</FieldLabel>
              <Select
                value={fieldName}
                onChange={(e) => {
                  const f = fields.find((x) => x.name === e.target.value);
                  setFieldName(e.target.value);
                  setOp(f ? opsForType(f.type)[0].value : "eq");
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
            {field && (
              <div>
                <FieldLabel>Operator</FieldLabel>
                <Select
                  value={op}
                  onChange={(e) => {
                    setOp(e.target.value as FilterOp);
                    if (e.target.value === "range") setValue("");
                    else {
                      setFrom("");
                      setTo("");
                    }
                  }}
                >
                  {ops.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {field && (
              <div>
                {op !== "range" && <FieldLabel>Value</FieldLabel>}
                {valueEditor}
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
