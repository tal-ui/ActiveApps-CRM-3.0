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
import { useLookupMaps } from "../lib/lookups";
import {
  fmtCurrency,
  fmtDate,
  fmtDateTime,
  fmtHours,
  startOfMonthMs,
  titleCase,
} from "../lib/format";
import { EmptyState, Spinner } from "../components/ui";

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
interface PaidInvoice {
  paid_date: number | null;
  total_amount: number | string | null;
}
interface MyTask {
  id: string;
  name: string;
  project_id: string;
  due_date: number | null;
}
interface ClosingOpp {
  id: string;
  name: string;
  account_id: string;
  amount: number | string | null;
  currency: string | null;
  close_date: number | null;
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
  const [paidInvoices, setPaidInvoices] = useState<PaidInvoice[]>([]);
  const [myTasks, setMyTasks] = useState<MyTask[]>([]);
  const [closingOpps, setClosingOpps] = useState<ClosingOpp[]>([]);
  const maps = useLookupMaps(["projects", "accounts"]);

  useEffect(() => {
    async function load() {
      const now = new Date();
      const revenueStart = new Date(now.getFullYear(), now.getMonth() - 5, 1).getTime();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      const [oppRes, leadRes, projRes, timeRes, actRes, paidRes, closingRes] = await Promise.all([
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
        supabase
          .from("invoices")
          .select("paid_date, total_amount")
          .eq("status", "paid")
          .gte("paid_date", revenueStart)
          .limit(2000),
        supabase
          .from("opportunities")
          .select("id, name, account_id, amount, currency, close_date")
          .not("stage", "in", "(closed_won,closed_lost)")
          .gte("close_date", startOfMonthMs())
          .lt("close_date", monthEnd)
          .order("close_date", { ascending: true })
          .limit(50),
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
      setPaidInvoices((paidRes.data ?? []) as PaidInvoice[]);
      setClosingOpps((closingRes.data ?? []) as ClosingOpp[]);
      setLoading(false);
    }
    load();
  }, []);

  useEffect(() => {
    const uid = profile?.id;
    if (!uid) return;
    let mounted = true;
    supabase
      .from("tasks")
      .select("id, name, project_id, due_date")
      .or(`assignee_id.eq.${uid},owner_id.eq.${uid}`)
      .in("status", ["todo", "in_progress", "in_review", "blocked"])
      .order("due_date", { ascending: true })
      .limit(8)
      .then(({ data }) => {
        if (mounted) setMyTasks((data ?? []) as MyTask[]);
      });
    return () => {
      mounted = false;
    };
  }, [profile?.id]);

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

  const nowDate = new Date();
  const revMonths: { label: string; total: number }[] = [];
  for (let m = 5; m >= 0; m--) {
    const start = new Date(nowDate.getFullYear(), nowDate.getMonth() - m, 1).getTime();
    const end = new Date(nowDate.getFullYear(), nowDate.getMonth() - m + 1, 1).getTime();
    revMonths.push({
      label: new Date(start).toLocaleDateString(undefined, { month: "short" }),
      total: paidInvoices
        .filter((i) => Number(i.paid_date ?? 0) >= start && Number(i.paid_date ?? 0) < end)
        .reduce((s, i) => s + Number(i.total_amount ?? 0), 0),
    });
  }
  const maxRevMonth = Math.max(1, ...revMonths.map((mo) => mo.total));
  const revTotal = revMonths.reduce((s, mo) => s + mo.total, 0);
  const closingTotal = closingOpps.reduce((s, o) => s + Number(o.amount ?? 0), 0);
  const nowMs = Date.now();

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
        <h1 className="font-[var(--font-heading)] font-bold text-2xl text-brand-gradient w-fit">
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
              className="relative overflow-hidden bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 cursor-pointer transition-all duration-300 hover:border-[rgba(60,201,152,0.25)] hover:shadow-[0_0_20px_rgba(60,201,152,0.1)] block"
            >
              <span
                aria-hidden
                className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--brand-grad-from)] via-[var(--brand-grad-via)] to-[var(--brand-grad-to)] opacity-70"
              />
              <div className="flex items-center justify-between mb-2">
                <span className="label-mono">{s.label}</span>
                <span className="w-8 h-8 rounded-[var(--radius-sm)] bg-[color-mix(in_oklab,var(--mint)_9%,transparent)] border border-[color-mix(in_oklab,var(--mint)_22%,transparent)] flex items-center justify-center">
                  <Icon size={15} strokeWidth={1.5} className="text-[var(--mint)]" />
                </span>
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

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 mt-6">
        {/* Revenue last 6 months */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between gap-3 mb-5">
            <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)]">
              Revenue — Last 6 Months
            </h3>
            <span className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] shrink-0">
              {fmtCurrency(revTotal)}
            </span>
          </div>
          <div className="flex items-end gap-3 h-40">
            {revMonths.map((mo) => (
              <div key={mo.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <div className="w-full flex items-end justify-center flex-1">
                  <div
                    className="w-1/2 rounded-t-sm transition-all duration-700"
                    style={{
                      height: `${Math.max(2, (mo.total / maxRevMonth) * 100)}%`,
                      background: "var(--chart-1)",
                    }}
                    title={`${mo.label} · ${fmtCurrency(mo.total)}`}
                  />
                </div>
                <span className="label-mono">{mo.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* My open tasks */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
            My Open Tasks
          </h3>
          {myTasks.length === 0 ? (
            <EmptyState message="No open tasks assigned to you." />
          ) : (
            <ul className="space-y-3">
              {myTasks.map((t) => (
                <li
                  key={t.id}
                  className="border-b border-[rgba(255,255,255,0.04)] last:border-b-0 pb-3 last:pb-0"
                >
                  <Link
                    to={`/tasks/${t.id}`}
                    className="flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-light)] group-hover:text-[var(--mint)] transition-colors truncate">
                        {t.name}
                      </p>
                      <span className="label-mono truncate block">
                        {maps.projects?.[t.project_id] ?? "Project"}
                      </span>
                    </div>
                    <span
                      className={`text-xs shrink-0 ${
                        t.due_date !== null && Number(t.due_date) < nowMs
                          ? "text-[#F2697A]"
                          : "text-[var(--text-faint)]"
                      }`}
                    >
                      {fmtDate(t.due_date)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Closing this month */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between gap-3 mb-5">
            <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)]">
              Closing This Month
            </h3>
            <span className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] shrink-0">
              {fmtCurrency(closingTotal)}
            </span>
          </div>
          {closingOpps.length === 0 ? (
            <EmptyState message="No opportunities closing this month." />
          ) : (
            <ul className="space-y-3">
              {closingOpps.map((o) => (
                <li
                  key={o.id}
                  className="border-b border-[rgba(255,255,255,0.04)] last:border-b-0 pb-3 last:pb-0"
                >
                  <Link
                    to={`/opportunities/${o.id}`}
                    className="flex items-center justify-between gap-3 cursor-pointer group"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-[var(--text-light)] group-hover:text-[var(--mint)] transition-colors truncate">
                        {o.name}
                      </p>
                      <span className="label-mono truncate block">
                        {maps.accounts?.[o.account_id] ?? "Account"}
                      </span>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-[var(--font-mono)] text-xs text-[var(--text-light)]">
                        {fmtCurrency(o.amount, o.currency ?? undefined)}
                      </p>
                      <p className="text-xs text-[var(--text-faint)]">{fmtDate(o.close_date)}</p>
                    </div>
                  </Link>
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
