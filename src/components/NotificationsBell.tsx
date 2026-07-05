import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  CheckSquare,
  FileText,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { timeAgo } from "../lib/format";
import { EmptyState } from "./ui";

interface NotificationRow {
  id: string;
  type: string | null;
  title: string;
  body: string | null;
  url_path: string | null;
  is_read: boolean;
  created_at: number;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  lead_created: Target,
  deal_won: TrendingUp,
  deal_lost: TrendingDown,
  invoice_paid: FileText,
  invoice_overdue: FileText,
  task_assigned: CheckSquare,
};

export default function NotificationsBell() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(false);

  const profileId = profile?.id;
  // Broadcast rows (recipient_id null) + rows addressed to me. Null while the
  // profile is still loading — every query below skips until it resolves.
  const recipientFilter = profileId
    ? `recipient_id.is.null,recipient_id.eq.${profileId}`
    : null;

  const refreshCount = useCallback(async () => {
    if (!recipientFilter) return;
    const { count: c } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("is_read", false)
      .or(recipientFilter);
    setCount(c ?? 0);
  }, [recipientFilter]);

  // Poll every 60s + refresh on window focus; all listeners cleaned up.
  useEffect(() => {
    void refreshCount();
    const t = setInterval(() => void refreshCount(), 60_000);
    const onFocus = () => void refreshCount();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [refreshCount]);

  // Load latest 30 when the panel opens.
  useEffect(() => {
    if (!open || !recipientFilter) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("notifications")
      .select("id, type, title, body, url_path, is_read, created_at")
      .or(recipientFilter)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data }) => {
        if (cancelled) return;
        setRows((data as NotificationRow[] | null) ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, recipientFilter]);

  // Escape closes the panel.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const openRow = async (n: NotificationRow) => {
    if (!n.is_read) {
      await supabase.from("notifications").update({ is_read: true }).eq("id", n.id);
    }
    setOpen(false);
    if (n.url_path) navigate(n.url_path);
    void refreshCount();
  };

  const markAllRead = async () => {
    if (!recipientFilter) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("is_read", false)
      .or(recipientFilter);
    setRows((prev) => prev.map((r) => ({ ...r, is_read: true })));
    void refreshCount();
  };

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        aria-label="Notifications"
        className="relative flex items-center justify-center h-9 w-9 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
      >
        <Bell size={15} strokeWidth={1.5} />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-[var(--mint)] text-[var(--primary-foreground)] text-[10px] font-bold flex items-center justify-center px-1">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <>
            <div
              className="fixed inset-0 z-50"
              onMouseDown={() => setOpen(false)}
              aria-hidden="true"
            />
            <div className="fixed z-50 inset-x-2 top-14 sm:inset-x-auto sm:right-4 sm:top-16 sm:w-96 max-h-[70vh] flex flex-col bg-[var(--card)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-xl)] shadow-[0_0_60px_rgba(60,201,152,0.05)] overflow-hidden">
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.08)] flex items-center justify-between">
                <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
                  Notifications
                </h3>
                {count > 0 && (
                  <button
                    onClick={() => void markAllRead()}
                    className="text-xs text-[var(--mint)] hover:underline cursor-pointer"
                  >
                    Mark all read
                  </button>
                )}
              </div>
              <div className="overflow-y-auto flex-1">
                {loading ? (
                  <p className="label-mono px-4 py-6 text-center">Loading…</p>
                ) : rows.length === 0 ? (
                  <EmptyState message="You're all caught up." />
                ) : (
                  rows.map((n) => {
                    const Icon = TYPE_ICONS[n.type ?? ""] ?? Bell;
                    return (
                      <button
                        key={n.id}
                        onClick={() => void openRow(n)}
                        className={`w-full flex items-start gap-3 px-4 py-3 text-left border-b border-[rgba(255,255,255,0.04)] hover:bg-[var(--navy-surface)] transition-colors cursor-pointer ${
                          n.is_read ? "" : "border-l-2 border-l-[var(--mint)]"
                        }`}
                      >
                        <Icon
                          size={15}
                          strokeWidth={1.5}
                          className="text-[var(--mint)] shrink-0 mt-0.5"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-sm truncate text-[var(--foreground)]">
                            {n.title}
                          </span>
                          {n.body && (
                            <span className="block text-xs text-[var(--text-dim)] line-clamp-2">
                              {n.body}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 flex flex-col items-end gap-1">
                          <span className="label-mono">{timeAgo(n.created_at)}</span>
                          {!n.is_read && (
                            <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)]" />
                          )}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
