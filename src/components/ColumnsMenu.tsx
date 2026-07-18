import { useEffect, useRef, useState } from "react";
import { Columns3, GripVertical, Plus, RotateCcw, X } from "lucide-react";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ObjectDef } from "../lib/objects";
import { Button } from "./ui";

function SortableRow({
  name,
  label,
  removable,
  onRemove,
}: {
  name: string;
  label: string;
  removable: boolean;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: name });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--text-light)] ${
        isDragging
          ? "bg-[var(--navy-surface)] z-10 relative shadow-[0_4px_16px_rgba(0,0,0,0.35)]"
          : "hover:bg-[var(--navy-surface)]"
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        aria-label={`Reorder ${label}`}
        className="text-[var(--text-faint)] hover:text-[var(--text-mid)] cursor-grab active:cursor-grabbing touch-none"
      >
        <GripVertical size={14} strokeWidth={1.5} />
      </button>
      <span className="flex-1 truncate">{label}</span>
      {removable && (
        <button
          onClick={onRemove}
          aria-label={`Remove column ${label}`}
          className="text-[var(--text-faint)] hover:text-[#F2697A] cursor-pointer transition-colors"
        >
          <X size={13} strokeWidth={1.5} />
        </button>
      )}
    </div>
  );
}

/**
 * Column chooser for list views: toggle visibility, drag to reorder,
 * reset to the object's default column set.
 */
export default function ColumnsMenu({
  def,
  selected,
  defaultCols,
  onChange,
}: {
  def: ObjectDef;
  selected: string[];
  defaultCols: string[];
  onChange: (cols: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const label = (name: string) =>
    def.fields.find((f) => f.name === name)?.label ?? name;
  const available = def.fields.filter(
    (f) => !f.hidden && !selected.includes(f.name),
  );

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = selected.indexOf(String(active.id));
    const newIdx = selected.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    onChange(arrayMove(selected, oldIdx, newIdx));
  }

  return (
    <div ref={wrapRef} className="relative">
      <Button variant="ghost" onClick={() => setOpen(!open)}>
        <Columns3 size={15} strokeWidth={1.5} />
        Columns
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 z-30 w-72 bg-[var(--card)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-md)] shadow-[0_8px_30px_rgba(0,0,0,0.35)] overflow-hidden">
          <div className="flex items-center justify-between px-3 pt-3 pb-1">
            <span className="label-mono">Shown — drag to reorder</span>
            <button
              onClick={() => onChange(defaultCols)}
              className="inline-flex items-center gap-1 text-xs text-[var(--text-dim)] hover:text-[var(--mint)] cursor-pointer transition-colors"
            >
              <RotateCcw size={12} strokeWidth={1.5} />
              Reset
            </button>
          </div>
          <div className="px-1.5 pb-2 max-h-56 overflow-y-auto">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={selected} strategy={verticalListSortingStrategy}>
                {selected.map((name) => (
                  <SortableRow
                    key={name}
                    name={name}
                    label={label(name)}
                    removable={selected.length > 1}
                    onRemove={() => onChange(selected.filter((n) => n !== name))}
                  />
                ))}
              </SortableContext>
            </DndContext>
          </div>
          {available.length > 0 && (
            <>
              <div className="px-3 pt-2 pb-1 border-t border-[rgba(255,255,255,0.06)]">
                <span className="label-mono">Available</span>
              </div>
              <div className="px-1.5 pb-2 max-h-44 overflow-y-auto">
                {available.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => onChange([...selected, f.name])}
                    className="flex items-center gap-2 w-full text-left rounded-[var(--radius-sm)] px-2 py-1.5 text-sm text-[var(--text-mid)] hover:bg-[var(--navy-surface)] hover:text-[var(--text-light)] cursor-pointer transition-colors"
                  >
                    <Plus size={13} strokeWidth={1.5} className="text-[var(--text-faint)]" />
                    <span className="flex-1 truncate">{f.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
