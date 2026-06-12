import { supabase } from "./supabase";
import type { ObjectDef } from "./objects";
import type { CustomFieldDef } from "./customFields";

/** Layout field entries reference standard fields by name, custom fields as "cf:<id>" */
export interface LayoutFieldEntry {
  fieldName: string;
  column: number;
  sortOrder: number;
  isRequired: boolean;
  isReadOnly: boolean;
  isVisible: boolean;
  span: 1 | 2;
}

export interface LayoutSection {
  id: string;
  title: string;
  columns: 1 | 2;
  collapsed?: boolean;
  sortOrder: number;
  fields: LayoutFieldEntry[];
}

export interface LayoutRelatedList {
  objectName: string;
  title: string;
  columns: string[];
  sortOrder: number;
  hidden?: boolean;
}

export interface LayoutJson {
  sections: LayoutSection[];
  relatedLists: LayoutRelatedList[];
}

export const CF_PREFIX = "cf:";

export function isCustomFieldName(fieldName: string): boolean {
  return fieldName.startsWith(CF_PREFIX);
}

export function customFieldId(fieldName: string): string {
  return fieldName.slice(CF_PREFIX.length);
}

function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

/** Build the default layout from the object registry + custom field definitions. */
export function defaultLayoutFor(
  def: ObjectDef,
  customDefs: CustomFieldDef[],
): LayoutJson {
  const sections: LayoutSection[] = [];
  const bySection = new Map<string, LayoutFieldEntry[]>();
  for (const f of def.fields) {
    if (f.hidden) continue;
    if (!bySection.has(f.section)) bySection.set(f.section, []);
    const list = bySection.get(f.section)!;
    list.push({
      fieldName: f.name,
      column: list.length % 2,
      sortOrder: list.length,
      isRequired: !!f.required,
      isReadOnly: false,
      isVisible: true,
      span: f.type === "textarea" ? 2 : 1,
    });
  }
  let i = 0;
  for (const [title, fields] of bySection.entries()) {
    sections.push({ id: uid(), title, columns: 2, sortOrder: i++, fields });
  }
  if (customDefs.length > 0) {
    sections.push({
      id: uid(),
      title: "Custom Fields",
      columns: 2,
      sortOrder: i++,
      fields: customDefs.map((cf, idx) => ({
        fieldName: `${CF_PREFIX}${cf.id}`,
        column: idx % 2,
        sortOrder: idx,
        isRequired: cf.is_required,
        isReadOnly: false,
        isVisible: true,
        span: cf.field_type === "textarea" ? 2 : 1,
      })),
    });
  }
  const relatedLists: LayoutRelatedList[] = (def.relatedLists ?? []).map(
    (rl, idx) => ({
      objectName: rl.object,
      title: rl.title ?? rl.object,
      columns: rl.columns,
      sortOrder: idx,
      hidden: false,
    }),
  );
  return { sections, relatedLists };
}

export function newSection(sortOrder: number): LayoutSection {
  return { id: uid(), title: "New Section", columns: 2, sortOrder, fields: [] };
}

export async function fetchDefaultLayout(
  objectName: string,
): Promise<{ id: string; layout: LayoutJson } | null> {
  const { data } = await supabase
    .from("page_layouts")
    .select("id, layout")
    .eq("object_name", objectName)
    .eq("is_default", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const layout = (data as { layout: LayoutJson }).layout;
  if (!layout || !Array.isArray(layout.sections)) return null;
  return {
    id: (data as { id: string }).id,
    layout: { sections: layout.sections, relatedLists: layout.relatedLists ?? [] },
  };
}

export async function saveLayout(
  objectName: string,
  layout: LayoutJson,
  layoutId: string | null,
  userId: string,
): Promise<{ id: string | null; error: string | null }> {
  const now = Date.now();
  // Normalize sort orders and columns
  const normalized: LayoutJson = {
    sections: layout.sections.map((s, si) => ({
      ...s,
      sortOrder: si,
      fields: s.fields.map((f, fi) => ({
        ...f,
        sortOrder: fi,
        column: fi % s.columns,
      })),
    })),
    relatedLists: layout.relatedLists.map((rl, ri) => ({ ...rl, sortOrder: ri })),
  };
  if (layoutId) {
    const { error } = await supabase
      .from("page_layouts")
      .update({ layout: normalized, updated_at: now })
      .eq("id", layoutId);
    return { id: layoutId, error: error?.message ?? null };
  }
  const { data, error } = await supabase
    .from("page_layouts")
    .insert({
      object_name: objectName,
      name: "Default",
      is_default: true,
      layout: normalized,
      created_by_id: userId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  return {
    id: data ? (data as { id: string }).id : null,
    error: error?.message ?? null,
  };
}
