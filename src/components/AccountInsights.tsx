import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fmtCurrency } from "../lib/format";

const OPEN_STAGES = ["discovery", "qualification", "proposal", "negotiation"];

interface Stats {
  pipeline: number;
  openOpps: number;
  activeProjects: number;
  invoiced: number;
  paid: number;
  outstanding: number;
}

export default function AccountInsights({ accountId }: { accountId: string }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    async function load() {
      const [oppRes, projRes, invRes] = await Promise.all([
        supabase
          .from("opportunities")
          .select("stage, amount")
          .eq("account_id", accountId),
        supabase
          .from("projects")
          .select("id", { count: "exact", head: true })
          .eq("account_id", accountId)
          .in("status", ["planning", "in_progress"]),
        supabase
          .from("invoices")
          .select("status, total_amount")
          .eq("account_id", accountId),
      ]);
      const opps = (oppRes.data ?? []) as { stage: string; amount: number | null }[];
      const open = opps.filter((o) => OPEN_STAGES.includes(o.stage));
      const invoices = (invRes.data ?? []) as {
        status: string;
        total_amount: number | string;
      }[];
      const billed = invoices.filter((i) =>
        ["sent", "paid", "overdue"].includes(i.status),
      );
      const paid = invoices.filter((i) => i.status === "paid");
      setStats({
        pipeline: open.reduce((s, o) => s + Number(o.amount ?? 0), 0),
        openOpps: open.length,
        activeProjects: projRes.count ?? 0,
        invoiced: billed.reduce((s, i) => s + Number(i.total_amount ?? 0), 0),
        paid: paid.reduce((s, i) => s + Number(i.total_amount ?? 0), 0),
        outstanding: billed
          .filter((i) => i.status !== "paid")
          .reduce((s, i) => s + Number(i.total_amount ?? 0), 0),
      });
    }
    load();
  }, [accountId]);

  if (!stats) return null;

  const items = [
    { label: "Open Pipeline", value: fmtCurrency(stats.pipeline), sub: `${stats.openOpps} deals` },
    { label: "Active Projects", value: String(stats.activeProjects), sub: "in delivery" },
    { label: "Total Invoiced", value: fmtCurrency(stats.invoiced), sub: "sent · paid · overdue" },
    { label: "Collected", value: fmtCurrency(stats.paid), sub: "paid invoices" },
    {
      label: "Outstanding",
      value: fmtCurrency(stats.outstanding),
      sub: "awaiting payment",
      warn: stats.outstanding > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
      {items.map((it) => (
        <div
          key={it.label}
          className={`bg-[var(--card)] border rounded-[var(--radius-lg)] p-4 ${
            it.warn
              ? "border-[rgba(220,180,80,0.3)]"
              : "border-[rgba(255,255,255,0.06)]"
          }`}
        >
          <p className="label-mono mb-1.5">{it.label}</p>
          <p className="font-[var(--font-heading)] font-bold text-lg text-[var(--foreground)]">
            {it.value}
          </p>
          <p className="text-[0.68rem] text-[var(--text-faint)] mt-0.5">{it.sub}</p>
        </div>
      ))}
    </div>
  );
}
