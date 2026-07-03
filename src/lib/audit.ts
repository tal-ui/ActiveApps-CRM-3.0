import { supabase } from "./supabase";
import type { Profile } from "./auth";

export interface AuditEntry {
  action: string; // e.g. "role_change" | "active_toggle" | "settings_update" | "enable" | "disable" | "stop_timer" | "mark_overdue" | "restore" | "link_summary"
  entity_type: string; // e.g. "profile" | "workspace_settings" | "automation_rule" | "webhook" | "time_entry" | "invoice" | "monthly_summary"
  entity_id?: string | null; // null for bulk operations
  summary: string; // human sentence, e.g. "Linked 210 time entries to 4 monthly summaries"
  before?: unknown;
  after?: unknown;
}

/** Fire-and-forget audit write — auditing must never break the action itself. */
export async function insertAudit(
  profile: Profile | null,
  e: AuditEntry,
): Promise<void> {
  try {
    await supabase.from("audit_log").insert({
      actor_id: profile?.id ?? null,
      actor_email: profile?.email ?? null,
      action: e.action,
      entity_type: e.entity_type,
      entity_id: e.entity_id ?? null,
      summary: e.summary,
      before: e.before ?? null,
      after: e.after ?? null,
      created_at: Date.now(),
    });
  } catch {
    /* non-fatal */
  }
}

// Values written by the Setup area — drives the Audit Log viewer's filters.
export const AUDIT_ACTIONS = [
  "role_change",
  "active_toggle",
  "settings_update",
  "enable",
  "disable",
  "stop_timer",
  "mark_overdue",
  "restore",
  "link_summary",
] as const;

export const AUDIT_ENTITY_TYPES = [
  "profile",
  "workspace_settings",
  "automation_rule",
  "webhook",
  "time_entry",
  "invoice",
  "monthly_summary",
] as const;
