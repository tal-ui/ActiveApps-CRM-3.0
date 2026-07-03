import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { RefreshCw, Wrench } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useLookupMaps } from "../../lib/lookups";
import { invalidateLookup } from "../../lib/lookups";
import { fmtCurrency, fmtDate, fmtHours } from "../../lib/format";
import { notifyTimeEntriesChanged } from "../../components/TimerWidget";
import {
  fetchNoTaskEntries,
  fetchOverdueTasks,
  fetchPastDueInvoices,
  fetchSoftDeletedCounts,
  fetchStuckTimers,
  fetchUnlinkedEntryGroups,
  fixSummaryGroup,
  markInvoicesOverdue,
  restoreSoftDeleted,
  stopStuckTimers,
  type NoTaskEntry,
  type OverdueTask,
  type PastDueInvoice,
  type SoftDeleteTable,
  type StuckTimer,
  type SummaryGroup,
  type UnlinkedEntriesResult,
  type Severity,
} from "../../lib/health";
import {
  Button,
  ConfirmModal,
  EmptyState,
  ErrorNote,
  Spinner,
} from "../../components/ui";

const SEVERITY_TONES: Record<Severity, string> = {
  critical: "bg-[rgba(228,0,22,0.08)] text-[#F2697A] border-[rgba(228,0,22,0.25)]",
  warning: "bg-[rgba(220,180,80,0.08)] text-[#D9B96A] border-[rgba(220,180,80,0.2)]",
  info: "bg-[rgba(255,255,255,0.04)] text-[var(--text-mid)] border-[rgba(255,255,255,0.08)]",
};

function SeverityChip({ severity }: { severity: Severity }) {
  return (
    <span
      className={`inline-flex items-center border font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.13em] px-2 py-0.5 rounded-[var(--radius-sm)] ${SEVERITY_TONES[severity]}`}
    >
      {severity}
    </span>
  );
}

