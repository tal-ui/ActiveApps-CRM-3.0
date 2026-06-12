import { useMemo, useState, type FormEvent } from "react";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { NAV_OBJECTS, OBJECTS } from "../../lib/objects";
import {
  CUSTOM_FIELD_TYPES,
  useCustomFields,
  type CustomFieldDef,
  type CustomFieldType,
} from "../../lib/customFields";
import { titleCase } from "../../lib/format";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
} from "../../components/ui";

function toApiName(label: string): string {
  return (
    "cf_" +
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80)
  );
}

function FieldModal({
  objectName,
  field,
  nextSortOrder,
  onClose,
  onSaved,
}: {
  objectName: string;
  field: CustomFieldDef | null;
  nextSortOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!field;
  const [label, setLabel] = useState(field?.label ?? "");
  const [fieldName, setFieldName] = useState(field?.field_name ?? "");
  const [nameTouched, setNameTouched] = useState(isEdit);
  const [fieldType, setFieldType] = useState<CustomFieldType>(
    field?.field_type ?? "text",
  );
  const [required, setRequired] = useState(field?.is_required ?? false);
  const [active, setActive] = useState(field?.is_active ?? true);
  const [helpText, setHelpText] = useState(field?.help_text ?? "");
  const [defaultValue, setDefaultValue] = useState(field?.default_value ?? "");
  const [optionsText, setOptionsText] = useState(
    (field?.options ?? []).map((o) => o.label).join("\n"),
  );
  const [relatedObject, setRelatedObject] = useState(
    field?.related_object ?? "",
  );
  const [sortOrder, setSortOrder] = useState(
    field?.sort_order ?? nextSortOrder,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isPicklist = fieldType === "picklist" || fieldType === "multi_picklist";
  const isRelationship = fieldType === "relationship";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!label.trim()) {
      setError("Label is required.");
      return;
    }
    const apiName = (nameTouched ? fieldName : toApiName(label)).trim();
    if (!apiName) {
      setError("API name is required.");
      return;
    }
    if (isPicklist && !optionsText.trim()) {
      setError("Add at least one picklist option (one per line).");
      return;
    }
    if (isRelationship && !relatedObject) {
      setError("Select the related object.");
      return;
    }

    const options = isPicklist
      ? optionsText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean)
          .map((l) => ({
            label: l,
            value: l.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          }))
      : null;

    const now = Date.now();
    const payload = {
      object_name: objectName,
      field_name: apiName,
      label: label.trim(),
      field_type: fieldType,
      is_required: required,
      is_active: active,
      help_text: helpText.trim() || null,
      default_value: defaultValue.trim() || null,
      options,
      related_object: isRelationship ? relatedObject : null,
      related_display_field: isRelationship ? "name" : null,
      sort_order: sortOrder,
      updated_at: now,
    };

    setBusy(true);
    if (isEdit) {
      const { error } = await supabase
        .from("custom_fields")
        .update(payload)
        .eq("id", field!.id);
      setBusy(false);
      if (error) {
        setError(error.message);
        return;
      }
    } else {
      const { error } = await supabase
        .from("custom_fields")
        .insert({ ...payload, created_at: now });
      setBusy(false);
      if (error) {
        setError(error.message);
        return;
      }
    }
    onSaved();
  }

  async function onDelete() {
    setBusy(true);
    await supabase
      .from("custom_field_values")
      .delete()
      .eq("custom_field_id", field!.id);
    const { error } = await supabase
      .from("custom_fields")
      .delete()
      .eq("id", field!.id);
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    onSaved();
  }

  return (
    <Modal
      title={isEdit ? `Edit Field: ${field!.label}` : "New Custom Field"}
      onClose={onClose}
      wide
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          <div>
            <FieldLabel required>Label</FieldLabel>
            <Input
              value={label}
              onChange={(e) => {
                setLabel(e.target.value);
                if (!nameTouched) setFieldName(toApiName(e.target.value));
              }}
              placeholder="e.g. Industry Vertical"
            />
          </div>
          <div>
            <FieldLabel required>API Name</FieldLabel>
            <Input
              value={nameTouched ? fieldName : toApiName(label)}
              onChange={(e) => {
                setNameTouched(true);
                setFieldName(e.target.value);
              }}
              disabled={isEdit}
              className={isEdit ? "opacity-60" : ""}
            />
          </div>
          <div>
            <FieldLabel required>Field Type</FieldLabel>
            <Select
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
              disabled={isEdit}
              className={isEdit ? "opacity-60" : ""}
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>Sort Order</FieldLabel>
            <Input
              type="number"
              step={1}
              value={String(sortOrder)}
              onChange={(e) => setSortOrder(parseInt(e.target.value) || 0)}
            />
          </div>
          {isPicklist && (
            <div className="sm:col-span-2">
              <FieldLabel required>Options (one per line)</FieldLabel>
              <Textarea
                rows={4}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
                placeholder={"SaaS\nFinTech\nHealthcare"}
              />
            </div>
          )}
          {isRelationship && (
            <div>
              <FieldLabel required>Related Object</FieldLabel>
              <Select
                value={relatedObject}
                onChange={(e) => setRelatedObject(e.target.value)}
              >
                <option value="">— Select —</option>
                {NAV_OBJECTS.map((o) => (
                  <option key={o} value={o}>
                    {OBJECTS[o].plural}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <FieldLabel>Default Value</FieldLabel>
            <Input
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder={fieldType === "boolean" ? "true / false" : ""}
            />
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>Help Text</FieldLabel>
            <Input
              value={helpText}
              onChange={(e) => setHelpText(e.target.value)}
              placeholder="Shown under the field in forms"
            />
          </div>
        </div>

        <div className="flex items-center gap-8 pt-1">
          <Toggle checked={required} onChange={setRequired} label="Required" />
          <Toggle checked={active} onChange={setActive} label="Active" />
        </div>

        <div className="flex items-center justify-between pt-3">
          <div>
            {isEdit &&
              (confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[#F2697A]">
                    Deletes field + all its values.
                  </span>
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={onDelete}
                    disabled={busy}
                    className="!py-1.5"
                  >
                    Confirm Delete
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="subtle"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 size={14} strokeWidth={1.5} />
                  Delete
                </Button>
              ))}
          </div>
          <div className="flex gap-3">
            <Button type="button" variant="subtle" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : isEdit ? "Save Changes" : "Create Field"}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function CustomFieldsPage() {
  const [objectName, setObjectName] = useState("accounts");
  const { defs, refresh } = useCustomFields(objectName, true);
  const [editing, setEditing] = useState<CustomFieldDef | null>(null);
  const [showNew, setShowNew] = useState(false);

  const nextSortOrder = useMemo(
    () => (defs.length > 0 ? Math.max(...defs.map((d) => d.sort_order)) + 1 : 0),
    [defs],
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <SlidersHorizontal
              size={20}
              strokeWidth={1.5}
              className="text-[var(--mint)]"
            />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Custom Fields
            </h1>
            <p className="label-mono">
              Add fields to any object — no database changes needed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select
            value={objectName}
            onChange={(e) => setObjectName(e.target.value)}
            className="w-52"
          >
            {NAV_OBJECTS.map((o) => (
              <option key={o} value={o}>
                {OBJECTS[o].plural}
              </option>
            ))}
          </Select>
          <Button onClick={() => setShowNew(true)}>
            <Plus size={16} strokeWidth={2} />
            New Field
          </Button>
        </div>
      </div>

      {defs.length === 0 ? (
        <EmptyState
          message={`No custom fields on ${OBJECTS[objectName].plural} yet. Create the first one.`}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-[rgba(255,255,255,0.06)]">
          <table className="w-full">
            <thead>
              <tr className="bg-[var(--section-darker)] border-b border-[rgba(255,255,255,0.06)]">
                {["Label", "API Name", "Type", "Required", "Status"].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left font-[var(--font-mono)] font-medium text-[0.62rem] uppercase tracking-[0.15em] text-[var(--text-faint)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {defs.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => setEditing(f)}
                  className="border-b border-[rgba(255,255,255,0.04)] last:border-b-0 cursor-pointer transition-colors duration-200 hover:bg-[var(--navy-surface)]"
                >
                  <td className="px-4 py-3 text-sm text-[var(--text-light)]">
                    {f.label}
                  </td>
                  <td className="px-4 py-3 text-sm font-[var(--font-mono)] text-[0.78rem] text-[var(--text-dim)]">
                    {f.field_name}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-mid)]">
                    {titleCase(f.field_type)}
                    {f.field_type === "relationship" && f.related_object
                      ? ` → ${OBJECTS[f.related_object]?.plural ?? f.related_object}`
                      : ""}
                  </td>
                  <td className="px-4 py-3 text-sm text-[var(--text-mid)]">
                    {f.is_required ? "Yes" : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge value={f.is_active ? "active" : "inactive"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showNew || editing) && (
        <FieldModal
          objectName={objectName}
          field={editing}
          nextSortOrder={nextSortOrder}
          onClose={() => {
            setShowNew(false);
            setEditing(null);
          }}
          onSaved={() => {
            setShowNew(false);
            setEditing(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
