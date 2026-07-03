// Data-health detections and bulk fixes for the admin Maintenance console.
// All queries are plain supabase-js against existing tables; fixes reuse the
// proven Monthly Summary logic and the timer-stop finalization semantics.
import { supabase } from "./supabase";
import type { Profile } from "./auth";
import { insertAudit } from "./audit";
import {
  ensureMonthlySummary,
  linkEntriesToSummary,
  monthLabel,
} from "./monthlySummary";

export type Severity = "critical" | "warning" | "info";

const pad = (n: number) => String(n).padStart(2, "0");

/* ---------- (a) Completed time entries missing a Monthly Summary ---------- */

export interface SummaryGroup {
  accountId: string;
  accountName: string;
  year: string; // "2026"
  month: string; // "01".."12"
  label: string; // "June 2026"
  entryIds: string[];
  hours: number;
}

export interface UnlinkedEntriesResult {
  total: number;
  groups: SummaryGroup[];
  unfixable: { id: string; project_id: string; date: number }[]; // project has no account
}

export async function fetchUnlinkedEntryGroups(): Promise<UnlinkedEntriesResult> {
  const [{ data: entries }, { data: projects }, { data: accounts }] =
    await Promise.all([
      supabase
        .from("time_entries")
        .select("id, project_id, date, duration")
        .is("monthly_summary_id", null)
        .eq("is_running", false)
        .eq("is_deleted", false)
        .limit(2000),
      supabase.from("projects").select("id, account_id"),
      supabase.from("accounts").select("id, name"),
    ]);

  const projectAccount: Record<string, string> = {};
  for (const p of (projects ?? []) as { id: string; account_id: string | null }[]) {
    if (p.account_id) projectAccount[p.id] = p.account_id;
  }
  const accountName: Record<string, string> = {};
  for (const a of (accounts ?? []) as { id: string; name: string }[]) {
    accountName[a.id] = a.name;
  }

  const groups = new Map<string, SummaryGroup>();
  const unfixable: UnlinkedEntriesResult["unfixable"] = [];
  const rows = (entries ?? []) as {
    id: string;
    project_id: string;
    date: number;
    duration: number | string;
  }[];

  for (const e of rows) {
    const accountId = projectAccount[e.project_id];
    if (!accountId) {
      unfixable.push({ id: e.id, project_id: e.project_id, date: e.date });
      continue;
    }
    // Local-time month, matching TimeTrackingPage's monthBounds semantics.
    const d = new Date(Number(e.date));
    const year = String(d.getFullYear());
    const month = pad(d.getMonth() + 1);
    const key = `${accountId}|${year}|${month}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        accountId,
        accountName: accountName[accountId] ?? "Unknown account",
        year,
        month,
        label: monthLabel(year, month),
        entryIds: [],
        hours: 0,
      };
      groups.set(key, g);
    }
    g.entryIds.push(e.id);
    g.hours += Number(e.duration ?? 0);
  }

  const sorted = Array.from(groups.values()).sort((a, b) =>
    `${a.year}${a.month}${a.accountName}`.localeCompare(`${b.year}${b.month}${b.accountName}`),
  );
  return { total: rows.length, groups: sorted, unfixable };
}

/** Create-or-reuse the summary for one group and link its entries. */
export async function fixSummaryGroup(
  group: SummaryGroup,
  profile: Profile | null,
): Promise<string | null> {
  const res = await ensureMonthlySummary({
    accountId: group.accountId,
    accountName: group.accountName,
    year: group.year,
    month: group.month,
    ownerId: profile?.id ?? "system",
  });
  if (!res.id) return res.error ?? "Could not create the monthly summary.";
  const linkErr = await linkEntriesToSummary(res.id, group.entryIds);
  if (linkErr) return linkErr;
  void insertAudit(profile, {
    action: "link_summary",
    entity_type: "monthly_summary",
    entity_id: res.id,
    summary: `Maintenance: linked ${group.entryIds.length} time entries (${group.hours.toFixed(1)}h) to ${group.accountName} — ${group.label}`,
  });
  return null;
}

/* ---------- (b) Time entries missing a task (informational) ---------- */

export interface NoTaskEntry {
  id: string;
  project_id: string;
  date: number;
  duration: number | string;
  description: string | null;
}

export async function fetchNoTaskEntries(): Promise<NoTaskEntry[]> {
  const { data } = await supabase
    .from("time_entries")
    .select("id, project_id, date, duration, description")
    .is("task_id", null)
    .eq("is_running", false)
    .eq("is_deleted", false)
    .limit(2000);
  return (data ?? []) as NoTaskEntry[];
}

/* ---------- (c) Stuck running timers > 8h ---------- */

export interface StuckTimer {
  id: string;
  project_id: string;
  user_id: string;
  start_time: number;
  description: string | null;
}

export async function fetchStuckTimers(): Promise<StuckTimer[]> {
  const { data } = await supabase
    .from("time_entries")
    .select("id, project_id, user_id, start_time, description")
    .eq("is_running", true)
    .lt("start_time", Date.now() - 8 * 3600_000)
    .limit(200);
  return (data ?? []) as StuckTimer[];
}

/** Finalize stuck timers exactly like the timer-stop flow. */
export async function stopStuckTimers(
  timers: StuckTimer[],
  profile: Profile | null,
): Promise<string | null> {
  for (const t of timers) {
    const now = Date.now();
    const { error } = await supabase
      .from("time_entries")
      .update({
        end_time: now,
        duration: +(((now - t.start_time) / 3600000).toFixed(2)) || 0.01,
        is_running: false,
        updated_at: now,
      })
      .eq("id", t.id);
    if (error) return error.message;
    void insertAudit(profile, {
      action: "stop_timer",
      entity_type: "time_entry",
      entity_id: t.id,
      summary: `Maintenance: stopped stuck timer (${(((now - t.start_time) / 3600000)).toFixed(1)}h) on entry ${t.id}`,
    });
  }
  return null;
}

/* ---------- (d) Overdue open tasks (informational) ---------- */

export interface OverdueTask {
  id: string;
  name: string;
  project_id: string;
  status: string;
  due_date: number;
}

export async function fetchOverdueTasks(): Promise<OverdueTask[]> {
  const { data } = await supabase
    .from("tasks")
    .select("id, name, project_id, status, due_date")
    .lt("due_date", Date.now())
    .neq("status", "done")
    .eq("is_deleted", false)
    .order("due_date")
    .limit(2000);
  return (data ?? []) as OverdueTask[];
}

/* ---------- (e) Sent invoices past their due date ---------- */

export interface PastDueInvoice {
  id: string;
  invoice_number: string;
  account_id: string;
  due_date: number;
  total_amount: number | string | null;
}

export async function fetchPastDueInvoices(): Promise<PastDueInvoice[]> {
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_number, account_id, due_date, total_amount")
    .eq("status", "sent")
    .lt("due_date", Date.now())
    .limit(500);
  return (data ?? []) as PastDueInvoice[];
}

export async function markInvoicesOverdue(
  invoices: PastDueInvoice[],
  profile: Profile | null,
): Promise<string | null> {
  const ids = invoices.map((i) => i.id);
  if (ids.length === 0) return null;
  const { error } = await supabase
    .from("invoices")
    .update({ status: "overdue", updated_at: Date.now() })
    .in("id", ids);
  if (error) return error.message;
  void insertAudit(profile, {
    action: "mark_overdue",
    entity_type: "invoice",
    entity_id: null,
    summary: `Maintenance: marked ${ids.length} sent invoice${ids.length === 1 ? "" : "s"} as overdue`,
  });
  return null;
}

/* ---------- (f) Soft-deleted rows (restore) ---------- */

export const SOFT_DELETE_TABLES = [
  "accounts",
  "projects",
  "tasks",
  "time_entries",
  "monthly_summaries",
] as const;
export type SoftDeleteTable = (typeof SOFT_DELETE_TABLES)[number];

export async function fetchSoftDeletedCounts(): Promise<
  { table: SoftDeleteTable; count: number }[]
> {
  const counts = await Promise.all(
    SOFT_DELETE_TABLES.map(async (table) => {
      const { count } = await supabase
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("is_deleted", true);
      return { table, count: count ?? 0 };
    }),
  );
  return counts;
}

export async function restoreSoftDeleted(
  table: SoftDeleteTable,
  profile: Profile | null,
): Promise<string | null> {
  const { error } = await supabase
    .from(table)
    .update({ is_deleted: false, updated_at: Date.now() })
    .eq("is_deleted", true);
  if (error) return error.message;
  void insertAudit(profile, {
    action: "restore",
    entity_type: table,
    entity_id: null,
    summary: `Maintenance: restored all soft-deleted rows in ${table}`,
  });
  return null;
}
