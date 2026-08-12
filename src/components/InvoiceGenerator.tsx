import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Wand2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { invalidateLookup, useLookupOptions } from "../lib/lookups";
import {
  ensureMonthlySummary,
  linkEntriesToSummary,
  monthLabel,
} from "../lib/monthlySummary";
import { useWorkspaceSettings, vatRateFor } from "../lib/workspaceSettings";
import { DEFAULT_CURRENCY, fmtCurrency, fmtHours } from "../lib/format";
import SearchableSelect from "./SearchableSelect";
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
  project_id: string | null;
  date: number;
  duration: number | string;
  hourly_rate: number | string | null;
  monthly_summary_id: string | null;
}

const ENTRY_COLUMNS =
  "id, project_id, date, duration, hourly_rate, monthly_summary_id";

interface AccountRow {
  id: string;
  name: string;
  vat_exempt: boolean | null;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, i) => ({ value: String(i + 1).padStart(2, "0"), label }));

/** Millisecond bounds of a calendar month, end inclusive. */
function monthRange(year: string, month: string): [number, number] {
  const y = Number(year);
  const m = Number(month) - 1;
  return [
    new Date(y, m, 1).getTime(),
    new Date(y, m + 1, 1).getTime() - 1,
  ];
}

/**
 * Generates one invoice for an account's month of billable work, across every
 * project it touched. The monthly summary is the billing unit — a single
 * project can't produce a correct invoice, because a month's work is spread
 * over several of them.
 */
