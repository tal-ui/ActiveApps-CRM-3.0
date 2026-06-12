import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Eye,
  EyeOff,
  GripVertical,
  LayoutPanelLeft,
  Plus,
  RotateCcw,
  Save,
  X,
} from "lucide-react";
import { NAV_OBJECTS, OBJECTS } from "../../lib/objects";
import { useCustomFields, type CustomFieldDef } from "../../lib/customFields";
import {
  CF_PREFIX,
  customFieldId,
  defaultLayoutFor,
  fetchDefaultLayout,
  isCustomFieldName,
  newSection,
  saveLayout,
  type LayoutFieldEntry,
  type LayoutJson,
  type LayoutSection,
} from "../../lib/layouts";
import { useAuth } from "../../lib/auth";
import { Button, ErrorNote, Input, Select, Spinner, Toggle } from "../../components/ui";

/* ---------- helpers ---------- */

function resolveLabel(
  objectName: string,
  customDefs: CustomFieldDef[],
  fieldName: string,
): string | null {
  if (isCustomFieldName(fieldName)) {
    const cf = customDefs.find((c) => c.id === customFieldId(fieldName));
    return cf ? cf.label : null;
  }
  const f = OBJECTS[objectName].fields.find((f) => f.name === fieldName);
  return f ? f.label : null;
}

function defaultEntry(
  objectName: string,
  customDefs: CustomFieldDef[],
  fieldName: string,
): LayoutFieldEntry {
  let required = false;
  let span: 1 | 2 = 1;
  if (isCustomFieldName(fieldName)) {
    const cf = customDefs.find((c) => c.id === customFieldId(fieldName));
    required = cf?.is_required ?? false;
    span = cf?.field_type === "textarea" ? 2 : 1;
  } else {
    const f = OBJECTS[objectName].fields.find((f) => f.name === fieldName);
    required = !!f?.required;
    span = f?.type === "textarea" ? 2 : 1;
  }
  return {
    fieldName,
    column: 0,
    sortOrder: 0,
    isRequired: required,
    isReadOnly: false,
    isVisible: true,
    span,
  };
}

/* ---------- DnD building blocks ---------- */

function PaletteItem({ fieldName, label }: { fieldName: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pal|${fieldName}`,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={`flex items-center gap-2 px-3 py-2 bg-[var(--navy-light)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-sm)] text-sm text-[var(--text-mid)] cursor-grab transition-colors hover:border-[rgba(60,201,152,0.3)] hover:text-[var(--foreground)] ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      <GripVertical size={13} strokeWidth={1.5} className="text-[var(--text-faint)] shrink-0" />
      <span className="truncate">{label}</span>
      {isCustomFieldName(fieldName) && (
        <span className="label-mono !text-[0.55rem] text-[var(--mint)] ml-auto shrink-0">CF</span>
      )}
    </div>
  );
}

