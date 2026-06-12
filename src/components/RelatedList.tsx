import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, type RelatedListDef } from "../lib/objects";
import { useLookupMaps } from "../lib/lookups";
import { Button, EmptyState } from "./ui";
import DataTable from "./DataTable";
import RecordForm from "./RecordForm";

export default function RelatedList({
  def,
  parentId,
}: {
  def: RelatedListDef;
  parentId: string;
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
    supabase
      .from(def.object)
      .select("*")
      .eq(def.foreignKey, parentId)
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setRows((data ?? []) as Record<string, unknown>[]));
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
        <Button variant="ghost" onClick={() => setShowForm(true)} className="!px-3 !py-1.5">
          <Plus size={14} strokeWidth={2} />
          Add
        </Button>
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
          }}
        />
      )}
    </section>
  );
}
