import { Check, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  CfInput,
  CustomFieldDef,
  CustomFieldValueRow,
} from "../lib/customFields";
import { OBJECTS } from "../lib/objects";
import { useLookupMaps, useLookupOptions } from "../lib/lookups";
import {
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  fmtNumber,
} from "../lib/format";
import { Badge, Input, Select, Textarea, Toggle } from "./ui";

/* ---------- Edit control ---------- */

function RelationshipSelect({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const target = def.related_object && OBJECTS[def.related_object] ? def.related_object : undefined;
  const options = useLookupOptions(target);
  if (!target) {
    return (
      <p className="text-xs text-[var(--text-faint)]">
        Unknown related object: {def.related_object ?? "—"}
      </p>
    );
  }
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— Select —</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </Select>
  );
}

export function CustomFieldInput({
  def,
  value,
  onChange,
}: {
  def: CustomFieldDef;
  value: CfInput;
  onChange: (v: CfInput) => void;
}) {
  let control;
  switch (def.field_type) {
    case "textarea":
      control = (
        <Textarea
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "picklist":
      control = (
        <Select
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">— Select —</option>
          {(def.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      );
      break;
    case "multi_picklist": {
      const selected = Array.isArray(value) ? value : [];
      control = (
        <div className="flex flex-wrap gap-2 pt-1">
          {(def.options ?? []).map((o) => {
            const active = selected.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() =>
                  onChange(
                    active
                      ? selected.filter((v) => v !== o.value)
                      : [...selected, o.value],
                  )
                }
                className={`px-2.5 py-1 text-xs rounded-[var(--radius-sm)] border cursor-pointer transition-colors font-[var(--font-mono)] uppercase tracking-wider ${
                  active
                    ? "bg-[rgba(60,201,152,0.12)] text-[var(--mint)] border-[rgba(60,201,152,0.35)]"
                    : "text-[var(--text-faint)] border-[rgba(255,255,255,0.1)] hover:text-[var(--foreground)]"
                }`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      );
      break;
    }
    case "boolean":
      control = (
        <div className="pt-1.5">
          <Toggle checked={Boolean(value)} onChange={(v) => onChange(v)} />
        </div>
      );
      break;
    case "relationship":
      control = (
        <RelationshipSelect
          def={def}
          value={String(value ?? "")}
          onChange={onChange}
        />
      );
      break;
    case "date":
      control = (
        <Input
          type="date"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "datetime":
      control = (
        <Input
          type="datetime-local"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "number":
    case "currency":
      control = (
        <Input
          type="number"
          step="any"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "integer":
      control = (
        <Input
          type="number"
          step={1}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    case "email":
      control = (
        <Input
          type="email"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
      break;
    default:
      control = (
        <Input
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
  return (
    <div>
      {control}
      {def.help_text && (
        <p className="text-[0.68rem] text-[var(--text-faint)] mt-1">
          {def.help_text}
        </p>
      )}
    </div>
  );
}

/* ---------- Display ---------- */

function RelationshipDisplay({
  def,
  id,
}: {
  def: CustomFieldDef;
  id: string;
}) {
  const target =
    def.related_object && OBJECTS[def.related_object]
      ? def.related_object
      : undefined;
  const maps = useLookupMaps(target ? [target] : []);
  if (!target) return <span className="text-[var(--text-muted)]">—</span>;
  const label = maps[target]?.[id];
  if (!label) return <span className="text-[var(--text-faint)]">…</span>;
  return (
    <Link
      to={`/${target}/${id}`}
      className="text-[var(--mint)] hover:underline cursor-pointer"
    >
      {label}
    </Link>
  );
}

export function CustomFieldDisplay({
  def,
  row,
}: {
  def: CustomFieldDef;
  row?: CustomFieldValueRow;
}) {
  const empty = <span className="text-[var(--text-muted)]">—</span>;
  if (!row) return empty;

  switch (def.field_type) {
    case "boolean":
      return row.value_boolean ? (
        <Check size={16} strokeWidth={2} className="text-[var(--mint)]" />
      ) : (
        <X size={16} strokeWidth={1.5} className="text-[var(--text-faint)]" />
      );
    case "multi_picklist": {
      const vals = Array.isArray(row.value_json)
        ? (row.value_json as string[])
        : [];
      if (vals.length === 0) return empty;
      const labelOf = (v: string) =>
        def.options?.find((o) => o.value === v)?.label ?? v;
      return (
        <span className="flex flex-wrap gap-1.5">
          {vals.map((v) => (
            <Badge key={v} value={labelOf(v)} />
          ))}
        </span>
      );
    }
    case "picklist": {
      if (!row.value_text) return empty;
      const label =
        def.options?.find((o) => o.value === row.value_text)?.label ??
        row.value_text;
      return <Badge value={label} />;
    }
    case "currency":
      return row.value_number == null ? (
        empty
      ) : (
        <span className="font-[var(--font-mono)] text-[0.82rem]">
          {fmtCurrency(Number(row.value_number))}
        </span>
      );
    case "number":
    case "integer":
      return row.value_number == null ? (
        empty
      ) : (
        <span className="font-[var(--font-mono)] text-[0.82rem]">
          {fmtNumber(Number(row.value_number))}
        </span>
      );
    case "date":
      return <span>{row.value_date ? fmtDate(row.value_date) : "—"}</span>;
    case "datetime":
      return <span>{row.value_date ? fmtDateTime(row.value_date) : "—"}</span>;
    case "relationship":
      return row.value_relation ? (
        <RelationshipDisplay def={def} id={row.value_relation} />
      ) : (
        empty
      );
    case "url": {
      if (!row.value_text) return empty;
      const href = row.value_text.startsWith("http")
        ? row.value_text
        : `https://${row.value_text}`;
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[var(--mint)] hover:underline cursor-pointer"
        >
          {row.value_text.replace(/^https?:\/\//, "").slice(0, 30)}
          <ExternalLink size={12} strokeWidth={1.5} />
        </a>
      );
    }
    case "email":
      return row.value_text ? (
        <a
          href={`mailto:${row.value_text}`}
          className="text-[var(--mint)] hover:underline cursor-pointer"
        >
          {row.value_text}
        </a>
      ) : (
        empty
      );
    case "phone":
      return row.value_text ? (
        <a
          href={`tel:${row.value_text}`}
          className="text-[var(--text-light)] hover:text-[var(--mint)] cursor-pointer transition-colors"
        >
          {row.value_text}
        </a>
      ) : (
        empty
      );
    case "textarea":
      return row.value_text ? (
        <span className="whitespace-pre-wrap text-[var(--text-mid)]">
          {row.value_text}
        </span>
      ) : (
        empty
      );
    default:
      return row.value_text ? <span>{row.value_text}</span> : empty;
  }
}
