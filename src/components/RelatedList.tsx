import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, SOFT_DELETE_OBJECTS, type RelatedListDef } from "../lib/objects";
import { useLookupMaps } from "../lib/lookups";
import { Button, EmptyState } from "./ui";
import DataTable from "./DataTable";
import RecordForm from "./RecordForm";

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

  const columns = useMemo(
    () =>
      def.columns
        .map((c) => childDef.fields.find((f) => f.name === c))
        .filter((f): f is NonNullable<typeof f> => !!f),
    [def, childDef],
  );
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
          rows={rows}
          lookupMaps={lookupMaps}
          onRowClick={
            isNavObject ? (row) => navigate(`/${def.object}/${row.id}`) : undefined
          }
        />
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