function FieldChip({
  sectionId,
  entry,
  label,
  selected,
  onSelect,
}: {
  sectionId: string;
  entry: LayoutFieldEntry;
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const id = `fld|${sectionId}|${entry.fieldName}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      className={`flex items-center gap-2 px-3 py-2 rounded-[var(--radius-sm)] text-sm cursor-pointer transition-colors border ${
        entry.span === 2 ? "col-span-full" : ""
      } ${isDragging ? "opacity-40" : ""} ${
        selected
          ? "bg-[rgba(60,201,152,0.1)] border-[rgba(60,201,152,0.45)] text-[var(--mint)] shadow-[0_0_14px_rgba(60,201,152,0.12)]"
          : "bg-[var(--navy-light)] border-[rgba(255,255,255,0.08)] text-[var(--text-mid)] hover:border-[rgba(60,201,152,0.25)]"
      } ${!entry.isVisible ? "opacity-50" : ""}`}
    >
      <span
        {...attributes}
        {...listeners}
        className="cursor-grab text-[var(--text-faint)] hover:text-[var(--mint)] shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical size={13} strokeWidth={1.5} />
      </span>
      <span className="truncate">{label}</span>
      {entry.isRequired && <span className="text-[var(--mint)] shrink-0">*</span>}
      {!entry.isVisible && (
        <EyeOff size={12} strokeWidth={1.5} className="ml-auto shrink-0 text-[var(--text-faint)]" />
      )}
    </div>
  );
}

function SectionDropZone({ sectionId, children }: { sectionId: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `sec|${sectionId}` });
  return (
    <div
      ref={setNodeRef}
      className={`rounded-[var(--radius-md)] transition-colors ${
        isOver ? "bg-[rgba(60,201,152,0.04)]" : ""
      }`}
    >
      {children}
    </div>
  );
}

/* ---------- Page ---------- */

export default function LayoutBuilderPage() {
  const { profile } = useAuth();
  const [objectName, setObjectName] = useState("accounts");
  const { defs: customDefs } = useCustomFields(objectName);
  const [layout, setLayout] = useState<LayoutJson | null>(null);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<{ sectionId: string; fieldName: string } | null>(null);
  const [activeDragLabel, setActiveDragLabel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [error, setError] = useState("");

  const def = OBJECTS[objectName];
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // Load saved layout when the object changes
  useEffect(() => {
    let mounted = true;
    setLayout(null);
    setLayoutId(null);
    setSelected(null);
    setDirty(false);
    setError("");
    fetchDefaultLayout(objectName).then((res) => {
      if (!mounted) return;
      if (res) {
        setLayout(res.layout);
        setLayoutId(res.id);
      } else {
        setLayout(defaultLayoutFor(OBJECTS[objectName], []));
      }
    });
    return () => {
      mounted = false;
    };
  }, [objectName]);

  // When custom fields arrive and the layout is still pristine/unsaved, regenerate the default
  useEffect(() => {
    if (layoutId || dirty) return;
    setLayout(defaultLayoutFor(OBJECTS[objectName], customDefs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customDefs]);

  const placed = useMemo(() => {
    const s = new Set<string>();
    for (const sec of layout?.sections ?? [])
      for (const f of sec.fields) s.add(f.fieldName);
    return s;
  }, [layout]);

  const paletteFields = useMemo(() => {
    const all: { fieldName: string; label: string }[] = [];
    for (const f of def.fields) {
      if (f.hidden) continue;
      if (!placed.has(f.name)) all.push({ fieldName: f.name, label: f.label });
    }
    for (const cf of customDefs) {
      const name = `${CF_PREFIX}${cf.id}`;
      if (!placed.has(name)) all.push({ fieldName: name, label: cf.label });
    }
    return all;
  }, [def, customDefs, placed]);

  function mutate(fn: (l: LayoutJson) => LayoutJson) {
    setLayout((prev) => (prev ? fn(prev) : prev));
    setDirty(true);
  }

  /* ----- drag handlers ----- */

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    const fieldName = id.startsWith("pal|") ? id.slice(4) : id.split("|")[2];
    setActiveDragLabel(resolveLabel(objectName, customDefs, fieldName));
  }

  function onDragEnd(e: DragEndEvent) {
    setActiveDragLabel(null);
    const activeId = String(e.active.id);
    if (!e.over) return;
    const overId = String(e.over.id);

    // Resolve drop target: section + index
    let targetSec: string | null = null;
    let targetIndex = -1;
    if (overId.startsWith("sec|")) {
      targetSec = overId.slice(4);
    } else if (overId.startsWith("fld|")) {
      const [, secId, fname] = overId.split("|");
      targetSec = secId;
      const sec = layout?.sections.find((s) => s.id === secId);
      targetIndex = sec ? sec.fields.findIndex((f) => f.fieldName === fname) : -1;
    }
    if (!targetSec) return;

    if (activeId.startsWith("pal|")) {
      const fieldName = activeId.slice(4);
      mutate((l) => ({
        ...l,
        sections: l.sections.map((s) => {
          if (s.id !== targetSec) return s;
          const entry = defaultEntry(objectName, customDefs, fieldName);
          const fields = [...s.fields];
          fields.splice(targetIndex < 0 ? fields.length : targetIndex, 0, entry);
          return { ...s, fields };
        }),
      }));
      setSelected({ sectionId: targetSec, fieldName });
      return;
    }

    if (activeId.startsWith("fld|")) {
      const [, fromSec, fieldName] = activeId.split("|");
      if (fromSec === targetSec && targetIndex < 0) return;
      mutate((l) => {
        const source = l.sections.find((s) => s.id === fromSec);
        const entry = source?.fields.find((f) => f.fieldName === fieldName);
        if (!source || !entry) return l;
        return {
          ...l,
          sections: l.sections.map((s) => {
            if (s.id === fromSec && s.id === targetSec) {
              const fields = s.fields.filter((f) => f.fieldName !== fieldName);
              const idx = targetIndex < 0 ? fields.length : Math.min(targetIndex, fields.length);
              fields.splice(idx, 0, entry);
              return { ...s, fields };
            }
            if (s.id === fromSec) {
              return { ...s, fields: s.fields.filter((f) => f.fieldName !== fieldName) };
            }
            if (s.id === targetSec) {
              const fields = [...s.fields];
              fields.splice(targetIndex < 0 ? fields.length : targetIndex, 0, entry);
              return { ...s, fields };
            }
            return s;
          }),
        };
      });
      setSelected({ sectionId: targetSec, fieldName });
    }
  }

  /* ----- section ops ----- */

  const renameSection = (id: string, title: string) =>
    mutate((l) => ({
      ...l,
      sections: l.sections.map((s) => (s.id === id ? { ...s, title } : s)),
    }));
  const setSectionColumns = (id: string, columns: 1 | 2) =>
    mutate((l) => ({
      ...l,
      sections: l.sections.map((s) => (s.id === id ? { ...s, columns } : s)),
    }));
  const moveSection = (id: string, dir: -1 | 1) =>
    mutate((l) => {
      const idx = l.sections.findIndex((s) => s.id === id);
      const to = idx + dir;
      if (to < 0 || to >= l.sections.length) return l;
      const sections = [...l.sections];
      const [s] = sections.splice(idx, 1);
      sections.splice(to, 0, s);
      return { ...l, sections };
    });
  const removeSection = (id: string) =>
    mutate((l) => ({ ...l, sections: l.sections.filter((s) => s.id !== id) }));
  const addSection = () =>
    mutate((l) => ({
      ...l,
      sections: [...l.sections, newSection(l.sections.length)],
    }));

  /* ----- field property ops ----- */

  const selectedEntry: LayoutFieldEntry | null = useMemo(() => {
    if (!selected || !layout) return null;
    return (
      layout.sections
        .find((s) => s.id === selected.sectionId)
        ?.fields.find((f) => f.fieldName === selected.fieldName) ?? null
    );
  }, [selected, layout]);

  const patchSelected = (patch: Partial<LayoutFieldEntry>) => {
    if (!selected) return;
    mutate((l) => ({
      ...l,
      sections: l.sections.map((s) =>
        s.id !== selected.sectionId
          ? s
          : {
              ...s,
              fields: s.fields.map((f) =>
                f.fieldName === selected.fieldName ? { ...f, ...patch } : f,
              ),
            },
      ),
    }));
  };
  const removeSelected = () => {
    if (!selected) return;
    mutate((l) => ({
      ...l,
      sections: l.sections.map((s) =>
        s.id !== selected.sectionId
          ? s
          : { ...s, fields: s.fields.filter((f) => f.fieldName !== selected.fieldName) },
      ),
    }));
    setSelected(null);
  };

  /* ----- related list ops ----- */

  const toggleRelatedList = (objName: string) =>
    mutate((l) => ({
      ...l,
      relatedLists: l.relatedLists.map((rl) =>
        rl.objectName === objName ? { ...rl, hidden: !rl.hidden } : rl,
      ),
    }));
  const moveRelatedList = (idx: number, dir: -1 | 1) =>
    mutate((l) => {
      const to = idx + dir;
      if (to < 0 || to >= l.relatedLists.length) return l;
      const rls = [...l.relatedLists];
      const [rl] = rls.splice(idx, 1);
      rls.splice(to, 0, rl);
      return { ...l, relatedLists: rls };
    });

  /* ----- save / reset ----- */

  async function onSave() {
    if (!layout) return;
    setSaving(true);
    setError("");
    // prune entries whose fields no longer exist
    const pruned: LayoutJson = {
      ...layout,
      sections: layout.sections.map((s) => ({
        ...s,
        fields: s.fields.filter(
          (f) => resolveLabel(objectName, customDefs, f.fieldName) !== null,
        ),
      })),
    };
    const res = await saveLayout(objectName, pruned, layoutId, profile?.id ?? "system");
    setSaving(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setLayoutId(res.id);
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  function onReset() {
    setLayout(defaultLayoutFor(def, customDefs));
    setSelected(null);
    setDirty(true);
  }

  if (!layout) return <Spinner />;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <LayoutPanelLeft size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Page Layout Builder
            </h1>
            <p className="label-mono">
              Drag fields from the palette · click a field to configure it
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
          <Button variant="subtle" onClick={onReset} title="Reset to default layout">
            <RotateCcw size={14} strokeWidth={1.5} />
            Reset
          </Button>
          <Button onClick={onSave} disabled={saving || (!dirty && !!layoutId)}>
            {savedFlash ? <Check size={15} strokeWidth={2} /> : <Save size={15} strokeWidth={1.5} />}
            {saving ? "Saving…" : savedFlash ? "Saved" : "Save Layout"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-12 gap-5">
          {/* Palette */}
          <aside className="col-span-3 bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-4 self-start sticky top-20">
            <p className="label-mono mb-3">Field Palette</p>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
              {paletteFields.length === 0 ? (
                <p className="text-xs text-[var(--text-faint)]">
                  All fields are placed on the layout.
                </p>
              ) : (
                paletteFields.map((f) => (
                  <PaletteItem key={f.fieldName} fieldName={f.fieldName} label={f.label} />
                ))
              )}
            </div>
          </aside>

          {/* Canvas */}
          <div className="col-span-6 space-y-4">
            {layout.sections.map((section: LayoutSection, si) => (
              <div
                key={section.id}
                className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-4"
              >
                <div className="flex items-center gap-2 mb-3">
                  <Input
                    value={section.title}
                    onChange={(e) => renameSection(section.id, e.target.value)}
                    className="!py-1.5 !text-sm font-medium flex-1"
                  />
                  <div className="inline-flex items-center gap-0.5 bg-[var(--section-darker)] rounded-[var(--radius)] p-0.5">
                    {([1, 2] as const).map((c) => (
                      <button
                        key={c}
                        onClick={() => setSectionColumns(section.id, c)}
                        className={`px-2 py-1 text-[0.6rem] font-[var(--font-mono)] uppercase tracking-wider rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
                          section.columns === c
                            ? "bg-[var(--navy-surface)] text-[var(--mint)]"
                            : "text-[var(--text-faint)] hover:text-[var(--foreground)]"
                        }`}
                      >
                        {c} col
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => moveSection(section.id, -1)}
                    disabled={si === 0}
                    className="p-1.5 text-[var(--text-faint)] hover:text-[var(--mint)] disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowUp size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => moveSection(section.id, 1)}
                    disabled={si === layout.sections.length - 1}
                    className="p-1.5 text-[var(--text-faint)] hover:text-[var(--mint)] disabled:opacity-30 cursor-pointer"
                  >
                    <ArrowDown size={14} strokeWidth={1.5} />
                  </button>
                  <button
                    onClick={() => removeSection(section.id)}
                    className="p-1.5 text-[var(--text-faint)] hover:text-[var(--destructive)] cursor-pointer"
                    title="Remove section (fields return to palette)"
                  >
                    <X size={14} strokeWidth={1.5} />
                  </button>
                </div>

                <SectionDropZone sectionId={section.id}>
                  <SortableContext
                    items={section.fields.map((f) => `fld|${section.id}|${f.fieldName}`)}
                    strategy={rectSortingStrategy}
                  >
                    <div
                      className={`grid gap-2 min-h-[52px] ${
                        section.columns === 2 ? "grid-cols-2" : "grid-cols-1"
                      }`}
                    >
                      {section.fields.length === 0 && (
                        <p className="col-span-full text-center text-xs text-[var(--text-faint)] border border-dashed border-[rgba(255,255,255,0.1)] rounded-[var(--radius-sm)] py-4">
                          Drop fields here
                        </p>
                      )}
                      {section.fields.map((entry) => {
                        const label = resolveLabel(objectName, customDefs, entry.fieldName);
                        if (!label) return null;
                        return (
                          <FieldChip
                            key={entry.fieldName}
                            sectionId={section.id}
                            entry={entry}
                            label={label}
                            selected={
                              selected?.sectionId === section.id &&
                              selected?.fieldName === entry.fieldName
                            }
                            onSelect={() =>
                              setSelected({ sectionId: section.id, fieldName: entry.fieldName })
                            }
                          />
                        );
                      })}
                    </div>
                  </SortableContext>
                </SectionDropZone>
              </div>
            ))}

            <Button variant="ghost" onClick={addSection} className="w-full justify-center">
              <Plus size={15} strokeWidth={2} />
              Add Section
            </Button>
          </div>

          {/* Properties + related lists */}
          <aside className="col-span-3 space-y-4 self-start sticky top-20">
            <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-4">
              <p className="label-mono mb-3">Field Properties</p>
              {selectedEntry && selected ? (
                <div className="space-y-3.5">
                  <p className="text-sm text-[var(--foreground)] font-medium">
                    {resolveLabel(objectName, customDefs, selectedEntry.fieldName)}
                  </p>
                  <Toggle
                    checked={selectedEntry.isRequired}
                    onChange={(v) => patchSelected({ isRequired: v })}
                    label="Required"
                  />
                  <Toggle
                    checked={selectedEntry.isReadOnly}
                    onChange={(v) => patchSelected({ isReadOnly: v })}
                    label="Read-only"
                  />
                  <Toggle
                    checked={selectedEntry.isVisible}
                    onChange={(v) => patchSelected({ isVisible: v })}
                    label="Visible"
                  />
                  <div>
                    <p className="label-mono mb-1.5">Width</p>
                    <div className="inline-flex items-center gap-0.5 bg-[var(--section-darker)] rounded-[var(--radius)] p-0.5">
                      {([1, 2] as const).map((s) => (
                        <button
                          key={s}
                          onClick={() => patchSelected({ span: s })}
                          className={`px-2.5 py-1 text-[0.6rem] font-[var(--font-mono)] uppercase tracking-wider rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
                            selectedEntry.span === s
                              ? "bg-[var(--navy-surface)] text-[var(--mint)]"
                              : "text-[var(--text-faint)] hover:text-[var(--foreground)]"
                          }`}
                        >
                          {s === 1 ? "Half" : "Full"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <Button variant="subtle" onClick={removeSelected} className="w-full justify-center !py-1.5">
                    <X size={13} strokeWidth={1.5} />
                    Remove from Layout
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-[var(--text-faint)]">
                  Select a field on the canvas to configure it.
                </p>
              )}
            </div>

            <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-4">
              <p className="label-mono mb-3">Related Lists</p>
              {layout.relatedLists.length === 0 ? (
                <p className="text-xs text-[var(--text-faint)]">
                  This object has no related lists.
                </p>
              ) : (
                <div className="space-y-2">
                  {layout.relatedLists.map((rl, idx) => (
                    <div
                      key={rl.objectName}
                      className="flex items-center gap-2 px-3 py-2 bg-[var(--navy-light)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-sm)]"
                    >
                      <button
                        onClick={() => toggleRelatedList(rl.objectName)}
                        className="cursor-pointer text-[var(--text-faint)] hover:text-[var(--mint)]"
                        title={rl.hidden ? "Show" : "Hide"}
                      >
                        {rl.hidden ? (
                          <EyeOff size={14} strokeWidth={1.5} />
                        ) : (
                          <Eye size={14} strokeWidth={1.5} className="text-[var(--mint)]" />
                        )}
                      </button>
                      <span
                        className={`text-sm flex-1 truncate ${
                          rl.hidden ? "text-[var(--text-faint)] line-through" : "text-[var(--text-mid)]"
                        }`}
                      >
                        {rl.title}
                      </span>
                      <button
                        onClick={() => moveRelatedList(idx, -1)}
                        disabled={idx === 0}
                        className="p-0.5 text-[var(--text-faint)] hover:text-[var(--mint)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp size={13} strokeWidth={1.5} />
                      </button>
                      <button
                        onClick={() => moveRelatedList(idx, 1)}
                        disabled={idx === layout.relatedLists.length - 1}
                        className="p-0.5 text-[var(--text-faint)] hover:text-[var(--mint)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown size={13} strokeWidth={1.5} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </aside>
        </div>

        <DragOverlay>
          {activeDragLabel && (
            <div className="flex items-center gap-2 px-3 py-2 bg-[var(--navy-surface)] border border-[rgba(60,201,152,0.45)] rounded-[var(--radius-sm)] text-sm text-[var(--mint)] shadow-[0_0_20px_rgba(60,201,152,0.2)]">
              <GripVertical size={13} strokeWidth={1.5} />
              {activeDragLabel}
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