function CheckCard({
  title,
  severity,
  count,
  description,
  action,
  children,
}: {
  title: string;
  severity: Severity;
  count: number;
  description: string;
  action?: ReactNode;
  children?: ReactNode;
}) {
  const healthy = count === 0;
  return (
    <section
      className={`bg-[var(--card)] border rounded-[var(--radius-lg)] p-5 ${
        healthy
          ? "border-[rgba(255,255,255,0.06)]"
          : severity === "critical"
            ? "border-[rgba(228,0,22,0.3)]"
            : "border-[rgba(255,255,255,0.06)]"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2.5">
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            {title}
          </h3>
          <SeverityChip severity={severity} />
          <span
            className={`font-[var(--font-mono)] text-sm ${healthy ? "text-[var(--mint)]" : "text-[var(--foreground)]"}`}
          >
            {healthy ? "✓ 0" : count}
          </span>
        </div>
        {!healthy && action}
      </div>
      <p className="text-xs text-[var(--text-faint)] mb-3">{description}</p>
      {!healthy && children}
    </section>
  );
}

export default function MaintenancePage() {
  const { profile } = useAuth();
  const lookupMaps = useLookupMaps(["projects", "accounts"]);

  const [unlinked, setUnlinked] = useState<UnlinkedEntriesResult | null>(null);
  const [stuck, setStuck] = useState<StuckTimer[] | null>(null);
  const [noTask, setNoTask] = useState<NoTaskEntry[] | null>(null);
  const [overdueTasks, setOverdueTasks] = useState<OverdueTask[] | null>(null);
  const [pastDue, setPastDue] = useState<PastDueInvoice[] | null>(null);
  const [softDeleted, setSoftDeleted] = useState<
    { table: SoftDeleteTable; count: number }[] | null
  >(null);

  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null); // id of the running fix
  const [confirm, setConfirm] = useState<
    | { kind: "fix-all-summaries" }
    | { kind: "fix-group"; group: SummaryGroup }
    | { kind: "stop-timers" }
    | { kind: "restore"; table: SoftDeleteTable; count: number }
    | null
  >(null);

  const loadAll = useCallback(() => {
    fetchUnlinkedEntryGroups().then(setUnlinked);
    fetchStuckTimers().then(setStuck);
    fetchNoTaskEntries().then(setNoTask);
    fetchOverdueTasks().then(setOverdueTasks);
    fetchPastDueInvoices().then(setPastDue);
    fetchSoftDeletedCounts().then(setSoftDeleted);
  }, []);

  useEffect(loadAll, [loadAll]);

  const loading =
    !unlinked || !stuck || !noTask || !overdueTasks || !pastDue || !softDeleted;

  const softDeletedTotal = useMemo(
    () => (softDeleted ?? []).reduce((s, t) => s + t.count, 0),
    [softDeleted],
  );

  const issueTotals = useMemo(() => {
    if (loading) return { critical: 0, warning: 0, info: 0 };
    return {
      critical: stuck!.length,
      warning: unlinked!.total + overdueTasks!.length + pastDue!.length,
      info: noTask!.length + softDeletedTotal,
    };
  }, [loading, stuck, unlinked, overdueTasks, pastDue, noTask, softDeletedTotal]);

  async function runFix(id: string, fn: () => Promise<string | null>, after?: () => void) {
    setError("");
    setBusy(id);
    const err = await fn();
    setBusy(null);
    setConfirm(null);
    if (err) {
      setError(err);
      return;
    }
    after?.();
    loadAll();
  }

  async function fixAllGroups(): Promise<string | null> {
    for (const g of unlinked?.groups ?? []) {
      const err = await fixSummaryGroup(g, profile);
      if (err) return err;
    }
    invalidateLookup("monthly_summaries");
    return null;
  }

  const projName = (id: string) => lookupMaps.projects?.[id] ?? id;
  const acctName = (id: string) => lookupMaps.accounts?.[id] ?? id;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Wrench size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Data Maintenance
            </h1>
            <p className="label-mono">health checks & bulk fixes</p>
          </div>
        </div>
        <Button variant="subtle" onClick={loadAll} disabled={loading}>
          <RefreshCw size={15} strokeWidth={1.8} className={loading ? "animate-spin" : ""} />
          Re-run Checks
        </Button>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <>
          {/* Severity summary */}
          <div className="grid grid-cols-3 gap-5 mb-6">
            {(
              [
                ["critical", issueTotals.critical],
                ["warning", issueTotals.warning],
                ["info", issueTotals.info],
              ] as [Severity, number][]
            ).map(([sev, n]) => (
              <div
                key={sev}
                className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5"
              >
                <p className="label-mono mb-2">{sev}</p>
                <p
                  className={`font-[var(--font-heading)] font-bold text-2xl ${
                    n === 0
                      ? "text-[var(--mint)]"
                      : sev === "critical"
                        ? "text-[#F2697A]"
                        : "text-[var(--foreground)]"
                  }`}
                >
                  {n === 0 ? "Clear" : n}
                </p>
              </div>
            ))}
          </div>

          <div className="space-y-6">
            {/* (c) Stuck timers */}
            <CheckCard
              title="Stuck Running Timers"
              severity="critical"
              count={stuck!.length}
              description="Timers running for more than 8 hours. Fixing stops each timer and writes its actual elapsed hours."
              action={
                <Button onClick={() => setConfirm({ kind: "stop-timers" })} disabled={!!busy}>
                  Stop & Finalize
                </Button>
              }
            >
              <div className="space-y-1.5 text-sm">
                {stuck!.slice(0, 25).map((t) => (
                  <div key={t.id} className="flex items-center gap-3">
                    <Link
                      to={`/time_entries/${t.id}`}
                      className="text-[var(--mint)] hover:underline truncate"
                    >
                      {projName(t.project_id)}
                    </Link>
                    <span className="font-[var(--font-mono)] text-xs text-[#F2697A]">
                      {((Date.now() - t.start_time) / 3600000).toFixed(1)}h elapsed
                    </span>
                    <span className="text-xs text-[var(--text-faint)] truncate">
                      {t.description ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </CheckCard>

            {/* (a) Unlinked time entries */}
            <CheckCard
              title="Time Entries Without a Monthly Summary"
              severity="warning"
              count={unlinked!.total}
              description="Completed entries not linked to any Monthly Summary — their hours are invisible to billing roll-ups. Fixing creates (or reuses) the summary for each account + month and links the entries; totals recompute automatically."
              action={
                <Button
                  onClick={() => setConfirm({ kind: "fix-all-summaries" })}
                  disabled={!!busy || unlinked!.groups.length === 0}
                >
                  Fix All Groups
                </Button>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left">
                      {["Account", "Month", "Entries", "Hours", ""].map((h, i) => (
                        <th key={i} className="label-mono font-normal pb-2 pr-4">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {unlinked!.groups.slice(0, 25).map((g) => (
                      <tr
                        key={`${g.accountId}-${g.year}-${g.month}`}
                        className="border-t border-[rgba(255,255,255,0.05)]"
                      >
                        <td className="py-2 pr-4 text-[var(--foreground)]">{g.accountName}</td>
                        <td className="py-2 pr-4 text-[var(--text-mid)]">{g.label}</td>
                        <td className="py-2 pr-4 font-[var(--font-mono)] text-xs">
                          {g.entryIds.length}
                        </td>
                        <td className="py-2 pr-4 font-[var(--font-mono)] text-xs">
                          {fmtHours(g.hours)}
                        </td>
                        <td className="py-2">
                          <Button
                            variant="ghost"
                            className="!px-3 !py-1"
                            disabled={!!busy}
                            onClick={() => setConfirm({ kind: "fix-group", group: g })}
                          >
                            Generate & Link
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {unlinked!.groups.length > 25 && (
                  <p className="label-mono mt-2">
                    +{unlinked!.groups.length - 25} more groups
                  </p>
                )}
                {unlinked!.unfixable.length > 0 && (
                  <p className="text-xs text-[#D9B96A] mt-3">
                    {unlinked!.unfixable.length} entr
                    {unlinked!.unfixable.length === 1 ? "y" : "ies"} belong to projects
                    with no account and can't be fixed automatically.
                  </p>
                )}
              </div>
            </CheckCard>

            {/* (e) Past-due sent invoices */}
            <CheckCard
              title="Sent Invoices Past Due"
              severity="warning"
              count={pastDue!.length}
              description="Invoices still marked 'sent' after their due date. Fixing marks them overdue (same as the hourly automation)."
              action={
                <Button
                  disabled={!!busy}
                  onClick={() =>
                    runFix("invoices", () => markInvoicesOverdue(pastDue!, profile))
                  }
                >
                  {busy === "invoices" ? "Working…" : "Mark Overdue"}
                </Button>
              }
            >
              <div className="space-y-1.5 text-sm">
                {pastDue!.slice(0, 25).map((i) => (
                  <div key={i.id} className="flex items-center gap-3">
                    <Link
                      to={`/invoices/${i.id}`}
                      className="text-[var(--mint)] hover:underline"
                    >
                      {i.invoice_number}
                    </Link>
                    <span className="text-xs text-[var(--text-mid)]">{acctName(i.account_id)}</span>
                    <span className="font-[var(--font-mono)] text-xs text-[var(--text-dim)]">
                      {fmtCurrency(i.total_amount)}
                    </span>
                    <span className="text-xs text-[#F2697A]">due {fmtDate(i.due_date)}</span>
                  </div>
                ))}
              </div>
            </CheckCard>

            {/* (d) Overdue tasks — informational */}
            <CheckCard
              title="Overdue Open Tasks"
              severity="warning"
              count={overdueTasks!.length}
              description="Open tasks past their due date. Review and reschedule or complete them individually — bulk-editing due dates would falsify planning data."
            >
              <div className="space-y-1.5 text-sm">
                {overdueTasks!.slice(0, 25).map((t) => (
                  <div key={t.id} className="flex items-center gap-3">
                    <Link to={`/tasks/${t.id}`} className="text-[var(--mint)] hover:underline truncate">
                      {t.name}
                    </Link>
                    <span className="text-xs text-[var(--text-mid)] truncate">
                      {projName(t.project_id)}
                    </span>
                    <span className="text-xs text-[#F2697A] shrink-0">
                      due {fmtDate(t.due_date)}
                    </span>
                  </div>
                ))}
              </div>
            </CheckCard>

            {/* (b) Entries without a task — informational */}
            <CheckCard
              title="Time Entries Without a Task"
              severity="info"
              count={noTask!.length}
              description="Completed entries with no task relationship. Assigning the right task needs human judgment — open each entry to fix."
            >
              <div className="space-y-1.5 text-sm">
                {noTask!.slice(0, 25).map((e) => (
                  <div key={e.id} className="flex items-center gap-3">
                    <Link
                      to={`/time_entries/${e.id}`}
                      className="text-[var(--mint)] hover:underline"
                    >
                      {fmtDate(e.date)} · {fmtHours(Number(e.duration ?? 0))}
                    </Link>
                    <span className="text-xs text-[var(--text-mid)] truncate">
                      {projName(e.project_id)}
                    </span>
                    <span className="text-xs text-[var(--text-faint)] truncate">
                      {e.description ?? ""}
                    </span>
                  </div>
                ))}
              </div>
            </CheckCard>

            {/* (f) Soft-deleted rows */}
            <CheckCard
              title="Soft-Deleted Rows"
              severity="info"
              count={softDeletedTotal}
              description="Rows flagged is_deleted across core tables. Restore brings them back; permanent purge is intentionally not offered."
            >
              <div className="space-y-2 text-sm">
                {softDeleted!
                  .filter((t) => t.count > 0)
                  .map((t) => (
                    <div key={t.table} className="flex items-center gap-3">
                      <span className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] w-40">
                        {t.table}
                      </span>
                      <span className="font-[var(--font-mono)] text-xs">{t.count}</span>
                      <Button
                        variant="ghost"
                        className="!px-3 !py-1"
                        disabled={!!busy}
                        onClick={() =>
                          setConfirm({ kind: "restore", table: t.table, count: t.count })
                        }
                      >
                        Restore All
                      </Button>
                    </div>
                  ))}
              </div>
            </CheckCard>
          </div>
        </>
      )}

      {/* Confirmations */}
      {confirm?.kind === "fix-all-summaries" && unlinked && (
        <ConfirmModal
          title="Generate & Link Monthly Summaries"
          confirmLabel={`Fix ${unlinked.groups.length} group${unlinked.groups.length === 1 ? "" : "s"}`}
          busy={busy === "fix-all"}
          onClose={() => setConfirm(null)}
          onConfirm={() => runFix("fix-all", fixAllGroups)}
        >
          <p>
            This will create or reuse{" "}
            <span className="text-[var(--foreground)]">
              {unlinked.groups.length} monthly summar
              {unlinked.groups.length === 1 ? "y" : "ies"}
            </span>{" "}
            and link{" "}
            <span className="text-[var(--foreground)]">
              {unlinked.groups.reduce((s, g) => s + g.entryIds.length, 0)} time entries
            </span>{" "}
            to them. Summary totals recompute automatically. This action is recorded in
            the audit log.
          </p>
        </ConfirmModal>
      )}
      {confirm?.kind === "fix-group" && (
        <ConfirmModal
          title="Generate & Link Monthly Summary"
          confirmLabel="Generate & Link"
          busy={busy === "fix-group"}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            runFix("fix-group", async () => {
              const err = await fixSummaryGroup(confirm.group, profile);
              if (!err) invalidateLookup("monthly_summaries");
              return err;
            })
          }
        >
          <p>
            Link{" "}
            <span className="text-[var(--foreground)]">
              {confirm.group.entryIds.length} entries ({fmtHours(confirm.group.hours)})
            </span>{" "}
            to <span className="text-[var(--foreground)]">{confirm.group.accountName}</span>{" "}
            — {confirm.group.label}?
          </p>
        </ConfirmModal>
      )}
      {confirm?.kind === "stop-timers" && stuck && (
        <ConfirmModal
          title="Stop & Finalize Stuck Timers"
          confirmLabel={`Stop ${stuck.length} timer${stuck.length === 1 ? "" : "s"}`}
          destructive
          busy={busy === "stop-timers"}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            runFix(
              "stop-timers",
              () => stopStuckTimers(stuck, profile),
              notifyTimeEntriesChanged,
            )
          }
        >
          <p>Each timer is stopped and its full elapsed time is written as the duration:</p>
          <ul className="space-y-1">
            {stuck.map((t) => (
              <li key={t.id} className="font-[var(--font-mono)] text-xs">
                {projName(t.project_id)} — {((Date.now() - t.start_time) / 3600000).toFixed(1)}h
              </li>
            ))}
          </ul>
        </ConfirmModal>
      )}
      {confirm?.kind === "restore" && (
        <ConfirmModal
          title={`Restore ${confirm.table}`}
          confirmLabel={`Restore ${confirm.count} row${confirm.count === 1 ? "" : "s"}`}
          busy={busy === "restore"}
          onClose={() => setConfirm(null)}
          onConfirm={() =>
            runFix("restore", () => restoreSoftDeleted(confirm.table, profile))
          }
        >
          <p>
            Restore all{" "}
            <span className="text-[var(--foreground)]">
              {confirm.count} soft-deleted row{confirm.count === 1 ? "" : "s"}
            </span>{" "}
            in <span className="font-[var(--font-mono)]">{confirm.table}</span>? They will
            reappear throughout the app.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
