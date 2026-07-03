// Find-or-create a Monthly Summary for an account + month and link time
// entries to it. Factored out of TimeTrackingPage so the maintenance console
// can reuse the exact same, proven semantics. The DB roll-up triggers
// recompute total_hrs / sub_total / total_amount when entries are linked.
import { supabase } from "./supabase";

export function monthLabel(year: string, month: string): string {
  return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
    undefined,
    { month: "long", year: "numeric" },
  );
}

export async function ensureMonthlySummary({
  accountId,
  accountName,
  year,
  month,
  ownerId,
  status = "submitted",
}: {
  accountId: string;
  accountName: string;
  year: string; // "2026"
  month: string; // "01".."12"
  ownerId: string;
  status?: string;
}): Promise<{ id?: string; created?: boolean; error?: string }> {
  const { data: existing } = await supabase
    .from("monthly_summaries")
    .select("id")
    .eq("account_id", accountId)
    .eq("month", month)
    .eq("year", year)
    .eq("is_deleted", false)
    .limit(1);
  if (existing && existing.length > 0) {
    return { id: (existing[0] as { id: string }).id, created: false };
  }
  const now = Date.now();
  const { data, error } = await supabase
    .from("monthly_summaries")
    .insert({
      account_id: accountId,
      name: `${accountName} — ${monthLabel(year, month)}`,
      month,
      year,
      status,
      discount: 0,
      currency: "ILS",
      owner_id: ownerId,
      created_by_id: ownerId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();
  if (error || !data) {
    return { error: error?.message ?? "Could not create the monthly summary." };
  }
  return { id: (data as { id: string }).id, created: true };
}

/** Bulk-link time entries to a summary. Returns an error message or null. */
export async function linkEntriesToSummary(
  summaryId: string,
  entryIds: string[],
): Promise<string | null> {
  if (entryIds.length === 0) return null;
  const { error } = await supabase
    .from("time_entries")
    .update({ monthly_summary_id: summaryId, updated_at: Date.now() })
    .in("id", entryIds);
  return error ? error.message : null;
}
