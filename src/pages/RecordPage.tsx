import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderKanban, Pencil, Sparkles, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, recordTitle, type RelatedListDef } from "../lib/objects";
import { invalidateLookup, useLookupMaps } from "../lib/lookups";
import { timeAgo } from "../lib/format";
import {
  fetchValueRows,
  useCustomFields,
  type CustomFieldValueRow,
} from "../lib/customFields";
import {
  customFieldId,
  fetchDefaultLayout,
  isCustomFieldName,
  type LayoutJson,
} from "../lib/layouts";
import { Button, EmptyState, Modal, Spinner } from "../components/ui";
import FieldValue from "../components/FieldValue";
import { CustomFieldDisplay } from "../components/customFields";
import RecordForm from "../components/RecordForm";
import RelatedList from "../components/RelatedList";
import ActivityTimeline from "../components/ActivityTimeline";
import LeadConvertModal from "../components/LeadConvertModal";
import OpportunityConvertModal from "../components/OpportunityConvertModal";
import AccountInsights from "../components/AccountInsights";
import ProjectBudget from "../components/ProjectBudget";
import InvoiceActions from "../components/InvoiceActions";

interface RenderItem {
  key: string;
  label: string;
  span: number;
  node: ReactNode;
}
interface RenderSection {
  title: string;
  items: RenderItem[];
}

