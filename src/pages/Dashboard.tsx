import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Clock,
  FolderKanban,
  Target,
  TrendingUp,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  fmtCurrency,
  fmtDateTime,
  fmtHours,
  startOfMonthMs,
  titleCase,
} from "../lib/format";
import { Spinner } from "../components/ui";

interface Opp {
  stage: string;
  amount: number | null;
}
interface RecentActivity {
  id: string;
  type: string;
  subject: string;
  date: number;
  related_to_type: string;
  related_to_id: string;
}

const OPEN_STAGES = ["discovery", "qualification", "proposal", "negotiation"];

export default function Dashboard() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [openLeads, setOpenLeads] = useState(0);
  const [activeProjects, setActiveProjects] = useState(0);
  const [hoursMonth, setHoursMonth] = useState(0);
  const [billableMonth, setBillableMonth] = useState(0);
  const [recent, setRecent] = useState<RecentActivity[]>([]);

  useEffect(() => {
    async function load() {
      const [oppRes, leadRes, projRes, timeRes, actRes] = await Promise.all([
        supabase.from("opportunities").select("stage, amount"),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "contacted", "qualified"]),
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .in("status", ["planning", "in_progress"]),
        supabase
          .from("time_entries")
          .select("duration, is_billable")
          .gte("date", startOfMonthMs()),
        supabase
          .from("activities")
          .select("id, type, subject, date, related_to_type, related_to_id")
          .order("date", { ascending: false })
          .limit(8),
      ]);
      setOpps((oppRes.data ?? []) as Opp[]);
      setOpenLeads(leadRes.count ?? 0);
      setActiveProjects(projRes.count ?? 0);
      const entries = (timeRes.data ?? []) as {
        duration: number | null;
        is_billable: boolean;
      }[];
      setHoursMonth(entries.reduce((s, e) => s + Number(e.duration ?? 0), 0));
      setBillableMonth(
        entries
          .filter((e) => e.is_billable)
          .reduce((s, e) => s + Number(e.duration ?? 0), 0),
      );
      setRecent((actRes.data ?? []) as RecentActivity[]);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) return <Spinner />;

  const openOpps = opps.filter((o) => OPEN_STAGES.includes(o.stage));
  const pipelineValue = openOpps.reduce((s, o) => s + Number(o.amount ?? 0), 0);
  const stageTotals = OPEN_STAGES.map((stage) => ({
    stage,
    total: opps
      .filter((o) => o.stage === stage)
      .reduce((s, o) => s + Number(o.amount ?? 0), 0),
    count: opps.filter((o) => o.stage === stage).length,
  }));
  const maxStage = Math.max(1, ...stageTotals.map((s) => s.total));

  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";

  const stats = [
    {
      label: "Open Pipeline",
      value: fmtCurrency(pipelineValue),
      sub: `${openOpps.length} open opportunit${openOpps.length === 1 ? "y" : "ies"}`,
      icon: TrendingUp,
      to: "/opportunities",
    },
    {
      label: "Open Leads",
      value: String(openLeads),
      sub: "new · contacted · qualified",
      icon: Target,
      to: "/leads",
    },
    {
      label: "Active Projects",
      value: String(activeProjects),
      sub: "planning & in progress",
      icon: FolderKanban,
      to: "/projects",
    },
    {
      label: "Hours This Month",
      value: fmtHours(hoursMonth),
      sub: `${fmtHours(billableMonth)} billable`,
      icon: Clock,
      to: "/time_entries",
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] rounded-[var(--radius)] px-3 py-1 mb-3 font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.15em] text-[var(--mint)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] animate-pulse" />
          Command Center
        </span>
        <h1 className="font-[var(--font-heading)] font-bold text-2xl text-[var(--foreground)]">
          Welcome back, {firstName}
        </h1>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <Link
              key={s.label}
              to={s.to}
              className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 cursor-pointer transition-all duration-300 hover:border-[rgba(60,201,152,0.25)] hover:shadow-[0_0_20px_rgba(60,201,152,0.1)] block"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="label-mono">{s.label}</span>
                <Icon size={16} strokeWidth={1.5} className="text-[var(--text-dim)]" />
              </div>
              <p className="font-[var(--font-heading)] font-bold text-2xl text-[var(--foreground)]">
                {s.value}
              </p>
              <p className="text-xs text-[var(--text-faint)] mt-1">{s.sub}</p>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Pipeline by stage */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
            Pipeline by Stage
          </h3>
          <div className="space-y-4">
            {stageTotals.map((s, i) => (
              <div key={s.stage}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="label-mono">{titleCase(s.stage)}</span>
                  <span className="font-[var(--font-mono)] text-xs text-[var(--text-mid)]">
                    {fmtCurrency(s.total)} · {s.count}
                  </span>
                </div>
                <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(2, (s.total / maxStage) * 100)}%`,
                      background: `var(--chart-${i + 1})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          {openOpps.length === 0 && (
            <p className="text-sm text-[var(--text-dim)] mt-4">
              No open opportunities.{" "}
              <Link to="/opportunities" className="text-[var(--mint)] hover:underline">
                Create one →
              </Link>
            </p>
          )}
        </section>

        {/* Recent activity */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
            Recent Activity
          </h3>
          {recent.length === 0 ? (
            <p className="text-sm text-[var(--text-dim)]">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {recent.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 border-b border-[rgba(255,255,255,0.04)] last:border-b-0 pb-3 last:pb-0"
                >
                  <div className="min-w-0">
                    <Link
                      to={`/${a.related_to_type === "account" ? "accounts" : a.related_to_type === "contact" ? "contacts" : a.related_to_type === "lead" ? "leads" : a.related_to_type === "opportunity" ? "opportunities" : "projects"}/${a.related_to_id}`}
                      className="text-sm text-[var(--text-light)] hover:text-[var(--mint)] transition-colors truncate block cursor-pointer"
                    >
                      {a.subject}
                    </Link>
                    <span className="label-mono">{titleCase(a.type)}</span>
                  </div>
                  <span className="text-xs text-[var(--text-faint)] shrink-0">
                    {fmtDateTime(a.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Diamond divider */}
      <div className="flex items-center justify-center gap-4 py-10">
        <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[rgba(60,201,152,0.2)]" />
        <div className="w-2.5 h-2.5 rotate-45 border border-[var(--mint)]" />
        <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[rgba(60,201,152,0.2)]" />
      </div>
      <p className="text-center text-xs text-[var(--text-muted)] pb-4">
        ActiveApps CRM 3.0 · Tech Orchestration
      </p>
    </div>
  );
}
