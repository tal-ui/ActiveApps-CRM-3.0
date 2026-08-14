// The monthly invoice email: its default text, its placeholder vocabulary, and
// the one function that fills them in.
//
// Resolution happens in the BROWSER, before the modal renders, and the edge
// function is handed the finished subject and body. That way what the sender
// reads is exactly what the client receives — there is no second rendering
// that could disagree.
import { fmtMoneyAscii } from "./format";
import {
  fmtDayMonthYear,
  monthBoundsMs,
  type SummaryEmailContext,
} from "./summaryEmail";
import type { WorkspaceSettings } from "./workspaceSettings";

export { DEFAULT_EMAIL_SUBJECT, DEFAULT_EMAIL_BODY } from "./emailTemplateText";

export type TemplateVars = Record<string, string>;

/** Every placeholder the modal offers, with what it resolves to. */
export const PLACEHOLDER_HELP: { key: string; describes: string }[] = [
  { key: "doc_number", describes: "Green Invoice tax invoice number" },
  { key: "crm_invoice_number", describes: "the CRM's own invoice number" },
  { key: "client_short_name", describes: "account short name, else its name" },
  { key: "client_name", describes: "account name" },
  { key: "client_legal_name", describes: "account legal name, else its name" },
  { key: "month_name", describes: "June" },
  { key: "year", describes: "2026" },
  { key: "month_year", describes: "June 2026" },
  { key: "amount_net", describes: "amount VAT is charged on, after discount" },
  { key: "amount_total", describes: "total including VAT" },
  { key: "currency", describes: "the invoice's currency code" },
  { key: "vat_rate", describes: "18" },
  { key: "period_start", describes: "01/06/2026" },
  { key: "period_end", describes: "30/06/2026" },
  { key: "total_hours", describes: "billable hours on the summary" },
  { key: "sender_name", describes: "from Settings → Email" },
  { key: "sender_phone", describes: "from Settings → Email" },
  { key: "sender_email", describes: "from Settings → Email" },
  { key: "issuer_name", describes: "issuer legal name from Tax Invoicing" },
  { key: "issuer_tax_id", describes: "issuer ח.פ. / ע.מ." },
];

export interface SenderIdentity {
  name: string;
  phone: string;
  email: string;
}

export function buildTemplateVars(
  ctx: SummaryEmailContext,
  sender: SenderIdentity,
  settings: WorkspaceSettings,
): TemplateVars {
  const inv = ctx.invoice;
  const currency = inv?.currency ?? "ILS";
  // The figure VAT is actually charged on — and the one the tax document
  // reconciles to. Identical to the subtotal when there is no discount.
  const net = inv ? inv.subtotal - inv.discount_amount : 0;
  const [from, to] = monthBoundsMs(ctx.summary.year, ctx.summary.month);
  const [monthName = "", year = ""] = ctx.monthLabel.split(" ");

  return {
    doc_number: inv?.external_doc_number ?? "",
    crm_invoice_number: inv?.invoice_number ?? "",
    client_short_name: ctx.account.short_name || ctx.account.name,
    client_name: ctx.account.name,
    client_legal_name: ctx.account.legal_name || ctx.account.name,
    month_name: monthName,
    year: year || ctx.summary.year,
    month_year: ctx.monthLabel,
    amount_net: inv ? fmtMoneyAscii(net, currency) : "",
    amount_total: inv ? fmtMoneyAscii(inv.total_amount, currency) : "",
    currency,
    vat_rate: inv ? String(inv.tax_rate) : "",
    period_start: fmtDayMonthYear(from),
    period_end: fmtDayMonthYear(to),
    total_hours: ctx.billableHours.toFixed(2),
    sender_name: sender.name,
    sender_phone: sender.phone,
    sender_email: sender.email,
    issuer_name: settings.issuerLegalName,
    issuer_tax_id: settings.issuerTaxId,
  };
}

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi;

/**
 * Unknown keys are left LITERAL rather than blanked, so a typo shows up in the
 * preview instead of silently disappearing from a client's email.
 */
export function renderTemplate(tpl: string, vars: TemplateVars): string {
  return tpl.replace(PLACEHOLDER, (whole, key: string) => {
    const v = vars[key.toLowerCase()];
    return v === undefined ? whole : v;
  });
}

/**
 * Placeholders that resolved to nothing. These block sending: "Amount:  + VAT"
 * must never reach a client.
 */
export function missingPlaceholders(
  tpl: string,
  vars: TemplateVars,
): string[] {
  const missing = new Set<string>();
  for (const m of tpl.matchAll(PLACEHOLDER)) {
    const key = m[1].toLowerCase();
    if (vars[key] !== undefined && vars[key].trim() === "") missing.add(key);
  }
  return [...missing];
}
