import { supabase } from "./supabase";

/**
 * Next sequential document number for a table, e.g. "INV-2026-007" /
 * "Q-2026-0001". Read-then-increment (same semantics the invoice generator
 * always had): finds the highest existing number with the prefix and adds 1.
 */
export async function nextDocNumber({
  table,
  column,
  prefix,
  pad,
}: {
  table: string;
  column: string;
  prefix: string;
  pad: number;
}): Promise<string> {
  const { data } = await supabase
    .from(table)
    .select(column)
    .like(column, `${prefix}%`)
    .order(column, { ascending: false })
    .limit(1);
  const last = ((data ?? [])[0] as unknown as Record<string, unknown> | undefined)?.[
    column
  ] as string | undefined;
  const seq = last ? parseInt(last.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(pad, "0")}`;
}

export function nextInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return nextDocNumber({ table: "invoices", column: "invoice_number", prefix: `INV-${year}-`, pad: 3 });
}

export function nextQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  return nextDocNumber({ table: "quotes", column: "quote_number", prefix: `Q-${year}-`, pad: 4 });
}
