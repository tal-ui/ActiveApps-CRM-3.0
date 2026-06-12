export function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtCurrency(
  n: number | string | null | undefined,
  currency = "USD",
): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `$${num.toLocaleString()}`;
  }
}

export function fmtNumber(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  return num.toLocaleString();
}

export function fmtHours(n: number | string | null | undefined): string {
  if (n === null || n === undefined || n === "") return "—";
  const num = typeof n === "string" ? parseFloat(n) : n;
  if (isNaN(num)) return "—";
  return `${num.toFixed(1)}h`;
}

export function timeAgo(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - Number(ms);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function titleCase(s: string | null | undefined): string {
  if (!s) return "—";
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function startOfMonthMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

export function dateToMs(dateStr: string): number | null {
  if (!dateStr) return null;
  const t = new Date(dateStr + "T00:00:00").getTime();
  return isNaN(t) ? null : t;
}

export function msToDateInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function msToDatetimeInput(ms: number | null | undefined): string {
  if (!ms) return "";
  const d = new Date(Number(ms));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function datetimeToMs(str: string): number | null {
  if (!str) return null;
  const t = new Date(str).getTime();
  return isNaN(t) ? null : t;
}
