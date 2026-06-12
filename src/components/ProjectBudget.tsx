import { useEffect, useState } from "react";
import { Gauge, Wand2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { fmtCurrency, fmtHours } from "../lib/format";
import { Button } from "./ui";
import InvoiceGenerator from "./InvoiceGenerator";

interface BudgetData {
  totalHours: number;
  billableValue: number;
  unbilledHours: number;
  unbilledValue: number;
}

function Bar({
  used,
  budget,
  format,
}: {
  used: number;
  budget: number | null;
  format: (n: number) => string;
}) {
  if (!budget || budget <= 0) {
    return (
      <p className="text-sm text-[var(--text-mid)]">
        {format(used)} <span className="text-[var(--text-faint)]">(no budget set)</span>
      </p>
    );
  }
  const pct = Math.min(100, (used / budget) * 100);
  const over = used > budget;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className={`font-[var(--font-mono)] text-xs ${over ? "text-[#F2697A]" : "text-[var(--text-mid)]"}`}>
          {format(used)} / {format(budget)}
        </span>
        <span className={`font-[var(--font-mono)] text-xs ${over ? "text-[#F2697A]" : "text-[var(--mint)]"}`}>
          {Math.round((used / budget) * 100)}%
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
}

export default function ProjectBudget({
  project,
}: {
  project: Record<string, unknown>;
}) {
  const [data, setData] = useState<BudgetData | null>(null);
  const [showGenerator, setShowGenerator] = useState(false);
  const projectId = String(project.id);

  useEffect(() => {
    supabase
      .from("time_entries")
      .select("duration, hourly_rate, is_billable, invoice_id, is_running")
      .eq("project_id", projectId)
      .limit(2000)
      .then(({ data: rows }) => {
        const entries = ((rows ?? []) as {
          duration: number | string;
          hourly_rate: number | string | null;
          is_billable: boolean;
          invoice_id: string | null;
          is_running: boolean;
        }[]).filter((e) => !e.is_running);
        const projectRate = Number(project.hourly_rate ?? 0);
        const rate = (e: { hourly_rate: number | string | null }) =>
          Number(e.hourly_rate ?? projectRate);
        const billable = entries.filter((e) => e.is_billable);
        const unbilled = billable.filter((e) => !e.invoice_id);
        setData({
          totalHours: entries.reduce((s, e) => s + Number(e.duration ?? 0), 0),
          billableValue: billable.reduce(
            (s, e) => s + Number(e.duration ?? 0) * rate(e),
            0,
          ),
          unbilledHours: unbilled.reduce((s, e) => s + Number(e.duration ?? 0), 0),
          unbilledValue: unbilled.reduce(
            (s, e) => s + Number(e.duration ?? 0) * rate(e),
            0,
          ),
        });
      });
  }, [projectId, project]);

  if (!data) return null;
  const currency = String(project.currency ?? "USD");

  return (
    <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2.5">
          <Gauge size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Budget & Billing
          </h3>
        </div>
        {data.unbilledHours > 0 && (
          <Button variant="ghost" onClick={() => setShowGenerator(true)} className="!px-3 !py-1.5">
            <Wand2 size={14} strokeWidth={1.5} />
            Generate Invoice ({fmtHours(data.unbilledHours)} unbilled)
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
        <div>
          <p className="label-mono mb-2">Hours vs Budget</p>
          <Bar
            used={data.totalHours}
            budget={project.budget_hours != null ? Number(project.budget_hours) : null}
            format={(n) => fmtHours(n)}
          />
        </div>
        <div>
          <p className="label-mono mb-2">Billable Value vs Budget</p>
          <Bar
            used={data.billableValue}
            budget={project.budget_amount != null ? Number(project.budget_amount) : null}
            format={(n) => fmtCurrency(n, currency)}
          />
        </div>
      </div>

      {data.unbilledHours > 0 && (
        <p className="text-xs text-[var(--text-faint)] mt-4">
          {fmtHours(data.unbilledHours)} billable hours (
          {fmtCurrency(data.unbilledValue, currency)}) not yet invoiced.
        </p>
      )}

      {showGenerator && (
        <InvoiceGenerator
          projectId={projectId}
          onClose={() => setShowGenerator(false)}
        />
      )}
    </section>
  );
}
