import { useEffect, useMemo, useState } from "react";
import { CalendarRange } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLookupMaps } from "../lib/lookups";
import { fmtCurrency, fmtHours } from "../lib/format";
import { Input, Spinner } from "../components/ui";

interface Entry {
  project_id: string;
  user_id: string;
  duration: number | string;
  is_billable: boolean;
}
interface TaskRow {
  created_at: number;
  updated_at: number;
  status: string;
}
interface ProjectRow {
  id: string;
  name: string;
  status: string;
  budget_hours: number | string | null;
}

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: number; end: number } {
  const [y, m] = month.split("-").map(Number);
  return {
    start: new Date(y, m - 1, 1).getTime(),
    end: new Date(y, m, 1).getTime(),
  };
}

function BarRow({
  label,
  value,
  max,
  display,
  colorIndex,
}: {
  label: string;
  value: number;
  max: number;
  display: string;
  colorIndex: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-[var(--text-mid)] truncate">{label}</span>
        <span className="font-[var(--font-mono)] text-xs text-[var(--text-light)]">{display}</span>
      </div>
      <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.max(2, (value / max) * 100)}%`,
            background: `var(--chart-${Math.min(colorIndex + 1, 5)})`,
          }}
        />
      </div>
    </div>
  );
}

export default function MonthlyDashboard() {
  const [month, setMonth] = useState(currentMonthInput());
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [allTimeByProject, setAllTimeByProject] = useState<Record<string, number>>({});
  const [revenue, setRevenue] = useState(0);
  const [profiles, setProfiles] = useState<Record<string, string>>({});
  const maps = useLookupMaps(["projects"]);

  useEffect(() => {
    const { start, end } = monthBounds(month);
    Promise.all([
      supabase
        .from("time_entries")
        .select("project_id, user_id, duration, is_billable")
        .eq("is_running", false)
        .gte("date", start)
        .lt("date", end)
        .limit(2000),
      supabase.from("tasks").select("created_at, updated_at, status").limit(2000),
      supabase
        .from("projects")
        .select("id, name, status, budget_hours")
        .in("status", ["planning", "in_progress", "on_hold"])
        .limit(200),
      supabase
        .from("time_entries")
        .select("project_id, duration")
        .eq("is_running", false)
        .limit(5000),
      supabase
        .from("invoices")
        .select("total_amount, paid_date")
        .eq("status", "paid")
        .gte("paid_date", start)
        .lt("paid_date", end),
      supabase.from("profiles").select("id, full_name").limit(100),
    ]).then(([timeRes, taskRes, projRes, allTimeRes, revRes, profRes]) => {
      setEntries((timeRes.data ?? []) as Entry[]);
      setTasks((taskRes.data ?? []) as TaskRow[]);
      setProjects((projRes.data ?? []) as ProjectRow[]);
      const byProject: Record<string, number> = {};
      for (const e of (allTimeRes.data ?? []) as { project_id: string; duration: number | string }[]) {
        byProject[e.project_id] = (byProject[e.project_id] ?? 0) + Number(e.duration ?? 0);
      }
      setAllTimeByProject(byProject);
      setRevenue(
        ((revRes.data ?? []) as { total_amount: number | string }[]).reduce(
          (s, i) => s + Number(i.total_amount ?? 0),
          0,
        ),
      );
      setProfiles(
        Object.fromEntries(
          ((profRes.data ?? []) as { id: string; full_name: string }[]).map((p) => [p.id, p.full_name]),
        ),
      );
    });
  }, [month]);

  const view = useMemo(() => {
    if (!entries) return null;
    const { start, end } = monthBounds(month);
    const total = entries.reduce((s, e) => s + Number(e.duration ?? 0), 0);
    const billable = entries.filter((e) => e.is_billable).reduce((s, e) => s + Number(e.duration ?? 0), 0);

    const byProject = new Map<string, number>();
    const byUser = new Map<string, number>();
    for (const e of entries) {
      byProject.set(e.project_id, (byProject.get(e.project_id) ?? 0) + Number(e.duration ?? 0));
      byUser.set(e.user_id, (byUser.get(e.user_id) ?? 0) + Number(e.duration ?? 0));
    }

    const tasksCreated = tasks.filter((t) => Number(t.created_at) >= start && Number(t.created_at) < end).length;
    const tasksCompleted = tasks.filter(
      (t) => t.status === "done" && Number(t.updated_at) >= start && Number(t.updated_at) < end,
    ).length;

    return {
      total,
      billable,
      nonBillable: total - billable,
      byProject: Array.from(byProject.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
      byUser: Array.from(byUser.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6),
      tasksCreated,
      tasksCompleted,
    };
  }, [entries, tasks, month]);

  if (!view) return <Spinner />;

  const maxProject = Math.max(1, ...view.byProject.map(([, h]) => h));
  const maxUser = Math.max(1, ...view.byUser.map(([, h]) => h));

  const stats = [
    { label: "Hours Logged", value: fmtHours(view.total) },
    { label: "Billable", value: fmtHours(view.billable) },
    { label: "Tasks Done / New", value: `${view.tasksCompleted} / ${view.tasksCreated}` },
    { label: "Revenue Collected", value: fmtCurrency(revenue) },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <CalendarRange size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Monthly Operations
            </h1>
            <p className="label-mono">team output and budget health</p>
          </div>
        </div>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        {stats.map((s) => (
          <div key={s.label} className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
            <p className="label-mono mb-2">{s.label}</p>
            <p className="font-[var(--font-heading)] font-bold text-2xl text-[var(--foreground)]">{s.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Hours by project */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
            Hours by Project
          </h3>
          {view.byProject.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">No hours logged this month.</p>
          ) : (
            <div className="space-y-3">
              {view.byProject.map(([id, h], i) => (
                <BarRow
                  key={id}
                  label={maps.projects?.[id] ?? "Project"}
                  value={h}
                  max={maxProject}
                  display={fmtHours(h)}
                  colorIndex={i}
                />
              ))}
            </div>
          )}
        </section>

        {/* Hours by team member */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
            Hours by Team Member
          </h3>
          {view.byUser.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">No hours logged this month.</p>
          ) : (
            <div className="space-y-3">
              {view.byUser.map(([id, h], i) => (
                <BarRow
                  key={id}
                  label={profiles[id] ?? "Team member"}
                  value={h}
                  max={maxUser}
                  display={fmtHours(h)}
                  colorIndex={i}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-6 mt-5 pt-4 border-t border-[rgba(255,255,255,0.05)]">
            <span className="text-xs text-[var(--text-faint)]">
              Billable <span className="text-[var(--mint)] font-[var(--font-mono)]">{fmtHours(view.billable)}</span>
            </span>
            <span className="text-xs text-[var(--text-faint)]">
              Non-billable <span className="text-[var(--text-mid)] font-[var(--font-mono)]">{fmtHours(view.nonBillable)}</span>
            </span>
          </div>
        </section>
      </div>

      {/* Budget vs actual */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
        <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
          Budget vs Actual Hours (Active Projects)
        </h3>
        {projects.filter((p) => p.budget_hours).length === 0 ? (
          <p className="text-sm text-[var(--text-dim)]">No active projects with an hours budget.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
            {projects
              .filter((p) => p.budget_hours)
              .map((p) => {
                const used = allTimeByProject[p.id] ?? 0;
                const budget = Number(p.budget_hours);
                const pct = Math.min(100, (used / budget) * 100);
                const over = used > budget;
                return (
                  <div key={p.id}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm text-[var(--text-mid)] truncate">{p.name}</span>
                      <span className={`font-[var(--font-mono)] text-xs ${over ? "text-[#F2697A]" : "text-[var(--text-light)]"}`}>
                        {fmtHours(used)} / {fmtHours(budget)}
                      </span>
                    </div>
                    <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-700"
                        style={{
                          width: `${Math.max(2, pct)}%`,
                          background: over ? "#E40016" : "var(--mint)",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </div>
  );
}
