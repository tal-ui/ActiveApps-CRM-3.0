// Multi-currency exchange rates, refreshed once per day and cached in
// localStorage. NIS (ILS) is the app's default currency. Rates are fetched
// client-side from a free, key-less FX service (with a fallback provider and
// a last-resort offline estimate) so the calculator keeps working offline.
import { useCallback, useEffect, useState } from "react";
import { DEFAULT_CURRENCY } from "./format";

export { DEFAULT_CURRENCY };

export interface CurrencyMeta {
  code: string;
  name: string;
  symbol: string;
}

// Curated picker list — NIS first (default). Conversions can use any code the
// rate table returns; this list just drives the selectors and the quick grid.
export const CURRENCIES: CurrencyMeta[] = [
  { code: "ILS", name: "Israeli New Shekel", symbol: "₪" },
  { code: "USD", name: "US Dollar", symbol: "$" },
  { code: "EUR", name: "Euro", symbol: "€" },
  { code: "GBP", name: "British Pound", symbol: "£" },
  { code: "JPY", name: "Japanese Yen", symbol: "¥" },
  { code: "CHF", name: "Swiss Franc", symbol: "CHF" },
  { code: "CAD", name: "Canadian Dollar", symbol: "C$" },
  { code: "AUD", name: "Australian Dollar", symbol: "A$" },
  { code: "CNY", name: "Chinese Yuan", symbol: "¥" },
  { code: "INR", name: "Indian Rupee", symbol: "₹" },
  { code: "AED", name: "UAE Dirham", symbol: "د.إ" },
];

export interface RateData {
  base: string; // currency the `rates` are expressed against
  rates: Record<string, number>; // units of each currency per 1 `base`
  lastUpdate: number | null; // ms — when the provider last refreshed
  nextUpdate: number | null; // ms — when the provider refreshes next
  fetchedAt: number; // ms — when we fetched it
  source: string; // provider label
  stale: boolean; // true when served from cache/offline after a failed fetch
}

const CACHE_KEY = "aa-crm-fx-rates";
const PRIMARY_URL = "https://open.er-api.com/v6/latest/USD";
const FALLBACK_URL = "https://api.frankfurter.dev/v1/latest?base=USD";

// Last-resort approximate rates (USD base) if every network path fails and we
// have nothing cached. Clearly flagged as stale in the UI when used.
const OFFLINE: RateData = {
  base: "USD",
  rates: {
    USD: 1, ILS: 3.7, EUR: 0.92, GBP: 0.79, JPY: 157, CHF: 0.89,
    CAD: 1.36, AUD: 1.5, CNY: 7.2, INR: 83, AED: 3.67,
  },
  lastUpdate: null,
  nextUpdate: null,
  fetchedAt: 0,
  source: "offline estimate",
  stale: true,
};

function todayStr(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface CacheEnvelope {
  day: string; // local YYYY-MM-DD the rates were stored for
  data: RateData;
}

function readCache(): CacheEnvelope | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEnvelope;
    if (!parsed?.data?.rates) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(data: RateData): void {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({ day: todayStr(), data } satisfies CacheEnvelope),
    );
  } catch {
    /* storage unavailable — non-fatal */
  }
}

async function fetchPrimary(): Promise<RateData> {
  const res = await fetch(PRIMARY_URL);
  const json = await res.json();
  if (json?.result !== "success" || !json?.rates) {
    throw new Error("primary rate provider returned an unexpected payload");
  }
  return {
    base: json.base_code ?? "USD",
    rates: json.rates,
    lastUpdate: json.time_last_update_unix ? json.time_last_update_unix * 1000 : null,
    nextUpdate: json.time_next_update_unix ? json.time_next_update_unix * 1000 : null,
    fetchedAt: Date.now(),
    source: "exchangerate-api.com",
    stale: false,
  };
}

async function fetchFallback(): Promise<RateData> {
  const res = await fetch(FALLBACK_URL);
  const json = await res.json();
  if (!json?.rates) {
    throw new Error("fallback rate provider returned an unexpected payload");
  }
  return {
    base: "USD",
    rates: { ...json.rates, USD: 1 }, // frankfurter omits the base from rates
    lastUpdate: json.date ? Date.parse(`${json.date}T00:00:00Z`) : null,
    nextUpdate: null,
    fetchedAt: Date.now(),
    source: "frankfurter.app",
    stale: false,
  };
}

/** Convert `amount` from one currency to another using a rate table. */
export function convert(
  amount: number,
  from: string,
  to: string,
  data: RateData,
): number | null {
  const rFrom = data.rates[from];
  const rTo = data.rates[to];
  if (!rFrom || !rTo) return null;
  return (amount / rFrom) * rTo;
}

/** Units of `quote` per 1 unit of `base` (e.g. rate("USD","ILS") ≈ 3.7). */
export function rate(base: string, quote: string, data: RateData): number | null {
  return convert(1, base, quote, data);
}

/**
 * React hook: returns the daily exchange-rate table, fetching at most once per
 * calendar day (cached in localStorage). `refresh()` forces a re-fetch.
 */
export function useRates(): {
  data: RateData | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<RateData | null>(() => readCache()?.data ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (force: boolean) => {
    const cached = readCache();
    if (!force && cached && cached.day === todayStr()) {
      setData(cached.data);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      let fresh: RateData;
      try {
        fresh = await fetchPrimary();
      } catch {
        fresh = await fetchFallback();
      }
      writeCache(fresh);
      setData(fresh);
    } catch {
      if (cached) {
        setData({ ...cached.data, stale: true });
        setError("Couldn't reach the rate service — showing the last saved rates.");
      } else {
        setData(OFFLINE);
        setError("Couldn't load live rates — showing offline estimates.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  return { data, loading, error, refresh: () => void load(true) };
}
