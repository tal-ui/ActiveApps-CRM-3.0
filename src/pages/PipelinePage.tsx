import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
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
import { Kanban } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, type PicklistOption } from "../lib/objects";
import { useLookupMaps } from "../lib/lookups";
import { fmtCurrency, fmtDate } from "../lib/format";
import { EmptyState, ErrorNote, Spinner } from "../components/ui";

interface Opportunity {
  id: string;
  name: string;
  account_id: string;
  stage: string;
  amount: number | string | null;
  currency: string | null;
  close_date: number | null;
}

const STAGES: PicklistOption[] =
  OBJECTS.opportunities.fields.find((f) => f.name === "stage")?.options ?? [];
const CLOSED = ["closed_won", "closed_lost"];

function DealCard({
  opp,
  accountName,
  onOpen,
}: {
  opp: Opportunity;
  accountName?: string;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: opp.id });
  const overdue =
    !!opp.close_date && Number(opp.close_date) < Date.now() && !CLOSED.includes(opp.stage);
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
      <p className="text-sm font-medium text-[var(--foreground)] truncate">{opp.name}</p>
      <p className="text-xs text-[var(--text-faint)] truncate">{accountName ?? "—"}</p>
      <div className="flex items-center justify-between gap-2 mt-2">
        <span className="font-[var(--font-mono)] text-xs text-[var(--mint)]">
          {fmtCurrency(opp.amount, opp.currency || undefined)}
        </span>
        <span className={`text-xs ${overdue ? "text-[#F2697A]" : "text-[var(--text-dim)]"}`}>
          {fmtDate(opp.close_date)}
        </span>
      </div>
    </div>
  );
}

function StageColumn({
  stage,
  count,
  total,
  children,
}: {
  stage: PicklistOption;
  count: number;
  total: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value });
  const won = stage.value === "closed_won";
  const lost = stage.value === "closed_lost";
  return (
    <div
      className={`flex-1 min-w-[264px] flex flex-col bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] ${
        lost ? "opacity-70" : ""
      }`}
    >
      <div
        className={`px-3.5 py-3 border-b border-[rgba(255,255,255,0.06)] rounded-t-[var(--radius-lg)] ${
          won ? "bg-[rgba(60,201,152,0.06)]" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-1">
          <span
            className={`text-sm font-medium truncate ${
              won
                ? "text-[var(--mint)]"
                : lost
                  ? "text-[var(--text-faint)]"
                  : "text-[var(--foreground)]"
            }`}
          >
            {stage.label}
          </span>
          <span className="label-mono shrink-0">{count}</span>
        </div>
        <p
          className={`font-[var(--font-mono)] text-xs ${
            won ? "text-[var(--mint)]" : lost ? "text-[var(--text-faint)]" : "text-[var(--text-mid)]"
          }`}
        >
          {fmtCurrency(total)}
        </p>
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

export default function PipelinePage() {
  const navigate = useNavigate();
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const maps = useLookupMaps(["accounts"]);
  // Browsers fire a click on the drag source after a drag ends; this flag
  // swallows that click so dropping a card doesn't also navigate.
  const dragHappened = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  useEffect(() => {
    supabase
      .from("opportunities")
      .select("*")
      .order("close_date", { ascending: true, nullsFirst: false })
      .limit(1000)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setOpps((data ?? []) as Opportunity[]);
      });
  }, []);

  const view = useMemo(() => {
    const list = opps ?? [];
    const columns = STAGES.map((s) => {
      const deals = list.filter((o) => o.stage === s.value);
      return {
        stage: s,
        deals,
        total: deals.reduce((sum, o) => sum + Number(o.amount ?? 0), 0),
      };
    });
    const open = list.filter((o) => !CLOSED.includes(o.stage));
    return {
      columns,
      openCount: open.length,
      openTotal: open.reduce((s, o) => s + Number(o.amount ?? 0), 0),
    };
  }, [opps]);

  const activeOpp = activeId ? (opps ?? []).find((o) => o.id === activeId) : undefined;

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
    const toStage = String(over.id);
    const opp = (opps ?? []).find((o) => o.id === id);
    if (!opp || opp.stage === toStage) return;
    const fromStage = opp.stage;
    setError("");
    setOpps((prev) =>
      prev ? prev.map((o) => (o.id === id ? { ...o, stage: toStage } : o)) : prev,
    );
    const { error: err } = await supabase
      .from("opportunities")
      .update({
        stage: toStage,
        updated_at: Date.now(),
        // stamp the close date entering a closed stage; clear it when a deal
        // is reopened so reporting never sees an open deal with a close date
        ...(CLOSED.includes(toStage)
          ? { actual_close_date: Date.now() }
          : CLOSED.includes(fromStage)
            ? { actual_close_date: null }
            : {}),
      })
      .eq("id", id);
    if (err) {
      setOpps((prev) =>
        prev ? prev.map((o) => (o.id === id ? { ...o, stage: fromStage } : o)) : prev,
      );
      setError(err.message);
    }
  }

  function onDragCancel() {
    setActiveId(null);
    clearDragFlag();
  }

  if (!opps) return <Spinner />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Kanban size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Pipeline
            </h1>
            <p className="label-mono">
              {view.openCount} open deal{view.openCount === 1 ? "" : "s"} ·{" "}
              {fmtCurrency(view.openTotal)} in play
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {opps.length === 0 ? (
        <EmptyState message="No opportunities yet. Create one from the Opportunities list." />
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <div className="flex items-stretch gap-4 overflow-x-auto pb-3">
            {view.columns.map((col) => (
              <StageColumn
                key={col.stage.value}
                stage={col.stage}
                count={col.deals.length}
                total={col.total}
              >
                {col.deals.length === 0 ? (
                  <div className="border border-dashed border-[rgba(255,255,255,0.1)] rounded-[var(--radius-sm)] py-6 text-center">
                    <span className="label-mono">Drop deals here</span>
                  </div>
                ) : (
                  col.deals.map((o) => (
                    <DealCard
                      key={o.id}
                      opp={o}
                      accountName={maps.accounts?.[o.account_id]}
                      onOpen={() => {
                        if (dragHappened.current) return;
                        navigate(`/opportunities/${o.id}`);
                      }}
                    />
                  ))
                )}
              </StageColumn>
            ))}
          </div>

          <DragOverlay>
            {activeOpp && (
              <div className="w-60 bg-[var(--navy-surface)] border border-[rgba(60,201,152,0.45)] rounded-[var(--radius-md)] p-3 shadow-[0_0_20px_rgba(60,201,152,0.2)]">
                <p className="text-sm font-medium text-[var(--foreground)] truncate">
                  {activeOpp.name}
                </p>
                <p className="font-[var(--font-mono)] text-xs text-[var(--mint)] mt-1">
                  {fmtCurrency(activeOpp.amount, activeOpp.currency || undefined)}
                </p>
              </div>
            )}
          </DragOverlay>
        </DndContext>
      )}
    </div>
  );
}
