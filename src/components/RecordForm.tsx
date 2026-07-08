import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, recordTitle, type FieldDef } from "../lib/objects";
import { dateToMs, msToDateInput } from "../lib/format";
import { invalidateLookup, useLookupOptions, type LookupOption } from "../lib/lookups";
import { useAuth } from "../lib/auth";
import {
  fetchValueRows,
  missingRequired,
  rowToInput,
  saveCustomValues,
  useCustomFields,
  type CfInput,
} from "../lib/customFields";
import { CustomFieldInput } from "./customFields";
import SearchableSelect from "./SearchableSelect";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
} from "./ui";

function LookupSelect({
  field,
  value,
  parentValue,
  onChange,
}: {
  field: FieldDef;
  value: string;
  // Value of the field this lookup dependsOn (when the descriptor is set)
  parentValue?: string;
  onChange: (v: string) => void;
}) {
  // refreshKey forces the options to re-fetch after a quick-create.
  const [refreshKey, setRefreshKey] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const cached = useLookupOptions(field.lookup, refreshKey);
  const [filtered, setFiltered] = useState<LookupOption[] | null>(null);
  const targetDef = field.lookup ? OBJECTS[field.lookup] : undefined;

  // Dependent lookup: scope options to rows matching the parent field's value
  // (e.g. only the selected account's open projects).
  useEffect(() => {
    const dep = field.dependsOn;
    if (!dep || !parentValue || !field.lookup || !targetDef) {
      setFiltered(null);
      return;
    }
    let cancelled = false;
    const cols = ["id", ...targetDef.titleFields.filter((t) => t !== "id")].join(",");
    let q = supabase.from(field.lookup).select(cols).eq(dep.column, parentValue);
    if (dep.exclude) {
      q = q.not(dep.exclude.column, "in", `(${dep.exclude.values.join(",")})`);
    }
    q.order("updated_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        const rows = (data ?? []) as unknown as Record<string, unknown>[];
        setFiltered(
          rows.map((r) => ({ value: String(r.id), label: recordTitle(targetDef, r) })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [field, parentValue, targetDef, refreshKey]);

  const scoped = field.dependsOn && parentValue ? (filtered ?? []) : cached;
  // Keep the current selection visible even when the filter excludes it
  // (e.g. editing an old task whose project has since been completed).
  const options =
    value && !scoped.some((o) => o.value === value)
      ? [...scoped, ...cached.filter((o) => o.value === value)]
      : scoped;

  return (
    <>
      <div className="flex gap-2">
        <SearchableSelect
          options={options}
          value={value}
          onChange={onChange}
          placeholder={
            targetDef ? `Search ${targetDef.plural.toLowerCase()}…` : "— Select —"
          }
          className="flex-1 min-w-0"
        />
        {targetDef && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            title={`New ${targetDef.singular}`}
            aria-label={`New ${targetDef.singular}`}
            className="flex shrink-0 items-center justify-center w-10 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
          >
            <Plus size={16} strokeWidth={1.8} />
          </button>
        )}
      </div>
      {showCreate && field.lookup && (
        <RecordForm
          object={field.lookup}
          record={null}
          prefill={
            field.dependsOn && parentValue
              ? { [field.dependsOn.column]: parentValue }
              : undefined
          }
          onClose={() => setShowCreate(false)}
          onSaved={(id) => {
            invalidateLookup(field.lookup!);
            setRefreshKey((k) => k + 1);
            onChange(id);
            setShowCreate(false);
          }}
        />
      )}
    </>
  );
}

export default function RecordForm({
  object,
  record,
  prefill,
  onClose,
  onSaved,
}: {
  object: string;
  record: Record<string, unknown> | null;
  prefill?: Record<string, unknown>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const def = OBJECTS[object];
  const { profile } = useAuth();
  const isEdit = !!record;

  const formFields = useMemo(
    () => def.fields.filter((f) => !f.hidden && !f.readOnly),
    [def],
  );

  const [values, setValues] = useState<Record<string, string | boolean>>(() => {
    const v: Record<string, string | boolean> = {};
    for (const f of formFields) {
      const source = record?.[f.name] ?? prefill?.[f.name] ?? f.defaultValue;
      if (f.type === "boolean") {
        v[f.name] = Boolean(source ?? false);
      } else if (f.type === "date") {
        v[f.name] = source ? msToDateInput(Number(source)) : "";
      } else {
        v[f.name] = source != null ? String(source) : "";
      }
    }
    return v;
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Reverse-fill dependent-lookup parents that arrived empty — e.g. "Add
  // Task" from a Project record prefills project_id, so auto-populate
  // account_id from that project. Runs once with the initial values.
  useEffect(() => {
    for (const f of formFields) {
      const dep = f.dependsOn;
      const child = values[f.name];
      if (!dep || !child || values[dep.field] || !f.lookup) continue;
      supabase
        .from(f.lookup)
        .select(dep.column)
        .eq("id", String(child))
        .maybeSingle()
        .then(({ data }) => {
          const pv = (data as unknown as Record<string, unknown> | null)?.[dep.column];
          if (pv != null) {
            setValues((prev) =>
              prev[dep.field] ? prev : { ...prev, [dep.field]: String(pv) },
            );
          }
        });
    }
    // mount-time backfill only — later changes are handled in onChange
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Custom fields (EAV)
  const { defs: customDefs } = useCustomFields(object);
  const [cfInputs, setCfInputs] = useState<Record<string, CfInput>>({});
  const [cfExisting, setCfExisting] = useState<Record<string, string>>({});

  useEffect(() => {
    if (customDefs.length === 0) return;
    if (!record) {
      // defaults for create
      setCfInputs((prev) => {
        const next = { ...prev };
        for (const def of customDefs) {
          if (!(def.id in next)) next[def.id] = rowToInput(def);
        }
        return next;
      });
      return;
    }
    fetchValueRows(object, record.id as string).then((rows) => {
      const inputs: Record<string, CfInput> = {};
      const existing: Record<string, string> = {};
      for (const def of customDefs) {
        const row = rows[def.id];
        inputs[def.id] = rowToInput(def, row);
        if (row) existing[def.id] = row.id;
      }
      setCfInputs(inputs);
      setCfExisting(existing);
    });
  }, [customDefs, record, object]);

  function set(name: string, value: string | boolean) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    // Validate
    for (const f of formFields) {
      if (f.required) {
        const v = values[f.name];
        if (f.type !== "boolean" && (v === "" || v === null || v === undefined)) {
          setError(`${f.label} is required.`);
          return;
        }
      }
    }
    const missingCf = missingRequired(customDefs, cfInputs);
    if (missingCf) {
      setError(`${missingCf} is required.`);
      return;
    }

    // Build payload
    const payload: Record<string, unknown> = {};
    for (const f of formFields) {
      const v = values[f.name];
      if (f.type === "boolean") {
        payload[f.name] = Boolean(v);
      } else if (f.type === "date") {
        payload[f.name] = v ? dateToMs(String(v)) : null;
      } else if (f.type === "number" || f.type === "currency") {
        payload[f.name] = v === "" ? null : parseFloat(String(v));
      } else if (f.type === "lookup") {
        payload[f.name] = v === "" ? null : v;
      } else {
        payload[f.name] = v === "" ? null : v;
      }
    }

    // Auto-compute line item totals
    if (object === "opportunity_line_items" || object === "invoice_line_items" || object === "quote_line_items") {
      const qty = Number(payload.quantity ?? 0);
      const price = Number(payload.unit_price ?? 0);
      const discount = Number(payload.discount ?? 0);
      if (!payload.total_price) {
        payload.total_price = +(qty * price * (1 - discount / 100)).toFixed(2);
      }
    }

    // invoice_line_items and quote_line_items have no updated_at column in the schema
    if (object !== "invoice_line_items" && object !== "quote_line_items") payload.updated_at = Date.now();
    if (!isEdit) {
      payload.created_at = Date.now();
      for (const ownerField of def.ownerFields ?? []) {
        payload[ownerField] = profile?.id ?? "system";
      }
    }

    setBusy(true);
    let savedId = record?.id as string | undefined;
    if (isEdit) {
      const { error } = await supabase
        .from(object)
        .update(payload)
        .eq("id", record!.id as string);
      if (error) {
        setBusy(false);
        setError(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from(object)
        .insert(payload)
        .select("id")
        .single();
      if (error) {
        setBusy(false);
        setError(error.message);
        return;
      }
      savedId = (data as { id: string }).id;
    }

    // Persist custom field values
    if (customDefs.length > 0 && savedId) {
      const cfError = await saveCustomValues(
        object,
        savedId,
        customDefs,
        cfInputs,
        cfExisting,
      );
      if (cfError) {
        setBusy(false);
        setError(`Record saved, but custom fields failed: ${cfError}`);
        return;
      }
    }

    setBusy(false);
    invalidateLookup(object);
    onSaved(savedId!);
  }

  return (
    <Modal
      title={isEdit ? `Edit ${def.singular}` : `New ${def.singular}`}
      onClose={onClose}
      wide
    >
      <form onSubmit={onSubmit}>
        {error && (
          <div className="mb-4">
            <ErrorNote message={error} />
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
          {formFields.map((f) => (
            <div
              key={f.name}
              className={f.type === "textarea" ? "sm:col-span-2" : ""}
            >
              <FieldLabel required={f.required}>{f.label}</FieldLabel>
              {f.type === "textarea" ? (
                <Textarea
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              ) : f.type === "picklist" ? (
                <Select
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                >
                  <option value="">— Select —</option>
                  {f.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : f.type === "lookup" ? (
                <LookupSelect
                  field={f}
                  value={String(values[f.name] ?? "")}
                  parentValue={
                    f.dependsOn ? String(values[f.dependsOn.field] ?? "") : undefined
                  }
                  onChange={(v) => {
                    set(f.name, v);
                    // User changed a parent field — reset its dependents
                    for (const other of formFields) {
                      if (other.dependsOn?.field === f.name && values[other.name]) {
                        set(other.name, "");
                      }
                    }
                    // Dependent picked while its parent is empty — fill the
                    // parent from the chosen row (e.g. project → account)
                    const dep = f.dependsOn;
                    if (dep && v && !values[dep.field] && f.lookup) {
                      supabase
                        .from(f.lookup)
                        .select(dep.column)
                        .eq("id", v)
                        .maybeSingle()
                        .then(({ data }) => {
                          const pv = (data as unknown as Record<string, unknown> | null)?.[dep.column];
                          if (pv != null) set(dep.field, String(pv));
                        });
                    }
                  }}
                />
              ) : f.type === "boolean" ? (
                <div className="pt-1.5">
                  <Toggle
                    checked={Boolean(values[f.name])}
                    onChange={(v) => set(f.name, v)}
                  />
                </div>
              ) : (
                <Input
                  type={
                    f.type === "date"
                      ? "date"
                      : f.type === "number" || f.type === "currency"
                        ? "number"
                        : f.type === "email"
                          ? "email"
                          : "text"
                  }
                  step={f.type === "number" || f.type === "currency" ? "any" : undefined}
                  value={String(values[f.name] ?? "")}
                  onChange={(e) => set(f.name, e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
        {customDefs.length > 0 && (
          <>
            <div className="flex items-center gap-3 mt-7 mb-4">
              <span className="label-mono">Custom Fields</span>
              <div className="h-px flex-1 bg-[rgba(255,255,255,0.06)]" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-4">
              {customDefs.map((cf) => (
                <div
                  key={cf.id}
                  className={
                    cf.field_type === "textarea" || cf.field_type === "multi_picklist"
                      ? "sm:col-span-2"
                      : ""
                  }
                >
                  <FieldLabel required={cf.is_required}>{cf.label}</FieldLabel>
                  <CustomFieldInput
                    def={cf}
                    value={cfInputs[cf.id] ?? rowToInput(cf)}
                    onChange={(v) =>
                      setCfInputs((prev) => ({ ...prev, [cf.id]: v }))
                    }
                  />
                </div>
              ))}
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 mt-7">
          <Button type="button" variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save Changes" : `Create ${def.singular}`}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
