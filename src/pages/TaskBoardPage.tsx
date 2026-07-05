import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, List } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS, type PicklistOption } from "../lib/objects";
import { useLookupMaps } from "../lib/lookups";
import { fmtDate } from "../lib/format";
import { Badge, Button, EmptyState, ErrorNote, Spinner } from "../components/ui";
import KanbanBoard from "../components/KanbanBoard";

interface TaskRow {
  id: string;
  name: string;
  project_id: string | null;
  status: string;
  priority: string | null;
  due_date: number | null;
  assignee_id: string | null;
}

const STATUSES: PicklistOption[] =
  OBJECTS.tasks.fields.find((f) => f.name === "status")?.options ?? [];

function TaskCardBody({
  task,
  projectName,
  assigneeName,
}: {
  task: TaskRow;
  projectName?: string;
  assigneeName?: string;
}) {
  const overdue =
    !!task.due_date && Number(task.due_date) < Date.now() && task.status !== "done";
  return (
    <>
      <p className="text-sm font-medium text-[var(--foreground)] truncate">{task.name}</p>
      <p className="text-xs text-[var(--text-faint)] truncate">{projectName ?? "—"}</p>
      <div className="flex items-center justify-between gap-2 mt-2">
        {task.priority ? <Badge value={task.priority} /> : <span />}
        <span className={`text-xs ${overdue ? "text-[#F2697A]" : "text-[var(--text-dim)]"}`}>
          {fmtDate(task.due_date)}
        </span>
      </div>
      <p className="text-xs text-[var(--text-dim)] truncate mt-1.5">{assigneeName ?? "—"}</p>
    </>
  );
}

export default function TaskBoardPage() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const maps = useLookupMaps(["projects"]);

  useEffect(() => {
    supabase
      .from("tasks")
      .select("*")
      .limit(1000)
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setTasks((data ?? []) as TaskRow[]);
      });
    supabase
      .from("profiles")
      .select("id, full_name")
      .then(({ data }) => {
        const rows = (data ?? []) as { id: string; full_name: string }[];
        setProfiles(Object.fromEntries(rows.map((p) => [p.id, p.full_name])));
      });
  }, []);

  const openCount = useMemo(
    () => (tasks ?? []).filter((t) => t.status !== "done").length,
    [tasks],
  );

  async function onMove(id: string, toStatus: string): Promise<string | null> {
    setError("");
    const { error: err } = await supabase
      .from("tasks")
      .update({ status: toStatus, updated_at: Date.now() })
      .eq("id", id);
    if (err) return err.message;
    setTasks((prev) =>
      prev ? prev.map((t) => (t.id === id ? { ...t, status: toStatus } : t)) : prev,
    );
    return null;
  }

  if (!tasks) return <Spinner />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <CheckSquare size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Task Board
            </h1>
            <p className="label-mono">
              {openCount} open task{openCount === 1 ? "" : "s"} · {tasks.length} total
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={() => navigate("/tasks")}>
          <List size={15} strokeWidth={1.5} />
          List
        </Button>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}

      {tasks.length === 0 ? (
        <EmptyState message="No tasks yet. Create one from the Tasks list." />
      ) : (
        <KanbanBoard<TaskRow>
          items={tasks}
          columns={STATUSES}
          getColumn={(t) => t.status}
          onMove={onMove}
          columnTone={{ done: "positive" }}
          renderCard={(t) => (
            <TaskCardBody
              task={t}
              projectName={t.project_id ? maps.projects?.[t.project_id] : undefined}
              assigneeName={t.assignee_id ? profiles[t.assignee_id] : undefined}
            />
          )}
          renderOverlay={(t) => (
            <div className="w-60 bg-[var(--navy-surface)] border border-[rgba(60,201,152,0.45)] rounded-[var(--radius-md)] p-3 shadow-[0_0_20px_rgba(60,201,152,0.2)]">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">{t.name}</p>
              <p className="text-xs text-[var(--text-faint)] truncate mt-1">
                {(t.project_id ? maps.projects?.[t.project_id] : undefined) ?? "—"}
              </p>
            </div>
          )}
          onOpen={(t) => navigate(`/tasks/${t.id}`)}
          onError={setError}
          emptyLabel="Drop tasks here"
        />
      )}
    </div>
  );
}
