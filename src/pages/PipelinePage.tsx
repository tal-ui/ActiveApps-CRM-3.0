import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Kanban } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, type PicklistOption } from "../lib/objects";
import { useLookupMaps } from "../lib/lookups";
import { fmtCurrency, fmtDate } from "../lib/format";
import { EmptyState, ErrorNote, Spinner } from "../components/ui";
import KanbanBoard from "../components/KanbanBoard";

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

function DealCardBody({
  opp,
  accountName,
}: {
  opp: Opportunity;
  accountName?: string;
}) {
  const overdue =
    !!opp.close_date && Number(opp.close_date) < Date.now() && !CLOSED.includes(opp.stage);
  return (
    <>
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
    </>
  );
}

export default function PipelinePage() {
  const navigate = useNavigate();
  const [opps, setOpps] = useState<Opportunity[] | null>(null);
  const [error, setError] = useState("");
  const maps = useLookupMaps(["accounts"]);

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
    const open = list.filter((o) => !CLOSED.includes(o.stage));
    return {
      openCount: open.length,
      openTotal: open.reduce((s, o) => s + Number(o.amount ?? 0), 0),
    };
  }, [opps]);

  async function onMove(id: string, toStage: string): Promise<string | null> {
    const opp = (opps ?? []).find((o) => o.id === id);
    if (!opp || opp.stage === toStage) return null;
    const fromStage = opp.stage;
    setError("");
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
    if (err) return err.message;
    setOpps((prev) =>
      prev ? prev.map((o) => (o.id === id ? { ...o, stage: toStage } : o)) : prev,
    );
    return null;
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
        <KanbanBoard<Opportunity>
          items={opps}
          columns={STAGES}
          getColumn={(o) => o.stage}
          onMove={onMove}
          columnTone={{ closed_won: "positive", closed_lost: "muted" }}
          columnMeta={(deals, stage) => {
            const won = stage.value === "closed_won";
            const lost = stage.value === "closed_lost";
            return (
              <p
                className={`font-[var(--font-mono)] text-xs ${
                  won
                    ? "text-[var(--mint)]"
                    : lost
                      ? "text-[var(--text-faint)]"
                      : "text-[var(--text-mid)]"
                }`}
              >
                {fmtCurrency(deals.reduce((sum, o) => sum + Number(o.amount ?? 0), 0))}
              </p>
            );
          }}
          renderCard={(o) => (
            <DealCardBody opp={o} accountName={maps.accounts?.[o.account_id]} />
          )}
          renderOverlay={(o) => (
            <div className="w-60 bg-[var(--navy-surface)] border border-[rgba(60,201,152,0.45)] rounded-[var(--radius-md)] p-3 shadow-[0_0_20px_rgba(60,201,152,0.2)]">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">{o.name}</p>
              <p className="font-[var(--font-mono)] text-xs text-[var(--mint)] mt-1">
                {fmtCurrency(o.amount, o.currency || undefined)}
              </p>
            </div>
          )}
          onOpen={(o) => navigate(`/opportunities/${o.id}`)}
          onError={setError}
          emptyLabel="Drop deals here"
        />
      )}
    </div>
  );
}
