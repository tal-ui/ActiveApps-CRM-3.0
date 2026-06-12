import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Banknote, Plus } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useLookupMaps } from "../lib/lookups";
import { fmtCurrency, startOfMonthMs } from "../lib/format";
import { Button, Spinner } from "../components/ui";
import InvoiceGenerator from "../components/InvoiceGenerator";

interface Invoice {
  id: string;
  account_id: string;
  invoice_number: string;
  status: string;
  issue_date: number;
  due_date: number;
  paid_date: number | null;
  total_amount: number | string;
}

const BILLED = ["sent", "paid", "overdue"];

export default function FinancialDashboard() {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [hours, setHours] = useState<{ duration: number | string; is_billable: boolean }[]>([]);
  const [showGenerator, setShowGenerator] = useState(false);
  const maps = useLookupMaps(["accounts"]);

  useEffect(() => {
    Promise.all([
      supabase.from("invoices").select("id, account_id, invoice_number, status, issue_date, due_date, paid_date, total_amount").limit(2000),
      supabase.from("time_entries").select("duration, is_billable").eq("is_running", false).gte("date", startOfMonthMs()),
    ]).then(([invRes, timeRes]) => {
      setInvoices((invRes.data ?? []) as Invoice[]);
      setHours((timeRes.data ?? []) as { duration: number | string; is_billable: boolean }[]);
    });
  }, []);

  const view = useMemo(() => {
    if (!invoices) return null;
    const now = Date.now();
    const billed = invoices.filter((i) => BILLED.includes(i.status));
    const paid = billed.filter((i) => i.status === "paid");
    const unpaid = billed.filter((i) => i.status !== "paid");
    const overdue = unpaid.filter((i) => Number(i.due_date) < now);
    const amt = (list: Invoice[]) =>
      list.reduce((s, i) => s + Number(i.total_amount ?? 0), 0);

    // Aging buckets for unpaid invoices
    const day = 86400000;
    const buckets = [
      { label: "Current", test: (i: Invoice) => Number(i.due_date) >= now },
      { label: "1–30 days", test: (i: Invoice) => now - Number(i.due_date) > 0 && now - Number(i.due_date) <= 30 * day },
      { label: "31–60 days", test: (i: Invoice) => now - Number(i.due_date) > 30 * day && now - Number(i.due_date) <= 60 * day },
      { label: "60+ days", test: (i: Invoice) => now - Number(i.due_date) > 60 * day },
    ].map((b) => {
      const list = unpaid.filter(b.test);
      return { label: b.label, total: amt(list), count: list.length };
    });

    // Invoiced vs paid by month (last 6 months)
    const months: { label: string; invoiced: number; collected: number }[] = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date();
      const start = new Date(d.getFullYear(), d.getMonth() - m, 1).getTime();
      const end = new Date(d.getFullYear(), d.getMonth() - m + 1, 1).getTime();
      months.push({
        label: new Date(start).toLocaleDateString(undefined, { month: "short" }),
        invoiced: amt(billed.filter((i) => Number(i.issue_date) >= start && Number(i.issue_date) < end)),
        collected: amt(paid.filter((i) => Number(i.paid_date ?? 0) >= start && Number(i.paid_date ?? 0) < end)),
      });
    }

    // Top accounts by collected revenue
    const byAccount = new Map<string, number>();
    for (const i of paid) {
      byAccount.set(i.account_id, (byAccount.get(i.account_id) ?? 0) + Number(i.total_amount ?? 0));
    }
    const topAccounts = Array.from(byAccount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const totalHours = hours.reduce((s, h) => s + Number(h.duration ?? 0), 0);
    const billableHours = hours.filter((h) => h.is_billable).reduce((s, h) => s + Number(h.duration ?? 0), 0);

    return {
      totalInvoiced: amt(billed),
      collected: amt(paid),
      outstanding: amt(unpaid),
      overdueAmt: amt(overdue),
      overdueCount: overdue.length,
      draftCount: invoices.filter((i) => i.status === "draft").length,
      buckets,
      months,
      topAccounts,
      utilization: totalHours > 0 ? (billableHours / totalHours) * 100 : 0,
    };
  }, [invoices, hours]);

  if (!view) return <Spinner />;

  const maxMonth = Math.max(1, ...view.months.map((m) => Math.max(m.invoiced, m.collected)));
  const maxAccount = Math.max(1, ...view.topAccounts.map(([, v]) => v));

  const stats = [
    { label: "Total Invoiced", value: fmtCurrency(view.totalInvoiced), sub: "sent · paid · overdue" },
    { label: "Collected", value: fmtCurrency(view.collected), sub: "paid invoices" },
    { label: "Outstanding", value: fmtCurrency(view.outstanding), sub: "awaiting payment" },
    {
      label: "Overdue",
      value: fmtCurrency(view.overdueAmt),
      sub: `${view.overdueCount} invoice${view.overdueCount === 1 ? "" : "s"} past due`,
      warn: view.overdueAmt > 0,
    },
  ];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Banknote size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Financial Dashboard
            </h1>
            <p className="label-mono">
              {view.draftCount > 0 ? `${view.draftCount} draft invoice${view.draftCount === 1 ? "" : "s"} pending` : "all invoices issued"}
            </p>
          </div>
        </div>
        <Button onClick={() => setShowGenerator(true)}>
          <Plus size={16} strokeWidth={2} />
          Generate Invoice
        </Button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-5 mb-6">
        {stats.map((s) => (
          <div
            key={s.label}
            className={`bg-[var(--card)] border rounded-[var(--radius-lg)] p-5 ${
              s.warn ? "border-[rgba(228,0,22,0.3)]" : "border-[rgba(255,255,255,0.06)]"
            }`}
          >
            <p className="label-mono mb-2">{s.label}</p>
            <p className={`font-[var(--font-heading)] font-bold text-2xl ${s.warn ? "text-[#F2697A]" : "text-[var(--foreground)]"}`}>
              {s.value}
            </p>
            <p className="text-xs text-[var(--text-faint)] mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
        {/* Invoiced vs collected by month */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)]">
              Invoiced vs Collected
            </h3>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-3)]" /> Invoiced
              </span>
              <span className="flex items-center gap-1.5 text-xs text-[var(--text-faint)]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-1)]" /> Collected
              </span>
            </div>
          </div>
          <div className="flex items-end gap-3 h-44">
            {view.months.map((m) => (
              <div key={m.label} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                <div className="w-full flex items-end justify-center gap-1 flex-1">
                  <div
                    className="w-1/3 rounded-t-sm"
                    style={{ height: `${Math.max(2, (m.invoiced / maxMonth) * 100)}%`, background: "var(--chart-3)" }}
                    title={`Invoiced ${fmtCurrency(m.invoiced)}`}
                  />
                  <div
                    className="w-1/3 rounded-t-sm"
                    style={{ height: `${Math.max(2, (m.collected / maxMonth) * 100)}%`, background: "var(--chart-1)" }}
                    title={`Collected ${fmtCurrency(m.collected)}`}
                  />
                </div>
                <span className="label-mono">{m.label}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Aging */}
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
            Invoice Aging (Unpaid)
          </h3>
          <div className="space-y-4">
            {view.buckets.map((b, i) => {
              const maxBucket = Math.max(1, ...view.buckets.map((x) => x.total));
              return (
                <div key={b.label}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="label-mono">{b.label}</span>
                    <span className="font-[var(--font-mono)] text-xs text-[var(--text-mid)]">
                      {fmtCurrency(b.total)} · {b.count}
                    </span>
                  </div>
                  <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-700"
                      style={{
                        width: `${Math.max(2, (b.total / maxBucket) * 100)}%`,
                        background: i === 0 ? "var(--chart-1)" : i === 1 ? "#D9B96A" : i === 2 ? "#E0824A" : "#E40016",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-[var(--text-faint)] mt-5">
            Billable utilization this month:{" "}
            <span className="text-[var(--mint)] font-[var(--font-mono)]">
              {view.utilization.toFixed(0)}%
            </span>
          </p>
        </section>
      </div>

      {/* Top accounts */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
        <h3 className="font-[var(--font-heading)] font-semibold text-[var(--foreground)] mb-5">
          Top Accounts by Revenue
        </h3>
        {view.topAccounts.length === 0 ? (
          <p className="text-sm text-[var(--text-dim)]">No paid invoices yet.</p>
        ) : (
          <div className="space-y-3">
            {view.topAccounts.map(([accountId, total], i) => (
              <div key={accountId}>
                <div className="flex items-center justify-between mb-1">
                  <Link
                    to={`/accounts/${accountId}`}
                    className="text-sm text-[var(--text-light)] hover:text-[var(--mint)] transition-colors cursor-pointer truncate"
                  >
                    {maps.accounts?.[accountId] ?? "Account"}
                  </Link>
                  <span className="font-[var(--font-mono)] text-xs text-[var(--text-light)]">
                    {fmtCurrency(total)}
                  </span>
                </div>
                <div className="h-2 bg-[var(--section-darker)] rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${Math.max(2, (total / maxAccount) * 100)}%`,
                      background: `var(--chart-${Math.min(i + 1, 5)})`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {showGenerator && <InvoiceGenerator onClose={() => setShowGenerator(false)} />}
    </div>
  );
}
