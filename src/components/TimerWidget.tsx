import { useCallback, useEffect, useRef, useState } from "react";
import { Play, Plus, Square, Timer } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { invalidateLookup, useLookupOptions } from "../lib/lookups";
import RecordForm from "./RecordForm";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Textarea,
  Toggle,
} from "./ui";

export interface RunningEntry {
  id: string;
  project_id: string;
  task_id: string | null;
  start_time: number;
  description: string | null;
}

function startOfDayMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function fmtElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function notifyTimeEntriesChanged() {
  window.dispatchEvent(new CustomEvent("time-entries-changed"));
}

/* ---------- Start modal ---------- */

interface ProjectOption {
  id: string;
  name: string;
}

function StartTimerModal({
  onClose,
  onStarted,
}: {
  onClose: () => void;
  onStarted: (entry: RunningEntry) => void;
}) {
  const { profile } = useAuth();
  const accounts = useLookupOptions("accounts");
  const [accountId, setAccountId] = useState("");
  const [projectId, setProjectId] = useState("");
  // null while no client is selected or a fetch is in flight
  const [openProjects, setOpenProjects] = useState<ProjectOption[] | null>(null);
  const [reload, setReload] = useState(0);
  // Project id to select once the list refetches (set by quick-create)
  const pendingSelect = useRef<string | null>(null);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Load the selected client's open projects — closed (completed/cancelled)
  // projects never enter the LOV. Defaults to the most recently updated one.
  useEffect(() => {
    if (!accountId) {
      setOpenProjects(null);
      setProjectId("");
      return;
    }
    let cancelled = false;
    setOpenProjects(null);
    supabase
      .from("projects")
      .select("id, name")
      .eq("account_id", accountId)
      .not("status", "in", "(completed,cancelled)")
      .order("updated_at", { ascending: false })
      .limit(500)
      .then(({ data }) => {
        if (cancelled) return;
        const list = (data ?? []) as ProjectOption[];
        setOpenProjects(list);
        const wanted = pendingSelect.current;
        pendingSelect.current = null;
        setProjectId(
          wanted && list.some((p) => p.id === wanted)
            ? wanted
            : (list[0]?.id ?? ""),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [accountId, reload]);

  async function projectCreated(id: string) {
    setShowCreateProject(false);
    invalidateLookup("projects");
    // The user may have picked a different client inside the form — follow
    // the created project's account so the cascade stays consistent.
    const { data } = await supabase
      .from("projects")
      .select("id, account_id")
      .eq("id", id)
      .maybeSingle();
    const acc = data?.account_id ? String(data.account_id) : "";
    pendingSelect.current = id;
    if (acc && acc !== accountId) setAccountId(acc);
    else setReload((r) => r + 1);
  }

  async function start() {
    if (!accountId) {
      setError("Select a client first.");
      return;
    }
    if (!projectId) {
      setError("Select a project to track time against.");
      return;
    }
    setBusy(true);
    const now = Date.now();
    const { data, error } = await supabase
      .from("time_entries")
      .insert({
        project_id: projectId,
        user_id: profile?.id ?? "system",
        date: startOfDayMs(),
        start_time: now,
        duration: 0,
        description: description.trim() || null,
        is_billable: true,
        is_running: true,
        created_at: now,
        updated_at: now,
      })
      .select("id, project_id, task_id, start_time, description")
      .single();
    setBusy(false);
    if (error || !data) {
      setError(error?.message ?? "Failed to start timer.");
      return;
    }
    onStarted(data as RunningEntry);
  }

  return (
    <Modal title="Start Timer" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <FieldLabel required>Client</FieldLabel>
          <Select
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">— Select client —</option>
            {accounts.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <FieldLabel required>Project</FieldLabel>
          <div className="flex gap-2">
            <Select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!accountId}
              className="flex-1"
            >
              <option value="">
                {!accountId
                  ? "— Select client first —"
                  : openProjects === null
                    ? "Loading…"
                    : "— Select project —"}
              </option>
              {(openProjects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
            <button
              type="button"
              onClick={() => setShowCreateProject(true)}
              title="New Project"
              aria-label="New Project"
              className="flex shrink-0 items-center justify-center w-10 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
            >
              <Plus size={16} strokeWidth={1.8} />
            </button>
          </div>
          {accountId && openProjects && openProjects.length === 0 && (
            <p className="text-xs text-[var(--text-faint)] mt-1.5">
              No open projects for this client — create one with the + button.
            </p>
          )}
        </div>
        <div>
          <FieldLabel>What are you working on?</FieldLabel>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional — you can fill this in when you stop"
          />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={start} disabled={busy}>
            <Play size={15} strokeWidth={2} />
            {busy ? "Starting…" : "Start Timer"}
          </Button>
        </div>
      </div>
      {showCreateProject && (
        <RecordForm
          object="projects"
          record={null}
          prefill={accountId ? { account_id: accountId } : undefined}
          onClose={() => setShowCreateProject(false)}
          onSaved={projectCreated}
        />
      )}
    </Modal>
  );
}

/* ---------- Stop modal ---------- */

interface TaskOption {
  id: string;
  name: string;
}

function StopTimerModal({
  entry,
  onClose,
  onStopped,
}: {
  entry: RunningEntry;
  onClose: () => void;
  onStopped: () => void;
}) {
  const { profile } = useAuth();
  const projects = useLookupOptions("projects");
  const [projectId, setProjectId] = useState(entry.project_id);
  const [description, setDescription] = useState(entry.description ?? "");
  const [billable, setBillable] = useState(true);
  const [taskMode, setTaskMode] = useState<"none" | "existing" | "new">("none");
  const [taskId, setTaskId] = useState(entry.task_id ?? "");
  const [newTaskName, setNewTaskName] = useState("");
  const [tasks, setTasks] = useState<TaskOption[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // Load tasks for the selected project
  useEffect(() => {
    if (!projectId) {
      setTasks([]);
      return;
    }
    supabase
      .from("tasks")
      .select("id, name")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false })
      .limit(200)
      .then(({ data }) => setTasks((data ?? []) as TaskOption[]));
  }, [projectId]);

  const elapsedMs = now - entry.start_time;
  const durationHours = Math.max(0.01, +(elapsedMs / 3600000).toFixed(2));

  async function stop() {
    if (taskMode === "existing" && !taskId) {
      setError("Pick a task, or choose a different option.");
      return;
    }
    if (taskMode === "new" && !newTaskName.trim()) {
      setError("Enter a name for the new task.");
      return;
    }
    setBusy(true);
    setError("");
    const endTime = Date.now();
    const me = profile?.id ?? "system";

    let finalTaskId: string | null =
      taskMode === "existing" ? taskId : null;

    if (taskMode === "new") {
      const { data: task, error: taskErr } = await supabase
        .from("tasks")
        .insert({
          project_id: projectId,
          name: newTaskName.trim(),
          status: "in_progress",
          owner_id: me,
          created_by_id: me,
          created_at: endTime,
          updated_at: endTime,
        })
        .select("id")
        .single();
      if (taskErr || !task) {
        setBusy(false);
        setError(taskErr?.message ?? "Failed to create task.");
        return;
      }
      finalTaskId = (task as { id: string }).id;
    }

    const { error: updErr } = await supabase
      .from("time_entries")
      .update({
        project_id: projectId,
        task_id: finalTaskId,
        end_time: endTime,
        duration: +((endTime - entry.start_time) / 3600000).toFixed(2) || 0.01,
        description: description.trim() || null,
        is_billable: billable,
        is_running: false,
        updated_at: endTime,
      })
      .eq("id", entry.id);
    setBusy(false);
    if (updErr) {
      setError(updErr.message);
      return;
    }
    notifyTimeEntriesChanged();
    onStopped();
  }

  const segBtn = (mode: "none" | "existing" | "new", label: string) => (
    <button
      type="button"
      onClick={() => setTaskMode(mode)}
      className={`px-3 py-1.5 text-xs font-[var(--font-mono)] uppercase tracking-wider rounded-[var(--radius-sm)] cursor-pointer transition-colors ${
        taskMode === mode
          ? "bg-[var(--navy-surface)] text-[var(--mint)]"
          : "text-[var(--text-faint)] hover:text-[var(--foreground)]"
      }`}
    >
      {label}
    </button>
  );

  return (
    <Modal title="Stop Timer" onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}

        {/* Elapsed */}
        <div className="bg-[var(--section-darker)] border border-[rgba(60,201,152,0.15)] rounded-[var(--radius-md)] p-4 text-center">
          <p className="label-mono mb-1">Elapsed Time</p>
          <p className="font-[var(--font-mono)] text-3xl text-[var(--mint)]">
            {fmtElapsed(elapsedMs)}
          </p>
          <p className="text-xs text-[var(--text-faint)] mt-1">
            ≈ {durationHours.toFixed(2)} hours
          </p>
        </div>

        <div>
          <FieldLabel required>Project</FieldLabel>
          <Select
            value={projectId}
            onChange={(e) => {
              setProjectId(e.target.value);
              setTaskId("");
            }}
          >
            {projects.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>

        {/* Task association */}
        <div>
          <FieldLabel>Relate to Task</FieldLabel>
          <div className="inline-flex items-center gap-1 bg-[var(--section-darker)] rounded-[var(--radius)] p-0.5 mb-3">
            {segBtn("none", "No Task")}
            {segBtn("existing", "Existing Task")}
            {segBtn("new", "Quick-Create")}
          </div>
          {taskMode === "existing" && (
            <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">— Select task —</option>
              {tasks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          )}
          {taskMode === "new" && (
            <Input
              value={newTaskName}
              onChange={(e) => setNewTaskName(e.target.value)}
              placeholder="New task name"
            />
          )}
        </div>

        <div>
          <FieldLabel>What was done</FieldLabel>
          <Textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Short summary of the work"
          />
        </div>

        <Toggle checked={billable} onChange={setBillable} label="Billable" />

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="subtle" onClick={onClose}>
            Keep Running
          </Button>
          <Button onClick={stop} disabled={busy}>
            <Square size={14} strokeWidth={2} />
            {busy ? "Saving…" : "Stop & Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ---------- Header widget ---------- */

export default function TimerWidget() {
  const { profile } = useAuth();
  const [running, setRunning] = useState<RunningEntry | null>(null);
  const [now, setNow] = useState(Date.now());
  const [showStart, setShowStart] = useState(false);
  const [showStop, setShowStop] = useState(false);

  const refresh = useCallback(() => {
    if (!profile) return;
    supabase
      .from("time_entries")
      .select("id, project_id, task_id, start_time, description")
      .eq("user_id", profile.id)
      .eq("is_running", true)
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setRunning((data as RunningEntry) ?? null));
  }, [profile]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);

  if (running) {
    return (
      <>
        <button
          onClick={() => setShowStop(true)}
          className="inline-flex items-center gap-2.5 bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.3)] rounded-[var(--radius-md)] px-3.5 py-1.5 cursor-pointer transition-all duration-300 hover:border-[rgba(60,201,152,0.5)] glow-mint"
          title="Stop timer"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] animate-pulse" />
          <span className="font-[var(--font-mono)] text-sm text-[var(--mint)]">
            {fmtElapsed(now - running.start_time)}
          </span>
          <Square
            size={12}
            strokeWidth={2}
            className="text-[var(--mint)] fill-[var(--mint)]"
          />
        </button>
        {showStop && (
          <StopTimerModal
            entry={running}
            onClose={() => setShowStop(false)}
            onStopped={() => {
              setShowStop(false);
              setRunning(null);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setShowStart(true)}
        className="inline-flex items-center gap-2 bg-transparent text-[var(--text-dim)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-md)] px-3.5 py-1.5 text-sm cursor-pointer transition-all duration-300 hover:text-[var(--mint)] hover:border-[rgba(60,201,152,0.3)]"
        title="Start timer"
      >
        <Timer size={15} strokeWidth={1.5} />
        Start Timer
      </button>
      {showStart && (
        <StartTimerModal
          onClose={() => setShowStart(false)}
          onStarted={(entry) => {
            setShowStart(false);
            setRunning(entry);
          }}
        />
      )}
    </>
  );
}
