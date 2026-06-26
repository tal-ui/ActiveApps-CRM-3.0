import { useMemo, useState } from "react";
import { ArrowLeftRight, Calculator, RefreshCw } from "lucide-react";
import {
  CURRENCIES,
  DEFAULT_CURRENCY,
  convert,
  rate,
  useRates,
} from "../lib/currency";
import { fmtDate } from "../lib/format";
import { Button, ErrorNote, FieldLabel, Input, Select, Spinner } from "../components/ui";

function symbolOf(code: string): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? code;
}

function money(n: number | null, code: string): string {
  if (n === null || !isFinite(n)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: code,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${code}`;
  }
}

function rateFmt(n: number | null): string {
  if (n === null || !isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: n < 10 ? 4 : 2,
  });
}

export default function CurrencyCalculator() {
  const { data, loading, error, refresh } = useRates();
  const [amount, setAmount] = useState("100");
  const [from, setFrom] = useState(DEFAULT_CURRENCY); // NIS default
  const [to, setTo] = useState("USD");

  const amt = parseFloat(amount);
  const safeAmt = isFinite(amt) ? amt : 0;

  const result = useMemo(
    () => (data ? convert(safeAmt, from, to, data) : null),
    [data, safeAmt, from, to],
  );

  const ilsPerUsd = data ? rate("USD", "ILS", data) : null; // 1 USD = ? ₪
  const usdPerIls = data ? rate("ILS", "USD", data) : null; // 1 ₪ = ? $

  const swap = () => {
    setFrom(to);
    setTo(from);
  };

  if (loading && !data) return <Spinner />;

  const updatedMs = data?.lastUpdate ?? data?.fetchedAt ?? null;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Calculator size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Currency Calculator
            </h1>
            <p className="label-mono">
              {data?.stale ? "rates unavailable — estimates shown" : "live daily exchange rates"}
            </p>
          </div>
        </div>
        <Button variant="subtle" onClick={refresh} disabled={loading}>
          <RefreshCw
            size={15}
            strokeWidth={1.8}
            className={loading ? "animate-spin" : ""}
          />
          Refresh
        </Button>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        {/* NIS ⇄ USD headline */}
        <div className="bg-[var(--card)] border border-[rgba(60,201,152,0.2)] rounded-[var(--radius-lg)] p-6 glow-mint">
          <p className="label-mono mb-4">NIS ⇄ USD</p>
          <div className="space-y-4">
            <div>
              <p className="text-xs text-[var(--text-faint)] mb-1">1 US Dollar buys</p>
              <p className="font-[var(--font-heading)] font-bold text-3xl text-[var(--mint)]">
                {rateFmt(ilsPerUsd)} <span className="text-[var(--text-mid)] text-xl">₪</span>
              </p>
            </div>
            <div className="h-px bg-[var(--hairline)]" />
            <div>
              <p className="text-xs text-[var(--text-faint)] mb-1">1 Shekel buys</p>
              <p className="font-[var(--font-heading)] font-bold text-3xl text-[var(--foreground)]">
                {rateFmt(usdPerIls)} <span className="text-[var(--text-mid)] text-xl">$</span>
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--text-faint)] mt-5">
            Updated {fmtDate(updatedMs)}
            {data?.source ? ` · ${data.source}` : ""}
          </p>
        </div>

        {/* Converter */}
        <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6">
          <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
            <div>
              <FieldLabel>From</FieldLabel>
              <Select value={from} onChange={(e) => setFrom(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <button
              type="button"
              onClick={swap}
              title="Swap currencies"
              aria-label="Swap currencies"
              className="mb-1 flex items-center justify-center w-10 h-10 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
            >
              <ArrowLeftRight size={16} strokeWidth={1.5} />
            </button>
            <div>
              <FieldLabel>To</FieldLabel>
              <Select value={to} onChange={(e) => setTo(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mt-4">
            <FieldLabel>Amount ({symbolOf(from)})</FieldLabel>
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
            />
          </div>

          <div className="mt-5 bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-5 text-center">
            <p className="label-mono mb-1.5">
              {money(safeAmt, from)} =
            </p>
            <p className="font-[var(--font-heading)] font-bold text-3xl text-[var(--mint)]">
              {money(result, to)}
            </p>
            <p className="text-xs text-[var(--text-faint)] mt-2">
              1 {from} = {rateFmt(data ? rate(from, to, data) : null)} {to}
            </p>
          </div>
        </div>
      </div>

      {/* Quick conversions from the selected amount */}
      <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-6 mt-6">
        <p className="label-mono mb-4">
          {money(safeAmt, from)} in other currencies
        </p>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
          {CURRENCIES.filter((c) => c.code !== from).map((c) => (
            <div
              key={c.code}
              className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] px-4 py-3"
            >
              <p className="text-xs text-[var(--text-faint)] mb-0.5">
                {c.code} · {c.name}
              </p>
              <p className="font-[var(--font-mono)] text-[var(--foreground)] text-sm">
                {money(data ? convert(safeAmt, from, c.code, data) : null, c.code)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
