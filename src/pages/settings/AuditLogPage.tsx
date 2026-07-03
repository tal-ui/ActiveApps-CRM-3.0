import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ScrollText } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { AUDIT_ACTIONS, AUDIT_ENTITY_TYPES } from "../../lib/audit";
import { fmtDateTime, titleCase } from "../../lib/format";
import {
  Button,
  EmptyState,
  ErrorNote,
  Input,
  Select,
  Spinner,
} from "../../components/ui";

const PAGE_SIZE = 50;

interface AuditRow {
  id: string;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  before: unknown;
  after: unknown;
  created_at: number;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="label-mono mb-1.5">{label}</p>
      <pre className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3 overflow-x-auto max-h-64">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditLogPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(0);
  }, [entityType, action, debounced]);

  useEffect(() => {
    let query = supabase
      .from("audit_log")
      .select("id, actor_email, action, entity_type, entity_id, summary, before, after, created_at", {
        count: "exact",
      })
      .order("created_at", { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (entityType) query = query.eq("entity_type", entityType);
    if (action) query = query.eq("action", action);
    if (debounced) query = query.ilike("summary", `%${debounced}%`);
    query.then(({ data, count, error: err }) => {
      if (err) setError(err.message);
      else setError("");
      setRows((data ?? []) as AuditRow[]);
      setTotal(count ?? 0);
    });
  }, [page, entityType, action, debounced]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
          <ScrollText size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
        </div>
        <div>
          <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
            Audit Log
          </h1>
          <p className="label-mono">
            {total} entr{total === 1 ? "y" : "ies"}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4 bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-4 mb-6">
        <div>
          <p className="label-mono mb-1.5">Entity</p>
          <Select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-48"
          >
            <option value="">All entities</option>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {titleCase(t)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <p className="label-mono mb-1.5">Action</p>
          <Select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-44"
          >
            <option value="">All actions</option>
            {AUDIT_ACTIONS.map((a) => (
              <option key={a} value={a}>
                {titleCase(a)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex-1 min-w-56">
          <p className="label-mono mb-1.5">Search</p>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search summaries…"
          />
        </div>
      </div>

      {!rows ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState message="No audit entries match. Admin actions in Setup are recorded here." />
      ) : (
        <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
          <div className="space-y-1">
            {rows.map((r) => {
              const isOpen = expanded === r.id;
              const hasDiff = r.before != null || r.after != null;
              return (
                <div
                  key={r.id}
                  className="border-b border-[rgba(255,255,255,0.05)] last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : r.id)}
                    className="w-full flex items-center gap-3 py-2.5 text-left cursor-pointer hover:bg-[var(--navy-surface)] rounded-[var(--radius-sm)] px-2 transition-colors"
                  >
                    {hasDiff ? (
                      isOpen ? (
                        <ChevronDown size={14} className="text-[var(--text-faint)] shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="text-[var(--text-faint)] shrink-0" />
                      )
                    ) : (
                      <span className="w-3.5 shrink-0" />
                    )}
                    <span className="font-[var(--font-mono)] text-xs text-[var(--text-faint)] w-36 shrink-0">
                      {fmtDateTime(r.created_at)}
                    </span>
                    <span className="inline-flex border border-[rgba(60,201,152,0.2)] bg-[rgba(60,201,152,0.08)] text-[var(--mint)] font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.13em] px-2 py-0.5 rounded-[var(--radius-sm)] shrink-0">
                      {titleCase(r.action)}
                    </span>
                    <span className="text-sm text-[var(--text-light)] truncate flex-1">
                      {r.summary}
                    </span>
                    <span className="text-xs text-[var(--text-dim)] shrink-0 hidden md:inline">
                      {r.actor_email ?? "system"}
                    </span>
                  </button>
                  {isOpen && hasDiff && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-9 pb-4 pt-1">
                      {r.before != null && <JsonBlock label="Before" value={r.before} />}
                      {r.after != null && <JsonBlock label="After" value={r.after} />}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-[rgba(255,255,255,0.05)]">
              <span className="label-mono">
                page {page + 1} of {pageCount}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="subtle"
                  disabled={page === 0}
                  onClick={() => setPage((p) => p - 1)}
                  className="!px-3 !py-1.5"
                >
                  Prev
                </Button>
                <Button
                  variant="subtle"
                  disabled={page >= pageCount - 1}
                  onClick={() => setPage((p) => p + 1)}
                  className="!px-3 !py-1.5"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