export default function InvoiceGenerator({
  accountId: initialAccountId,
  onClose,
}: {
  accountId?: string;
  onClose: () => void;
}) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const accounts = useLookupOptions("accounts");
  const projects = useLookupOptions("projects");
  const settings = useWorkspaceSettings();

  const now = new Date();
  const [accountId, setAccountId] = useState(initialAccountId ?? "");
  const [year, setYear] = useState(String(now.getFullYear()));
  const [month, setMonth] = useState(
    String(now.getMonth() + 1).padStart(2, "0"),
  );

  const [entries, setEntries] = useState<UnbilledEntry[] | null>(null);
  const [account, setAccount] = useState<AccountRow | null>(null);
  const [discount, setDiscount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Every unbilled billable hour this month's invoice would carry. That is
  // whatever is already attached to the month's summary, plus the unattached
  // entries in the calendar month that generating would pull in — the same set
  // generate_invoice_from_summary() bills, so the preview cannot understate it.
  useEffect(() => {
    if (!accountId || !year || !month) {
      setEntries(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    const [from, to] = monthRange(year, month);
    (async () => {
      const [{ data: accountProjects }, { data: acc }, { data: summary }] =
        await Promise.all([
          supabase
            .from("projects")
            .select("id")
            .eq("account_id", accountId)
            .eq("is_deleted", false)
            .limit(500),
          supabase
            .from("accounts")
            .select("id, name, vat_exempt")
            .eq("id", accountId)
            .maybeSingle(),
          // An existing summary for this month carries the agreed discount and
          // may already hold entries dated outside the month.
          supabase
            .from("monthly_summaries")
            .select("id, discount")
            .eq("account_id", accountId)
            .eq("month", month)
            .eq("year", year)
            .eq("is_deleted", false)
            .maybeSingle(),
        ]);
      const projectIds = ((accountProjects ?? []) as { id: string }[]).map(
        (p) => p.id,
      );
      const existing = summary as { id: string; discount?: number } | null;

      const unbilled = () =>
        supabase
          .from("time_entries")
          .select(ENTRY_COLUMNS)
          .eq("is_billable", true)
          .eq("is_running", false)
          .eq("is_deleted", false)
          .is("invoice_id", null)
          .limit(2000);

      const [{ data: attached }, { data: loose }] = await Promise.all([
        existing
          ? unbilled().eq("monthly_summary_id", existing.id)
          : Promise.resolve({ data: [] as UnbilledEntry[] }),
        // Entries already on another month's summary belong to that month —
        // only unattached ones get swept in.
        projectIds.length
          ? unbilled()
              .in("project_id", projectIds)
              .is("monthly_summary_id", null)
              .gte("date", from)
              .lte("date", to)
          : Promise.resolve({ data: [] as UnbilledEntry[] }),
      ]);

      // A slower response from a previous account/month must not overwrite the
      // current one.
      if (cancelled) return;
      const byId = new Map<string, UnbilledEntry>();
      for (const e of [...(attached ?? []), ...(loose ?? [])] as UnbilledEntry[]) {
        byId.set(e.id, e);
      }
      setEntries([...byId.values()]);
      setAccount(acc as AccountRow | null);
      setDiscount(Number(existing?.discount ?? 0));
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, year, month]);

  const preview = useMemo(() => {
    if (!entries) return null;
    const hours = entries.reduce((s, e) => s + Number(e.duration ?? 0), 0);
    const subtotal = entries.reduce(
      (s, e) => s + Number(e.duration ?? 0) * Number(e.hourly_rate ?? 0),
      0,
    );
    const projectIds = Array.from(
      new Set(entries.map((e) => e.project_id).filter(Boolean) as string[]),
    );
    const discountAmount = +((subtotal * discount) / 100).toFixed(2);
    const net = subtotal - discountAmount;
    const taxRate = vatRateFor(settings, account);
    const tax = +((net * taxRate) / 100).toFixed(2);
    const [from, to] = monthRange(year, month);
    return {
      hours,
      subtotal,
      discountAmount,
      taxRate,
      tax,
      total: +(net + tax).toFixed(2),
      projectIds,
      // Someone may have deliberately filed a late entry under this month.
      carriedIn: entries.filter((e) => e.date < from || e.date > to).length,
    };
  }, [entries, discount, settings, account, year, month]);

  async function generate() {
    if (!account || !entries || entries.length === 0 || !preview) return;
    setBusy(true);
    setError("");

    // Find or create the month's summary and pull every entry into it, then
    // let the DB build the invoice — the same RPC the summary page calls.
    const { id: targetId, error: summaryError } = await ensureMonthlySummary({
      accountId: account.id,
      accountName: account.name,
      year,
      month,
      ownerId: profile?.id ?? "system",
    });
    if (summaryError || !targetId) {
      setBusy(false);
      setError(summaryError ?? "Could not prepare the monthly summary.");
      return;
    }

    const linkError = await linkEntriesToSummary(
      targetId,
      entries.filter((e) => e.monthly_summary_id !== targetId).map((e) => e.id),
    );
    if (linkError) {
      setBusy(false);
      setError(`Could not attach the time entries: ${linkError}`);
      return;
    }

    const { data, error: rpcError } = await supabase.rpc(
      "generate_invoice_from_summary",
      { p_summary_id: targetId },
    );
    setBusy(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    invalidateLookup("invoices");
    if (data) navigate(`/invoices/${String(data)}`);
    onClose();
  }

  const currency = DEFAULT_CURRENCY;

  return (
    <Modal title="Generate Invoice from Monthly Hours" onClose={onClose} wide>
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel required>Account</FieldLabel>
            <SearchableSelect
              options={accounts}
              value={accountId}
              onChange={setAccountId}
              placeholder="Search accounts…"
            />
          </div>
          <div>
            <FieldLabel required>Month</FieldLabel>
            <Select value={month} onChange={(e) => setMonth(e.target.value)}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <FieldLabel required>Year</FieldLabel>
            <Input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
        </div>

        {loading ? (
          <Spinner />
        ) : !accountId ? (
          <EmptyState message="Pick an account and month to find unbilled billable hours." />
        ) : entries && entries.length === 0 ? (
          <EmptyState
            message={`No unbilled billable hours for ${monthLabel(year, month)}.`}
          />
        ) : entries && preview ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] rounded-[var(--radius-md)] p-4 text-center">
                <p className="label-mono mb-1">Hours</p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                  {fmtHours(preview.hours)}
                </p>
                <p className="text-xs text-[var(--text-faint)] mt-1">
                  {entries.length} {entries.length === 1 ? "entry" : "entries"}
                </p>
              </div>
              <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] rounded-[var(--radius-md)] p-4 text-center">
                <p className="label-mono mb-1">Projects</p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                  {preview.projectIds.length}
                </p>
                <p className="text-xs text-[var(--text-faint)] mt-1">
                  on one invoice
                </p>
              </div>
              <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] rounded-[var(--radius-md)] p-4 text-center">
                <p className="label-mono mb-1">
                  {discount > 0 ? `Less ${discount}%` : `VAT ${preview.taxRate}%`}
                </p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                  {discount > 0
                    ? `-${fmtCurrency(preview.discountAmount, currency)}`
                    : fmtCurrency(preview.tax, currency)}
                </p>
                {account?.vat_exempt && (
                  <p className="text-xs text-[var(--text-faint)] mt-1">
                    client is exempt
                  </p>
                )}
              </div>
              <div className="bg-[var(--section-darker)] border border-[rgba(60,201,152,0.2)] rounded-[var(--radius-md)] p-4 text-center glow-mint">
                <p className="label-mono mb-1">Invoice Total</p>
                <p className="font-[var(--font-heading)] font-bold text-xl text-[var(--mint)]">
                  {fmtCurrency(preview.total, currency)}
                </p>
              </div>
            </div>

            <div className="rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.06)] p-4 space-y-1.5">
              <p className="label-mono mb-2">Covers work on</p>
              {preview.projectIds.map((id) => (
                <p key={id} className="text-sm text-[var(--text-light)]">
                  {projects.find((p) => p.value === id)?.label ?? "Project"}
                </p>
              ))}
              <p className="text-xs text-[var(--text-faint)] pt-2">
                Subtotal {fmtCurrency(preview.subtotal, currency)}
                {discount > 0 &&
                  ` · discount ${discount}% (-${fmtCurrency(preview.discountAmount, currency)})`}
                {preview.taxRate > 0 &&
                  ` · VAT ${preview.taxRate}% (${fmtCurrency(preview.tax, currency)})`}
              </p>
            </div>
            <p className="text-xs text-[var(--text-faint)]">
              These entries are attached to the {monthLabel(year, month)}{" "}
              summary and billed as one line. The per-project breakdown stays on
              the time entries.
              {preview.carriedIn > 0 && (
                <>
                  {" "}
                  {preview.carriedIn}{" "}
                  {preview.carriedIn === 1 ? "entry is" : "entries are"} dated
                  outside the month but already filed under this summary, so the
                  invoice carries {preview.carriedIn === 1 ? "it" : "them"} too.
                </>
              )}
            </p>
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
