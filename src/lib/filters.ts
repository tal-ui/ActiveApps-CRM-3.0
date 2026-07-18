import type { FieldDef, FieldType } from "./objects";
import { dateToMs } from "./format";

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "ncontains"
  | "gt"
  | "lt"
  | "range";

export type ListFilter = {
  field: string;
  op: FilterOp;
  value?: string;
  from?: string;
  to?: string;
};

const DAY_MS = 86399999;

/** Operators offered per field type, in menu order. */
export function opsForType(t: FieldType): { value: FilterOp; label: string }[] {
  switch (t) {
    case "number":
    case "currency":
      return [
        { value: "eq", label: "equals" },
        { value: "neq", label: "not equals" },
        { value: "gt", label: "greater than" },
        { value: "lt", label: "less than" },
      ];
    case "date":
      return [
        { value: "eq", label: "on" },
        { value: "gt", label: "after" },
        { value: "lt", label: "before" },
        { value: "range", label: "between" },
      ];
    case "picklist":
    case "lookup":
    case "boolean":
      return [
        { value: "eq", label: "is" },
        { value: "neq", label: "is not" },
      ];
    default:
      return [
        { value: "contains", label: "contains" },
        { value: "ncontains", label: "doesn't contain" },
        { value: "eq", label: "equals" },
        { value: "neq", label: "not equals" },
      ];
  }
}

/** Short operator text for filter chips. */
export function opChipLabel(op: FilterOp, t: FieldType | undefined): string {
  switch (op) {
    case "contains":
      return "contains";
    case "ncontains":
      return "excludes";
    case "neq":
      return t === "picklist" || t === "lookup" || t === "boolean" ? "is not" : "≠";
    case "gt":
      return t === "date" ? "after" : ">";
    case "lt":
      return t === "date" ? "before" : "<";
    case "range":
      return "";
    default:
      return t === "picklist" || t === "lookup" || t === "boolean"
        ? "is"
        : t === "date"
          ? "on"
          : "=";
  }
}

/** Client-side filter evaluation over a loaded record. */
export function matchesFilter(
  r: Record<string, unknown>,
  f: ListFilter,
  fd: FieldDef | undefined,
): boolean {
  const raw = r[f.field];
  const t = fd?.type;

  if (f.op === "range") {
    if (raw == null) return false;
    const v = Number(raw);
    const fromMs = f.from ? dateToMs(f.from) : null;
    const toMs = f.to ? dateToMs(f.to) : null;
    if (fromMs != null && !(v >= fromMs)) return false;
    if (toMs != null && !(v <= toMs + DAY_MS)) return false;
    return true;
  }

  if (t === "date") {
    const dayStart = f.value ? dateToMs(f.value) : null;
    if (dayStart == null) return true;
    if (raw == null) return false;
    const v = Number(raw);
    if (f.op === "gt") return v > dayStart + DAY_MS;
    if (f.op === "lt") return v < dayStart;
    return v >= dayStart && v <= dayStart + DAY_MS;
  }

  if (t === "number" || t === "currency") {
    const n = f.value === undefined || f.value === "" ? null : Number(f.value);
    if (n == null || Number.isNaN(n)) return true;
    if (raw == null || raw === "") return f.op === "neq";
    const v = Number(raw);
    if (f.op === "neq") return v !== n;
    if (f.op === "gt") return v > n;
    if (f.op === "lt") return v < n;
    return v === n;
  }

  if (t === "boolean") {
    const want = f.value === "true";
    const v = Boolean(raw);
    return f.op === "neq" ? v !== want : v === want;
  }

  const s = String(raw ?? "").toLowerCase();
  const q = String(f.value ?? "").toLowerCase();
  switch (f.op) {
    case "contains":
      return s.includes(q);
    case "ncontains":
      return !s.includes(q);
    case "neq":
      return s !== q;
    default:
      return s === q;
  }
}
