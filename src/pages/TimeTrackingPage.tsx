import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Download, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS } from "../lib/objects";
import { useLookupMaps, useLookupOptions } from "../lib/lookups";
import { fmtCurrency, fmtHours } from "../lib/format";
import { Button, EmptyState, Input, Select, Spinner } from "../components/ui";
import DataTable from "../components/DataTable";
import RecordForm from "../components/RecordForm";

interface Entry {
  id: string;
  project_id: string;
  task_id: string | null;
  date: number;
  duration: number | string;
  is_billable: boolean;
  hourly_rate: number | null;
  description: string | null;
  is_running: boolean;
  [key: string]: unknown;
}

function currentMonthInput(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthBounds(month: string): { start: number; end: number; label: string } {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 1);
  return {
    start: start.getTime(),
    end: end.getTime(),
    label: start.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
  };
}

export default function TimeTrackingPage() {
  const def = OBJECTS.time_entries;
  const navigate = useNavigate();
  const [month, setMonth] = useState(currentMonthInput());
  const [projectId, setProjectId] = useState("");
  const [billableFilter, setBillableFilter] = useState<"all" | "billable" | "non">("all");
  const [rows, setRows] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [reload, setReload] = useState(0);
  const [exporting, setExporting] = useState(false);

  const projects = useLookupOptions("projects");
  const lookupMaps = useLookupMaps(["projects", "tasks"]);

  // Refresh when the global timer saves an entry
  useEffect(() => {
    const handler = () => setReload((r) => r + 1);
    window.addEventListener("time-entries-changed", handler);
    return () => window.removeEventListener("time-entries-changed", handler);
  }, []);

  useEffect(() => {
    setLoading(true);
    const { start, end } = monthBounds(month);
    let query = supabase
      .from("time_entries")
      .select("*")
      .gte("date", start)
      .lt("date", end)
      .order("date", { ascending: false })
      .limit(2000);
    if (projectId) query = query.eq("project_id", projectId);
    query.then(({ data }) => {
      setRows((data ?? []) as Entry[]);
      setLoading(false);
    });
  }, [month, projectId, reload]);

  const filtered = useMemo(() => {
    if (billableFilter === "all") return rows;
    return rows.filter((r) =>
      billableFilter === "billable" ? r.is_billable : !r.is_billable,
    );
  }, [rows, billableFilter]);

  const totals = useMemo(() => {
    const completed = filtered.filter((r) => !r.is_running);
    const total = completed.reduce((s, r) => s + Number(r.duration ?? 0), 0);
    const billable = completed
      .filter((r) => r.is_billable)
      .reduce((s, r) => s + Number(r.duration ?? 0), 0);
    const value = completed
      .filter((r) => r.is_billable)
      .reduce((s, r) => s + Number(r.duration ?? 0) * Number(r.hourly_rate ?? 0), 0);
    return { total, billable, nonBillable: total - billable, value };
  }, [filtered]);

  const byProject = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      if (r.is_running) continue;
      const label = lookupMaps.projects?.[r.project_id] ?? "Unknown project";
      map.set(label, (map.get(label) ?? 0) + Number(r.duration ?? 0));
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [filtered, lookupMaps]);
  const maxProjectHours = Math.max(1, ...byProject.map(([, h]) => h));

  const columns = useMemo(() => {
    const names = ["project_id", "task_id", "date", "duration", "is_billable", "description"];
    return names
      .map((n) => def.fields.find((f) => f.name === n))
      .filter((f): f is NonNullable<typeof f> => !!f);
  }, [def]);

  async function exportPdf() {
    setExporting(true);
    const { generateMonthlyReport } = await import("../lib/pdf");
    const { label } = monthBounds(month);
    const projectName = projectId
      ? (projects.find((p) => p.value === projectId)?.label ?? "Project")
      : "All Projects";
    await generateMonthlyReport({
      monthLabel: label,
      projectFilter: projectName,
      entries: filtered
        .filter((r) => !r.is_running)
        .map((r) => ({
          date: Number(r.date),
          duration: Number(r.duration ?? 0),
          is_billable: r.is_billable,
          hourly_rate: r.hourly_rate != null ? Number(r.hourly_rate) : null,
          description: r.description,
          project: lookupMaps.projects?.[r.project_id] ?? "Unknown project",
          task: r.task_id ? (lookupMaps.tasks?.[r.task_id] ?? "") : "",
        })),
    });
    setExporting(false);
  }

  const stats = [
    { label: "Total Hours", value: fmtHours(totals.total) },
    { label: "Billable", value: fmtHours(totals.billable) },
    { label: "Non-Billable", value: fmtHours(totals.nonBillable) },
    { label: "Billable Value", value: fmtCurrency(totals.value) },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Clock size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Time Tracking
            </h1>
            <p className="label-mono">
              {filtered.length} entr{filtered.length === 1 ? "y" : "ies"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            onClick={exportPdf}
            disabled={exporting || filtered.length === 0}
          >
            <Download size={15} strokeWidth={1.5} />
            {exporting ? "Generating…" : "Export PDF"}
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} />
            Log Time
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-4 mb-6">
        <div>
          <p className="label-mono mb-1.5">Month</p>
          <Input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className="w-44"
          />
        </div>
        <div>
          <p className="label-mono mb-1.5">Project</p>
          <Select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-56"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <p className="label-mono mb-1.5">Billing</p>
          <Select
            value={billableFilter}
            onChange={(e) =>
              setBillableFilter(e.target.value as "all" | "billable" | "non")
            }
            className="w-40"
          >
            <option value="all">All entries</option>
            <option value="billable">Billable only</option>
            <option value="non">Non-billable</option>
          </Select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5"
          >
            <p className="label-mono mb-2">{s.label}</p>
            <p className="font-[var(--font-heading)] font-bold text-2xl text-[var(--foreground)]">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Hours by project */}
      {byProject.length > 0 && (
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)] mb-4">
            Hours by Project
          </h3>
          <div className="space-y-3">
            {byProject.map(([label, hours], i) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--text-mid)] truncate">{label}</span>
                  <span className="font-[var(--font-mono)] text-xs text-[var(--text-light)]">
                    {fmtHours(hours)}
                  </span>
                </div>
                <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(2, (hours / maxProjectHours) * 100)}%`,
                      background: `var(--chart-${Math.min(i + 1, 5)})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Entries table */}
      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState message="No time entries for this period. Start the timer or log time manually." />
      ) : (
        <DataTable
          columns={columns}
          rows={filtered}
          lookupMaps={lookupMaps}
          onRowClick={(row) => navigate(`/time_entries/${row.id}`)}
        />
      )}

      {showForm && (
        <RecordForm
          object="time_entries"
          record={null}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            setReload((r) => r + 1);
          }}
        />
      )}
    </div>
  );
}
