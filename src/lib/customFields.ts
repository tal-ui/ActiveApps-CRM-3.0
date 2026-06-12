import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";
import {
  dateToMs,
  datetimeToMs,
  msToDateInput,
  msToDatetimeInput,
} from "./format";

export type CustomFieldType =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "currency"
  | "picklist"
  | "multi_picklist"
  | "date"
  | "datetime"
  | "boolean"
  | "relationship"
  | "url"
  | "email"
  | "phone";

export const CUSTOM_FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Text Area" },
  { value: "number", label: "Number" },
  { value: "integer", label: "Integer" },
  { value: "currency", label: "Currency" },
  { value: "picklist", label: "Picklist" },
  { value: "multi_picklist", label: "Multi-Select Picklist" },
  { value: "date", label: "Date" },
  { value: "datetime", label: "Date / Time" },
  { value: "boolean", label: "Checkbox" },
  { value: "relationship", label: "Relationship (Lookup)" },
  { value: "url", label: "URL" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
];

export interface CustomFieldDef {
  id: string;
  object_name: string;
  field_name: string;
  label: string;
  field_type: CustomFieldType;
  is_required: boolean;
  default_value: string | null;
  options: { label: string; value: string }[] | null;
  related_object: string | null;
  related_display_field: string | null;
  help_text: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface CustomFieldValueRow {
  id: string;
  custom_field_id: string;
  record_id: string;
  object_name: string;
  value_text: string | null;
  value_number: number | string | null;
  value_date: number | null;
  value_boolean: boolean | null;
  value_json: unknown;
  value_relation: string | null;
}

/** Raw input value held in form state */
export type CfInput = string | boolean | string[];

export function useCustomFields(
  objectName: string,
  includeInactive = false,
): { defs: CustomFieldDef[]; refresh: () => void } {
  const [defs, setDefs] = useState<CustomFieldDef[]>([]);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let mounted = true;
    let q = supabase
      .from("custom_fields")
      .select("*")
      .eq("object_name", objectName)
      .order("sort_order", { ascending: true });
    if (!includeInactive) q = q.eq("is_active", true);
    q.then(({ data }) => {
      if (mounted) setDefs((data ?? []) as CustomFieldDef[]);
    });
    return () => {
      mounted = false;
    };
  }, [objectName, includeInactive, version]);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  return { defs, refresh };
}

export async function fetchValueRows(
  objectName: string,
  recordId: string,
): Promise<Record<string, CustomFieldValueRow>> {
  const { data } = await supabase
    .from("custom_field_values")
    .select("*")
    .eq("object_name", objectName)
    .eq("record_id", recordId);
  const map: Record<string, CustomFieldValueRow> = {};
  for (const row of (data ?? []) as CustomFieldValueRow[]) {
    map[row.custom_field_id] = row;
  }
  return map;
}

export function rowToInput(
  def: CustomFieldDef,
  row?: CustomFieldValueRow,
): CfInput {
  if (!row) {
    if (def.field_type === "boolean") return def.default_value === "true";
    if (def.field_type === "multi_picklist") return [];
    return def.default_value ?? "";
  }
  switch (def.field_type) {
    case "boolean":
      return row.value_boolean ?? false;
    case "multi_picklist":
      return Array.isArray(row.value_json) ? (row.value_json as string[]) : [];
    case "number":
    case "integer":
    case "currency":
      return row.value_number != null ? String(row.value_number) : "";
    case "date":
      return row.value_date ? msToDateInput(row.value_date) : "";
    case "datetime":
      return row.value_date ? msToDatetimeInput(row.value_date) : "";
    case "relationship":
      return row.value_relation ?? "";
    default:
      return row.value_text ?? "";
  }
}

type ValueColumns = Pick<
  CustomFieldValueRow,
  | "value_text"
  | "value_number"
  | "value_date"
  | "value_boolean"
  | "value_json"
  | "value_relation"
>;

export function inputToColumns(
  def: CustomFieldDef,
  input: CfInput | undefined,
): ValueColumns {
  const cols: ValueColumns = {
    value_text: null,
    value_number: null,
    value_date: null,
    value_boolean: null,
    value_json: null,
    value_relation: null,
  };
  if (input === undefined) return cols;
  switch (def.field_type) {
    case "boolean":
      cols.value_boolean = Boolean(input);
      break;
    case "multi_picklist":
      cols.value_json = Array.isArray(input) ? input : [];
      break;
    case "number":
    case "integer":
    case "currency": {
      const s = String(input);
      cols.value_number = s === "" ? null : parseFloat(s);
      break;
    }
    case "date":
      cols.value_date = dateToMs(String(input));
      break;
    case "datetime":
      cols.value_date = datetimeToMs(String(input));
      break;
    case "relationship":
      cols.value_relation = String(input) || null;
      break;
    default:
      cols.value_text = String(input) || null;
  }
  return cols;
}

/** Persist all custom field inputs for a record. Returns an error message or null. */
export async function saveCustomValues(
  objectName: string,
  recordId: string,
  defs: CustomFieldDef[],
  inputs: Record<string, CfInput>,
  existing: Record<string, string>, // custom_field_id -> value row id
): Promise<string | null> {
  const now = Date.now();
  for (const def of defs) {
    const cols = inputToColumns(def, inputs[def.id]);
    const existingId = existing[def.id];
    if (existingId) {
      const { error } = await supabase
        .from("custom_field_values")
        .update({ ...cols, updated_at: now })
        .eq("id", existingId);
      if (error) return error.message;
    } else {
      const hasValue =
        cols.value_text != null ||
        cols.value_number != null ||
        cols.value_date != null ||
        cols.value_boolean != null ||
        (Array.isArray(cols.value_json) && cols.value_json.length > 0) ||
        cols.value_relation != null;
      if (!hasValue) continue;
      const { error } = await supabase.from("custom_field_values").insert({
        custom_field_id: def.id,
        record_id: recordId,
        object_name: objectName,
        ...cols,
        created_at: now,
        updated_at: now,
      });
      if (error) return error.message;
    }
  }
  return null;
}

/** Validate required custom fields. Returns the first missing label or null. */
export function missingRequired(
  defs: CustomFieldDef[],
  inputs: Record<string, CfInput>,
): string | null {
  for (const def of defs) {
    if (!def.is_required) continue;
    const v = inputs[def.id];
    if (def.field_type === "boolean") continue;
    if (def.field_type === "multi_picklist") {
      if (!Array.isArray(v) || v.length === 0) return def.label;
    } else if (v === undefined || v === "") {
      return def.label;
    }
  }
  return null;
}