export default function RecordPage() {
  const { object = "", id = "" } = useParams();
  const def = OBJECTS[object];
  const navigate = useNavigate();

  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showConvert, setShowConvert] = useState(false);
  const [showProjectConvert, setShowProjectConvert] = useState(false);
  const [linkedProjectId, setLinkedProjectId] = useState<string | null>(null);
  const [projectChecked, setProjectChecked] = useState(false);
  const [reload, setReload] = useState(0);

  const { defs: customDefs } = useCustomFields(object);
  const [cfRows, setCfRows] = useState<Record<string, CustomFieldValueRow>>({});
  const [layout, setLayout] = useState<LayoutJson | null>(null);

  const visibleFields = useMemo(
    () => (def ? def.fields.filter((f) => !f.hidden) : []),
    [def],
  );

  const lookupObjects = useMemo(
    () =>
      Array.from(
        new Set(
          visibleFields
            .filter((f) => f.type === "lookup" && f.lookup)
            .map((f) => f.lookup as string),
        ),
      ),
    [visibleFields],
  );
  const lookupMaps = useLookupMaps(lookupObjects);

  // Record
  useEffect(() => {
    if (!def) return;
    setLoading(true);
    supabase
      .from(object)
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        setRecord(data as Record<string, unknown> | null);
        setLoading(false);
      });
  }, [object, id, def, reload]);

  // Linked project for won opportunities
  const oppStage =
    object === "opportunities" ? (record?.stage as string | undefined) : undefined;
  useEffect(() => {
    setLinkedProjectId(null);
    setProjectChecked(false);
    if (oppStage !== "closed_won") return;
    let cancelled = false;
    supabase
      .from("projects")
      .select("id")
      .eq("opportunity_id", id)
      .limit(1)
      .then(({ data }) => {
        if (cancelled) return;
        setLinkedProjectId(
          data && data.length > 0 ? (data[0] as { id: string }).id : null,
        );
        setProjectChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [id, oppStage]);

  // Custom field values
  useEffect(() => {
    if (!def || customDefs.length === 0) {
      setCfRows({});
      return;
    }
    fetchValueRows(object, id).then(setCfRows);
  }, [object, id, def, customDefs, reload]);

  // Saved page layout
  useEffect(() => {
    if (!def) return;
    setLayout(null);
    fetchDefaultLayout(object).then((res) => setLayout(res?.layout ?? null));
  }, [object, def]);

  /* Build render sections: saved layout if present, registry fallback otherwise */
  const sections: RenderSection[] = useMemo(() => {
    if (!record) return [];

    const standardItem = (name: string, span?: number): RenderItem | null => {
      const f = visibleFields.find((vf) => vf.name === name);
      if (!f) return null;
      return {
        key: name,
        label: f.label,
        span: span ?? (f.type === "textarea" ? 2 : 1),
        node: <FieldValue field={f} record={record} lookupMaps={lookupMaps} />,
      };
    };
    const customItem = (cfId: string, span?: number): RenderItem | null => {
      const cf = customDefs.find((c) => c.id === cfId);
      if (!cf) return null;
      return {
        key: `cf:${cfId}`,
        label: cf.label,
        span: span ?? (cf.field_type === "textarea" ? 2 : 1),
        node: <CustomFieldDisplay def={cf} row={cfRows[cfId]} />,
      };
    };

    if (layout) {
      return layout.sections
        .map((s) => ({
          title: s.title,
          items: s.fields
            .filter((f) => f.isVisible)
            .map((f) =>
              isCustomFieldName(f.fieldName)
                ? customItem(customFieldId(f.fieldName), f.span)
                : standardItem(f.fieldName, f.span),
            )
            .filter((i): i is RenderItem => i !== null),
        }))
        .filter((s) => s.items.length > 0);
    }

    // Registry fallback
    const map = new Map<string, RenderItem[]>();
    for (const f of visibleFields) {
      if (!map.has(f.section)) map.set(f.section, []);
      const item = standardItem(f.name);
      if (item) map.get(f.section)!.push(item);
    }
    const out: RenderSection[] = Array.from(map.entries()).map(
      ([title, items]) => ({ title, items }),
    );
    if (customDefs.length > 0) {
      out.push({
        title: "Custom Fields",
        items: customDefs
          .map((cf) => customItem(cf.id))
          .filter((i): i is RenderItem => i !== null),
      });
    }
    return out;
  }, [record, layout, visibleFields, customDefs, cfRows, lookupMaps]);

  /* Related lists: layout order/visibility if configured */
  const relatedLists: RelatedListDef[] = useMemo(() => {
    const base = def?.relatedLists ?? [];
    if (!layout || layout.relatedLists.length === 0) return base;
    return layout.relatedLists
      .filter((rl) => !rl.hidden)
      .map((rl) => base.find((b) => b.object === rl.objectName))
      .filter((b): b is RelatedListDef => !!b);
  }, [def, layout]);

  if (!def) return <EmptyState message={`Unknown object: ${object}`} />;
  if (loading) return <Spinner />;
  if (!record) return <EmptyState message={`${def.singular} not found.`} />;

  const Icon = def.icon;
  const title = recordTitle(def, record);
  const isConvertibleLead = object === "leads" && record.status !== "converted";
  const highlightDefs = def.highlightFields
    .map((name) => visibleFields.find((f) => f.name === name))
    .filter((f): f is NonNullable<typeof f> => !!f);

  async function onDelete() {
    await supabase
      .from("custom_field_values")
      .delete()
      .eq("object_name", object)
      .eq("record_id", id);
    await supabase.from(object).delete().eq("id", id);
    invalidateLookup(object);
    navigate(`/${object}`);
  }

  return (
    <div>
      {/* Breadcrumb */}
      <Link
        to={`/${object}`}
        className="inline-flex items-center gap-1.5 text-[var(--text-dim)] hover:text-[var(--mint)] text-sm cursor-pointer transition-colors mb-5"
      >
        <ArrowLeft size={14} strokeWidth={1.5} />
        {def.plural}
      </Link>

      {/* Highlights panel */}
      <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6 mb-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center glow-mint">
              <Icon size={22} strokeWidth={1.5} className="text-[var(--mint)]" />
            </div>
            <div>
              <p className="label-mono">{def.singular}</p>
              <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                {title}
              </h1>
              <p className="text-xs text-[var(--text-faint)] mt-0.5">
                Updated {timeAgo(record.updated_at as number)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {isConvertibleLead && (
              <Button onClick={() => setShowConvert(true)}>
                <Sparkles size={15} strokeWidth={1.5} />
                Convert
              </Button>
            )}
            {object === "invoices" && (
              <InvoiceActions
                invoice={record}
                onChanged={() => setReload((r) => r + 1)}
              />
            )}
            {oppStage === "closed_won" &&
              projectChecked &&
              (linkedProjectId ? (
                <Button
                  variant="subtle"
                  onClick={() => navigate(`/projects/${linkedProjectId}`)}
                >
                  <FolderKanban size={15} strokeWidth={1.5} />
                  View Project
                </Button>
              ) : (
                <Button onClick={() => setShowProjectConvert(true)}>
                  <FolderKanban size={15} strokeWidth={1.5} />
                  Create Project
                </Button>
              ))}
            <Button variant="ghost" onClick={() => setShowEdit(true)}>
              <Pencil size={14} strokeWidth={1.5} />
              Edit
            </Button>
            <Button variant="subtle" onClick={() => setShowDelete(true)}>
              <Trash2 size={14} strokeWidth={1.5} />
            </Button>
          </div>
        </div>

        {/* Key fields strip */}
        {highlightDefs.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-5 border-t border-[rgba(255,255,255,0.05)]">
            {highlightDefs.map((f) => (
              <div key={f.name}>
                <p className="label-mono mb-1">{f.label}</p>
                <div className="text-sm text-[var(--text-light)]">
                  <FieldValue field={f} record={record} lookupMaps={lookupMaps} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Object-specific insight widgets (Sprint 5) */}
      {object === "accounts" && <AccountInsights accountId={id} />}
      {object === "projects" && <ProjectBudget project={record} />}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        {/* Field sections (layout-driven) */}
        <div className="xl:col-span-3 space-y-6">
          {sections.map((section) => (
            <section
              key={section.title}
              className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5"
            >
              <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)] mb-4">
                {section.title}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                {section.items.map((item) => (
                  <div
                    key={item.key}
                    className={item.span === 2 ? "sm:col-span-2" : ""}
                  >
                    <p className="label-mono mb-1">{item.label}</p>
                    <div className="text-sm text-[var(--text-light)]">{item.node}</div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Activity */}
        <div className="xl:col-span-2">
          {def.activityType && (
            <ActivityTimeline relatedToType={def.activityType} relatedToId={id} />
          )}
        </div>
      </div>

      {/* Related lists */}
      {relatedLists.length > 0 && (
        <div className="mt-6 space-y-6">
          {relatedLists.map((rl) => (
            <RelatedList key={rl.object + rl.foreignKey} def={rl} parentId={id} />
          ))}
        </div>
      )}

      {/* Modals */}
      {showEdit && (
        <RecordForm
          object={object}
          record={record}
          onClose={() => setShowEdit(false)}
          onSaved={() => {
            setShowEdit(false);
            setReload((r) => r + 1);
          }}
        />
      )}
      {showDelete && (
        <Modal title={`Delete ${def.singular}?`} onClose={() => setShowDelete(false)}>
          <p className="text-sm text-[var(--text-mid)] mb-6">
            This will permanently delete{" "}
            <span className="text-[var(--foreground)]">{title}</span> and its
            custom field values. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="subtle" onClick={() => setShowDelete(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={onDelete}>
              <Trash2 size={14} strokeWidth={1.5} />
              Delete
            </Button>
          </div>
        </Modal>
      )}
      {showConvert && (
        <LeadConvertModal
          lead={record}
          onClose={() => setShowConvert(false)}
          onConverted={(accountId) => {
            setShowConvert(false);
            navigate(`/accounts/${accountId}`);
          }}
        />
      )}
      {showProjectConvert && (
        <OpportunityConvertModal
          opportunity={record}
          onClose={() => setShowProjectConvert(false)}
          onConverted={(projectId) => {
            setShowProjectConvert(false);
            navigate(`/projects/${projectId}`);
          }}
        />
      )}
    </div>
  );
}
