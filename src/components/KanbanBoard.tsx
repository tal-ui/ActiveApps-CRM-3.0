import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import type { PicklistOption } from "../lib/objects";

export interface KanbanBoardProps<T extends { id: string }> {
  items: T[];
  columns: PicklistOption[];
  getColumn: (item: T) => string;
  /** Persist a move; resolve with an error message to revert, or null on success. */
  onMove: (id: string, toColumn: string) => Promise<string | null>;
  renderCard: (item: T) => ReactNode;
  renderOverlay: (item: T) => ReactNode;
  /** Extra column-header content (e.g. a currency total) under the title row. */
  columnMeta?: (colItems: T[], column: PicklistOption) => ReactNode;
  columnTone?: Record<string, "positive" | "muted">;
  onOpen: (item: T) => void;
  onError: (message: string) => void;
  emptyLabel?: string;
}

function BoardCard({
  id,
  onOpen,
  children,
}: {
  id: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={`bg-[var(--navy-surface)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-md)] p-3 cursor-pointer transition-colors hover:border-[rgba(60,201,152,0.3)] ${
        isDragging ? "opacity-40" : ""
      }`}
    >
      {children}
    </div>
  );
}

function BoardColumn({
  column,
  count,
  tone,
  meta,
  children,
}: {
  column: PicklistOption;
  count: number;
  tone?: "positive" | "muted";
  meta?: ReactNode;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.value });
  const positive = tone === "positive";
  const muted = tone === "muted";
  return (
    <div
      className={`flex-1 min-w-[264px] flex flex-col bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] ${
        muted ? "opacity-70" : ""
      }`}
    >
      <div
        className={`px-3.5 py-3 border-b border-[rgba(255,255,255,0.06)] rounded-t-[var(--radius-lg)] ${
          positive ? "bg-[rgba(60,201,152,0.06)]" : ""
        }`}
      >
        <div className={`flex items-center justify-between gap-2 ${meta ? "mb-1" : ""}`}>
          <span
            className={`text-sm font-medium truncate ${
              positive
                ? "text-[var(--mint)]"
                : muted
                  ? "text-[var(--text-faint)]"
                  : "text-[var(--foreground)]"
            }`}
          >
            {column.label}
          </span>
          <span className="label-mono shrink-0">{count}</span>
        </div>
        {meta}
      </div>
      <div
        ref={setNodeRef}
        className={`flex-1 p-2.5 space-y-2.5 rounded-b-[var(--radius-lg)] transition-colors ${
          isOver ? "bg-[rgba(60,201,152,0.04)]" : ""
        }`}
      >
        {children}
      </div>
    </div>
  );
}

export default function KanbanBoard<T extends { id: string }>({
  items,
  columns,
  getColumn,
  onMove,
  renderCard,
  renderOverlay,
  columnMeta,
  columnTone,
  onOpen,
  onError,
  emptyLabel = "Drop items here",
}: KanbanBoardProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  // Optimistic column placement (id -> column) while a move persists; reverted
  // on error, cleared whenever the parent hands us a fresh items array.
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  // Browsers fire a click on the drag source after a drag ends; this flag
  // swallows that click so dropping a card doesn't also navigate.
  const dragHappened = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    setOverrides((prev) => (Object.keys(prev).length ? {} : prev));
  }, [items]);

  const byColumn = useMemo(() => {
    const m: Record<string, T[]> = {};
    for (const c of columns) m[c.value] = [];
    for (const item of items) {
      m[overrides[item.id] ?? getColumn(item)]?.push(item);
    }
    return m;
  }, [items, columns, getColumn, overrides]);

  const activeItem = activeId ? items.find((i) => i.id === activeId) : undefined;

  function onDragStart(e: DragStartEvent) {
    dragHappened.current = true;
    setActiveId(String(e.active.id));
  }

  function clearDragFlag() {
    setTimeout(() => {
      dragHappened.current = false;
    }, 0);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    clearDragFlag();
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const toColumn = String(over.id);
    const item = items.find((i) => i.id === id);
    if (!item) return;
    const fromColumn = overrides[id] ?? getColumn(item);
    if (fromColumn === toColumn) return;
    setOverrides((prev) => ({ ...prev, [id]: toColumn }));
    const message = await onMove(id, toColumn);
    if (message) {
      setOverrides((prev) => ({ ...prev, [id]: fromColumn }));
      onError(message);
    }
  }

  function onDragCancel() {
    setActiveId(null);
    clearDragFlag();
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
    >
      <div className="flex items-stretch gap-4 overflow-x-auto pb-3">
        {columns.map((col) => {
          const colItems = byColumn[col.value] ?? [];
          return (
            <BoardColumn
              key={col.value}
              column={col}
              count={colItems.length}
              tone={columnTone?.[col.value]}
              meta={columnMeta?.(colItems, col)}
            >
              {colItems.length === 0 ? (
                <div className="border border-dashed border-[rgba(255,255,255,0.1)] rounded-[var(--radius-sm)] py-6 text-center">
                  <span className="label-mono">{emptyLabel}</span>
                </div>
              ) : (
                colItems.map((item) => (
                  <BoardCard
                    key={item.id}
                    id={item.id}
                    onOpen={() => {
                      if (dragHappened.current) return;
                      onOpen(item);
                    }}
                  >
                    {renderCard(item)}
                  </BoardCard>
                ))
              )}
            </BoardColumn>
          );
        })}
      </div>

      <DragOverlay>{activeItem ? renderOverlay(activeItem) : null}</DragOverlay>
    </DndContext>
  );
}
