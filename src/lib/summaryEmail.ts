// Everything the "Send to Client" modal needs about one monthly summary,
// loaded in one place so the modal stays presentation.
//
// Money comes from the INVOICE, never from the summary. monthly_summaries
// roll-ups drift when entries move; invoices.subtotal / discount_amount are
// the exact figures the tax document was built from, and guard_issued_invoice()
// freezes them once it is issued. An email built from the invoice therefore
// cannot disagree with the legal document.
import { supabase } from "./supabase";
import type { ReportEntry } from "./pdf";
import { monthLabel } from "./monthlySummary";

export interface SummaryEmailInvoice {
  id: string;
  invoice_number: string;
  currency: string;
  subtotal: number;
  discount_percent: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  total_amount: number;
  external_doc_number: string | null;
  external_doc_id: string | null;
  doc_pdf_path: string | null;
  issued_at: number | null;
}

export interface SummaryEmailContact {
  email: string;
  name: string;
  is_primary: boolean;
}

export interface PastSend {
  sent_at: number;
  to_addresses: string[];
  status: string;
}

export interface SummaryEmailContext {
  summary: {
    id: string;
    name: string;
    month: string;
    year: string;
    status: string;
    account_id: string;
    emailed_at: number | null;
  };
  account: {
    id: string;
    name: string;
    short_name: string | null;
    legal_name: string | null;
    email: string | null;
  };
  invoice: SummaryEmailInvoice | null;
  entries: ReportEntry[];
  /** Hebrew-safe display name for the PDF subtitle; "" when unrenderable. */
  reportSubtitle: string;
  monthLabel: string;
  totalHours: number;
  billableHours: number;
  /** Entries dated outside the calendar month — the Billing Period line prints
   *  calendar bounds, so this is what explains the difference. */
  outOfMonthCount: number;
  /** Billable entries on the summary that carry no invoice_id: they show up in
   *  the breakdown but are NOT in the invoiced amount. A real money mismatch —
   *  it happens when an entry is linked after the invoice was generated. */
  unbilledBillableCount: number;
  contacts: SummaryEmailContact[];
  lastSend: PastSend | null;
}

const HEBREW = /[֐-׿]/;

/** Millisecond bounds of a calendar month, end inclusive. */
export function monthBoundsMs(year: string, month: string): [number, number] {
  const y = Number(year);
  const m = Number(month) - 1;
  return [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime() - 1];
}

/** dd/mm/yyyy — the format the billing-period line uses. */
export function fmtDayMonthYear(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? "" : String(v));

