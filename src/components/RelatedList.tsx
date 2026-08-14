import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  OBJECTS,
  SOFT_DELETE_OBJECTS,
  type FieldDef,
  type RelatedListDef,
} from "../lib/objects";
import { invalidateLookup, useLookupMaps } from "../lib/lookups";
import { Button, ConfirmModal, EmptyState } from "./ui";
import DataTable from "./DataTable";
import RecordForm from "./RecordForm";

/**
 * A time entry that has been billed sits behind a frozen invoice line: editing
 * its hours still moves the summary's rolled-up sub-total, but the invoice's
 * own subtotal — and any tax document issued from it — does not follow. There
 * is no DB trigger stopping this, so the warning is the guard.
 */
function isBilled(row: Record<string, unknown> | undefined, object: string) {
  return object === "time_entries" && !!row?.invoice_id;
}

export default function RelatedList({
  def,
  parentId,
  onChanged,
}: {
  def: RelatedListDef;
  parentId: string;
  // Notifies the parent page after a child record is saved — needed when DB
  // triggers roll child values up into the parent (e.g. quote totals).
  onChanged?: () => void;
}) {
  const childDef = OBJECTS[def.object];
  const navigate = useNavigate();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [reload, setReload] = useState(0);
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  // Asked once per list, then remembered — a confirmation on every cell would
  // just train people to click through it.
  const [askBilled, setAskBilled] = useState(false);
  const billedAcked = useRef(false);
  const billedResolve = useRef<((ok: boolean) => void) | null>(null);

  const editable = (def.editableFields?.length ?? 0) > 0;

  const columns = useMemo(() => {
    const found = def.columns
      .map((c) => childDef.fields.find((f) => f.name === c))
      .filter((f): f is FieldDef => !!f);
    if (!editable) return found;
    // Anything outside the allow-list is presented read-only, so DataTable
    // skips it exactly as it already skips DB-computed fields.
    return found.map((f) =>
      def.editableFields!.includes(f.name) ? f : { ...f, readOnly: true },
    );
  }, [def, childDef, editable]);
  const lookupObjects = useMemo(
    () =>
      Array.from(
        new Set(
          columns
            .filter((c) => c.type === "lookup" && c.lookup)
            .map((c) => c.lookup as string),
        ),
      ),
    [columns],
  );
  const lookupMaps = useLookupMaps(lookupObjects);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Many-to-many lists resolve their ids through the junction first; the
      // child carries no foreign key back to this record.
      let ids: string[] | null = null;
      if (def.through) {
        const { data: links } = await supabase
          .from(def.through.table)
          .select(def.through.childKey)
          .eq(def.through.parentKey, parentId)
          .limit(500);
        ids = ((links ?? []) as unknown as Record<string, unknown>[]).map((l) =>
          String(l[def.through!.childKey]),
        );
        // No links means no rows — skip the query rather than asking for
        // `id in ()`, which PostgREST rejects.
        if (ids.length === 0) {
          if (!cancelled) setRows([]);
          return;
        }
      }

      let q = supabase.from(def.object).select("*");
      q = ids ? q.in("id", ids) : q.eq(def.foreignKey, parentId);
      if (SOFT_DELETE_OBJECTS.has(def.object)) q = q.eq("is_deleted", false);
      const { data } = await q.order("created_at", { ascending: false }).limit(200);
      if (!cancelled) setRows((data ?? []) as Record<string, unknown>[]);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [def, parentId, reload]);

  /* Sorting is client-side over the (capped) loaded rows. Lookups sort by the
     label the user can actually see — the stored value is an opaque id. */
  const sorted = useMemo(() => {
    if (!sortField) return rows;
    const field = columns.find((c) => c.name === sortField);
    if (!field) return rows;
    const key = (row: Record<string, unknown>): string | number | null => {
      const raw = row[field.name];
      if (field.type === "lookup" && field.lookup) {
        const label = lookupMaps[field.lookup]?.[String(raw ?? "")] ?? "";
        return label ? label.toLowerCase() : null;
      }
      if (raw == null) return null;
      return typeof raw === "number" ? raw : String(raw).toLowerCase();
    };
    return [...rows].sort((a, b) => {
      const av = key(a);
      const bv = key(b);
      // Blanks last in both directions — they are absence, not a low value.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
  }, [rows, columns, sortField, sortAsc, lookupMaps]);

  function askBilledConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      billedResolve.current = resolve;
      setAskBilled(true);
    });
  }

  function closeBilled(ok: boolean) {
    setAskBilled(false);
    if (ok) billedAcked.current = true;
    billedResolve.current?.(ok);
    billedResolve.current = null;
  }

  async function saveCell(
    rowId: string,
    field: FieldDef,
    value: unknown,
  ): Promise<string | null> {
    const row = rows.find((r) => String(r.id) === rowId);
    if (isBilled(row, def.object) && !billedAcked.current) {
      // Cancel returns null, not an error: nothing went wrong, the user
      // simply changed their mind.
      if (!(await askBilledConfirm())) return null;
    }
    const { error } = await supabase
      .from(def.object)
      .update({ [field.name]: value, updated_at: Date.now() })
      .eq("id", rowId);
    if (error) return error.message;
    setRows((rs) =>
      rs.map((r) => (String(r.id) === rowId ? { ...r, [field.name]: value } : r)),
    );
    invalidateLookup(def.object);
    // The parent's totals are DB roll-ups of these rows, and they are sitting
    // directly above this table.
    onChanged?.();
    return null;
  }

  const Icon = childDef.icon;
  const isNavObject = !!childDef.inNav;

  return (
    <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Icon size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            {def.title ?? childDef.plural}
          </h3>
          <span className="label-mono">({rows.length})</span>
        </div>
        {/* Junction-backed lists are derived from other data — there is no
            meaningful record to create from here. */}
        {!def.through && (
          <Button variant="ghost" onClick={() => setShowForm(true)} className="!px-3 !py-1.5">
            <Plus size={14} strokeWidth={2} />
            Add
          </Button>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState message={`No ${(def.title ?? childDef.plural).toLowerCase()} yet.`} />
      ) : (
        <DataTable
          columns={columns}
          rows={sorted}
          lookupMaps={lookupMaps}
          onRowClick={
            isNavObject ? (row) => navigate(`/${def.object}/${row.id}`) : undefined
          }
          sortField={sortField ?? undefined}
          sortAsc={sortAsc}
          onSort={(f) => {
            if (sortField === f) setSortAsc((a) => !a);
            else {
              setSortField(f);
              setSortAsc(true);
            }
          }}
          editable={editable}
          onSaveCell={editable ? saveCell : undefined}
        />
      )}

      {askBilled && (
        <ConfirmModal
          title="This entry is already billed"
          confirmLabel="Edit anyway"
          onConfirm={() => closeBilled(true)}
          onClose={() => closeBilled(false)}
        >
          <p>
            These hours are on an invoice. Changing them moves this summary's
            totals, but the invoice keeps the amount it was generated with — and
            so does any tax document issued from it.
          </p>
          <p>
            Fix the invoice too, or the two will disagree. Later edits in this
            list won't ask again.
          </p>
        </ConfirmModal>
      )}

      {showForm && (
        <RecordForm
          object={def.object}
          record={null}
          prefill={{ [def.foreignKey]: parentId }}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            setReload((r) => r + 1);
            onChanged?.();
          }}
        />
      )}
    </section>
  );
}
