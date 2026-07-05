import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wand2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { invalidateLookup, useLookupOptions } from "../lib/lookups";
import { nextInvoiceNumber } from "../lib/docNumber";
import { dateToMs, DEFAULT_CURRENCY, fmtCurrency, fmtHours, msToDateInput } from "../lib/format";
import {
  Button,
  EmptyState,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Spinner,
} from "./ui";

interface UnbilledEntry {
  id: string;
  task_id: string | null;
  date: number;
  duration: number | string;
  hourly_rate: number | string | null;
  description: string | null;
}

interface ProjectRow {
  id: string;
  account_id: string;
  hourly_rate: number | string | null;
  currency: string | null;
}

function startOfMonthInput(): string {
  const d = new Date();
  return msToDateInput(new Date(d.getFullYear(), d.getMonth(), 1).getTime());
}
function todayInput(): string {
  return msToDateInput(Date.now());
}

export default function InvoiceGenerator({
  projectId: initialProjectId,
  onClose,
}: {
  projectId?: string;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const projects = useLookupOptions("projects");
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [from, setFrom] = useState(startOfMonthInput());
  const [to, setTo] = useState(todayInput());
  const [entries, setEntries] = useState<UnbilledEntry[] | null>(null);
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [taskNames, setTaskNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Load unbilled billable entries whenever inputs change
  useEffect(() => {
    if (!projectId || !from || !to) {
      setEntries(null);
      return;
    }
    setLoading(true);
    setError("");
    const fromMs = dateToMs(from) ?? 0;
    const toMs = (dateToMs(to) ?? 0) + 86399999; // end of day
    Promise.all([
      supabase
        .from("time_entries")
        .select("id, task_id, date, duration, hourly_rate, description")
        .eq("project_id", projectId)
        .eq("is_billable", true)
        .eq("is_running", false)
        .is("invoice_id", null)
        .gte("date", fromMs)
        .lte("date", toMs)
        .order("date", { ascending: true })
        .limit(1000),
      supabase
        .from("projects")
        .select("id, account_id, hourly_rate, currency")
        .eq("id", projectId)
        .maybeSingle(),
      supabase
        .from("tasks")
        .select("id, name")
        .eq("project_id", projectId)
        .limit(500),
    ]).then(([entriesRes, projectRes, tasksRes]) => {
      setEntries((entriesRes.data ?? []) as UnbilledEntry[]);
      setProject(projectRes.data as ProjectRow | null);
      setTaskNames(
        Object.fromEntries(
          ((tasksRes.data ?? []) as { id: string; name: string }[]).map((t) => [
            t.id,
            t.name,
          ]),
        ),
      );
      setLoading(false);
    });
  }, [projectId, from, to]);

  const preview = useMemo(() => {
    if (!entries) return null;
    const rate = (e: UnbilledEntry) =>
      Number(e.hourly_rate ?? project?.hourly_rate ?? 0);
    const totalHours = entries.reduce((s, e) => s + Number(e.duration ?? 0), 0);
    const amount = entries.reduce(
      (s, e) => s + Number(e.duration ?? 0) * rate(e),
      0,
    );
    // Group by task + rate for line items
    const groups = new Map<
      string,
      { description: string; hours: number; rate: number; entryIds: string[] }
    >();
    for (const e of entries) {
      const r = rate(e);
      const key = `${e.task_id ?? "general"}|${r}`;
      if (!groups.has(key)) {
        groups.set(key, {
          description: e.task_id
            ? (taskNames[e.task_id] ?? "Task work")
            : "General project work",
          hours: 0,
          rate: r,
          entryIds: [],
        });
      }
      const g = groups.get(key)!;
      g.hours += Number(e.duration ?? 0);
      g.entryIds.push(e.id);
    }
    return { totalHours, amount, groups: Array.from(groups.values()) };
  }, [entries, project, taskNames]);

  async function generate() {
    if (!project || !entries || entries.length === 0 || !preview) return;
    setBusy(true);
    setError("");
    const now = Date.now();
    const invoiceNumber = await nextInvoiceNumber();
    const subtotal = +preview.amount.toFixed(2);

    const { data: invoice, error: invErr } = await supabase
      .from("invoices")
      .insert({
        account_id: project.account_id,
        project_id: project.id,
        invoice_number: invoiceNumber,
        status: "draft",
        issue_date: now,
        due_date: now + 30 * 86400000, // Net 30
        subtotal,
        tax_rate: 0,
        tax_amount: 0,
        total_amount: subtotal,
        currency: project.currency || DEFAULT_CURRENCY,
        notes: `Generated from ${entries.length} time entr${entries.length === 1 ? "y" : "ies"} (${from} → ${to})`,
        created_by_id: profile?.id ?? "system",
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (invErr || !invoice) {
      setBusy(false);
      setError(invErr?.message ?? "Failed to create invoice.");
      return;
    }
    const invoiceId = (invoice as { id: string }).id;

    for (const g of preview.groups) {
      const { error: liErr } = await supabase.from("invoice_line_items").insert({
        invoice_id: invoiceId,
        description: g.description,
        quantity: +g.hours.toFixed(2),
        unit_price: g.rate,
        total_price: +(g.hours * g.rate).toFixed(2),
        time_entry_ids: g.entryIds,
        created_at: now,
      });
      if (liErr) {
        setBusy(false);
        setError(`Invoice created but a line item failed: ${liErr.message}`);
        return;
      }
    }

    const { error: teErr } = await supabase
      .from("time_entries")
      .update({ invoice_id: invoiceId, updated_at: now })
      .in("id", entries.map((e) => e.id));
    if (teErr) {
      setBusy(false);
      setError(`Invoice created but entries were not marked billed: ${teErr.message}`);
      return;
    }

    invalidateLookup("invoices");
    setBusy(false);
    navigate(`/invoices/${invoiceId}`);
    onClose();
  }

  return (
    <Modal title="Generate Invoice from Time Entries" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel required>Project</FieldLabel>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">— Select project —</option>
              {projects.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel>From</FieldLabel>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <FieldLabel>To</FieldLabel>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : !projectId ? (
          <EmptyState message="Pick a project to find unbilled billable hours." />
        ) : entries && entries.length === 0 ? (
          <EmptyState message="No unbilled billable time entries in this period." />
        ) : entries && preview ? (
          <>
            <div className="grid grid-cols-3 gap-4">
              <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] rounded-[var(--radius-md)] p-4 text-center">
                <p className="label-mono mb-1">Entries</p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                  {entries.length}
                </p>
              </div>
              <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] rounded-[var(--radius-md)] p-4 text-center">
                <p className="label-mono mb-1">Hours</p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                  {fmtHours(preview.totalHours)}
                </p>
              </div>
              <div className="bg-[var(--section-darker)] border border-[rgba(60,201,152,0.2)] rounded-[var(--radius-md)] p-4 text-center glow-mint">
                <p className="label-mono mb-1">Invoice Total</p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--mint)]">
                  {fmtCurrency(preview.amount, project?.currency ?? DEFAULT_CURRENCY)}
                </p>
              </div>
            </div>

            {/* Line item preview */}
            <div className="rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.06)] overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--section-darker)]">
                    {["Line Item", "Hours", "Rate", "Amount"].map((h) => (
                      <th key={h} className="px-3 py-2 text-left label-mono">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.groups.map((g, i) => (
                    <tr key={i} className="border-t border-[rgba(255,255,255,0.04)]">
                      <td className="px-3 py-2 text-sm text-[var(--text-light)]">
                        {g.description}
                      </td>
                      <td className="px-3 py-2 text-sm font-[var(--font-mono)] text-[var(--text-mid)]">
                        {g.hours.toFixed(2)}
                      </td>
                      <td className="px-3 py-2 text-sm font-[var(--font-mono)] text-[var(--text-mid)]">
                        {fmtCurrency(g.rate, project?.currency ?? DEFAULT_CURRENCY)}
                      </td>
                      <td className="px-3 py-2 text-sm font-[var(--font-mono)] text-[var(--foreground)]">
                        {fmtCurrency(g.hours * g.rate, project?.currency ?? DEFAULT_CURRENCY)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.amount === 0 && (
              <p className="text-xs text-[#D9B96A]">
                Heads up: these entries have no hourly rate (and the project has no
                default rate), so the invoice total is 0. You can still generate it
                and edit amounts manually.
              </p>
            )}
          </>
        ) : null}

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={generate}
            disabled={busy || !entries || entries.length === 0}
          >
            {busy ? "Generating…" : (
              <>
                <Wand2 size={15} strokeWidth={1.5} />
                Generate Invoice
              </>
            )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