export async function loadSummaryEmailContext(
  summaryId: string,
): Promise<{ context?: SummaryEmailContext; error?: string }> {
  const { data: summaryRow, error: summaryErr } = await supabase
    .from("monthly_summaries")
    .select("id, name, month, year, status, account_id, emailed_at")
    .eq("id", summaryId)
    .maybeSingle();
  if (summaryErr) return { error: summaryErr.message };
  if (!summaryRow) return { error: "Monthly summary not found." };
  const s = summaryRow as Row;

  const [{ data: accountRow }, { data: invoiceRow }, { data: entryRows }] =
    await Promise.all([
      supabase
        .from("accounts")
        .select("id, name, short_name, legal_name, email")
        .eq("id", str(s.account_id))
        .maybeSingle(),
      supabase
        .from("invoices")
        .select(
          "id, invoice_number, currency, subtotal, discount_percent, discount_amount, tax_rate, tax_amount, total_amount, external_doc_number, external_doc_id, doc_pdf_path, issued_at",
        )
        .eq("monthly_summary_id", summaryId)
        .eq("is_deleted", false)
        .maybeSingle(),
      // Deliberately NOT filtered by is_billable: the PDF computes its TOTAL
      // HOURS and BILLABLE boxes from the full set and filters only the table.
      // Filtering here would quietly change the header numbers relative to the
      // Time Tracking export of the same month.
      supabase
        .from("time_entries")
        .select(
          "id, date, duration, is_billable, description, project_id, task_id, invoice_id",
        )
        .eq("monthly_summary_id", summaryId)
        .eq("is_deleted", false)
        .eq("is_running", false)
        .order("date", { ascending: true })
        .limit(2000),
    ]);

  const rows = (entryRows ?? []) as Row[];
  const projectIds = [
    ...new Set(rows.map((r) => str(r.project_id)).filter(Boolean)),
  ];
  const taskIds = [...new Set(rows.map((r) => str(r.task_id)).filter(Boolean))];

  // Resolved against the exact id set rather than through the lookup cache,
  // which caps at 1000 rows ordered by updated_at — an older task would render
  // as a blank Subject on a document a client reads.
  const [{ data: projectRows }, { data: taskRows }, { data: contactRows }, { data: sendRows }] =
    await Promise.all([
      projectIds.length
        ? supabase.from("projects").select("id, name").in("id", projectIds)
        : Promise.resolve({ data: [] as Row[] }),
      taskIds.length
        ? supabase.from("tasks").select("id, name").in("id", taskIds)
        : Promise.resolve({ data: [] as Row[] }),
      supabase
        .from("contacts")
        .select("first_name, last_name, email, is_primary")
        .eq("account_id", str(s.account_id))
        .eq("is_deleted", false)
        .limit(50),
      supabase
        .from("email_log")
        .select("sent_at, to_addresses, status")
        .eq("entity_type", "monthly_summary")
        .eq("entity_id", summaryId)
        .order("sent_at", { ascending: false })
        .limit(1),
    ]);

  const nameById = (list: Row[] | null) =>
    new Map((list ?? []).map((r) => [str(r.id), str(r.name)]));
  const projects = nameById(projectRows as Row[] | null);
  const tasks = nameById(taskRows as Row[] | null);

  const entries: ReportEntry[] = rows.map((r) => ({
    date: num(r.date),
    duration: num(r.duration),
    is_billable: Boolean(r.is_billable),
    description: r.description == null ? null : String(r.description),
    project: projects.get(str(r.project_id)) ?? "Unknown project",
    task: tasks.get(str(r.task_id)) ?? "",
  }));

  const acc = (accountRow ?? {}) as Row;
  // The subtitle is rendered by jsPDF's built-in fonts, which carry no Hebrew
  // glyphs. On a PDF only Tal downloads that was cosmetic; emailing it to a
  // client makes tofu a client-facing defect, so fall back rather than print it.
  const candidates = [str(acc.short_name), str(acc.legal_name), str(acc.name)];
  const reportSubtitle = candidates.find((c) => c && !HEBREW.test(c)) ?? "";

  const [from, to] = monthBoundsMs(str(s.year), str(s.month));

  return {
    context: {
      summary: {
        id: str(s.id),
        name: str(s.name),
        month: str(s.month),
        year: str(s.year),
        status: str(s.status),
        account_id: str(s.account_id),
        emailed_at: s.emailed_at == null ? null : num(s.emailed_at),
      },
      account: {
        id: str(acc.id),
        name: str(acc.name),
        short_name: acc.short_name == null ? null : str(acc.short_name),
        legal_name: acc.legal_name == null ? null : str(acc.legal_name),
        email: acc.email == null ? null : str(acc.email),
      },
      invoice: invoiceRow
        ? (() => {
            const i = invoiceRow as Row;
            return {
              id: str(i.id),
              invoice_number: str(i.invoice_number),
              currency: str(i.currency) || "ILS",
              subtotal: num(i.subtotal),
              discount_percent: num(i.discount_percent),
              discount_amount: num(i.discount_amount),
              tax_rate: num(i.tax_rate),
              tax_amount: num(i.tax_amount),
              total_amount: num(i.total_amount),
              external_doc_number: i.external_doc_number
                ? str(i.external_doc_number)
                : null,
              external_doc_id: i.external_doc_id ? str(i.external_doc_id) : null,
              doc_pdf_path: i.doc_pdf_path ? str(i.doc_pdf_path) : null,
              issued_at: i.issued_at == null ? null : num(i.issued_at),
            };
          })()
        : null,
      entries,
      reportSubtitle,
      monthLabel: monthLabel(str(s.year), str(s.month)),
      totalHours: entries.reduce((t, e) => t + e.duration, 0),
      billableHours: entries
        .filter((e) => e.is_billable)
        .reduce((t, e) => t + e.duration, 0),
      outOfMonthCount: rows.filter(
        (r) => num(r.date) < from || num(r.date) > to,
      ).length,
      unbilledBillableCount: rows.filter(
        (r) => Boolean(r.is_billable) && !r.invoice_id,
      ).length,
      contacts: ((contactRows ?? []) as Row[])
        .filter((c) => str(c.email))
        .map((c) => ({
          email: str(c.email),
          name: `${str(c.first_name)} ${str(c.last_name)}`.trim(),
          is_primary: Boolean(c.is_primary),
        }))
        .sort((a, b) => Number(b.is_primary) - Number(a.is_primary)),
      lastSend: ((sendRows ?? []) as Row[]).length
        ? {
            sent_at: num((sendRows as Row[])[0].sent_at),
            to_addresses: ((sendRows as Row[])[0].to_addresses ??
              []) as string[],
            status: str((sendRows as Row[])[0].status),
          }
        : null,
    },
  };
}
