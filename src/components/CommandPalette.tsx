import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Banknote,
  Calculator,
  CalendarRange,
  Kanban,
  LayoutDashboard,
  LayoutPanelLeft,
  Search,
  Slack,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";
import { NAV_OBJECTS, OBJECTS, recordTitle } from "../lib/objects";
import { supabase } from "../lib/supabase";

interface NavCommand {
  label: string;
  path: string;
  icon: LucideIcon;
}

interface RecordGroup {
  object: string;
  rows: Record<string, unknown>[];
}

type Item =
  | { kind: "nav"; label: string; path: string; icon: LucideIcon }
  | { kind: "record"; object: string; id: string; label: string };

const NAV_COMMANDS: NavCommand[] = [
  { label: "Dashboard", path: "/", icon: LayoutDashboard },
  { label: "Pipeline", path: "/pipeline", icon: Kanban },
  { label: "Financial", path: "/financial", icon: Banknote },
  { label: "Monthly Ops", path: "/monthly", icon: CalendarRange },
  { label: "Currency", path: "/currency", icon: Calculator },
  { label: "Time Tracking", path: "/time_entries", icon: OBJECTS.time_entries.icon },
  ...NAV_OBJECTS.map((name) => ({
    label: `Go to ${OBJECTS[name].plural}`,
    path: `/${name}`,
    icon: OBJECTS[name].icon,
  })),
  { label: "Custom Fields", path: "/settings/custom-fields", icon: SlidersHorizontal },
  { label: "Page Layouts", path: "/settings/layouts", icon: LayoutPanelLeft },
  { label: "Slack", path: "/settings/slack", icon: Slack },
];

const SEARCH_OBJECTS = NAV_OBJECTS.filter(
  (name) => OBJECTS[name].searchFields.length > 0,
);

const sanitize = (q: string) => q.replace(/[%,()'"]/g, "").trim();

export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<RecordGroup[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const latestQuery = useRef("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setGroups([]);
      setSearching(false);
      setHighlight(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = sanitize(query);
    latestQuery.current = q;
    if (q.length < 2) {
      setGroups([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(async () => {
      const results = await Promise.all(
        SEARCH_OBJECTS.map(async (name) => {
          const def = OBJECTS[name];
          const cols = Array.from(
            new Set(["id", ...def.titleFields, ...def.searchFields]),
          ).join(",");
          const orExpr = def.searchFields
            .map((f) => `${f}.ilike.%${q}%`)
            .join(",");
          const { data } = await supabase
            .from(name)
            .select(cols)
            .or(orExpr)
            .limit(4);
          return {
            object: name,
            rows: (data ?? []) as unknown as Record<string, unknown>[],
          };
        }),
      );
      if (latestQuery.current !== q) return;
      setGroups(results.filter((g) => g.rows.length > 0));
      setSearching(false);
    }, 200);
    return () => clearTimeout(timer);
  }, [open, query]);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? NAV_COMMANDS.filter((c) => c.label.toLowerCase().includes(q))
      : NAV_COMMANDS;
  }, [query]);

  const items = useMemo<Item[]>(
    () => [
      ...filteredCommands.map((c) => ({ kind: "nav" as const, ...c })),
      ...groups.flatMap((g) =>
        g.rows.map((r) => ({
          kind: "record" as const,
          object: g.object,
          id: String(r.id),
          label: recordTitle(OBJECTS[g.object], r),
        })),
      ),
    ],
    [filteredCommands, groups],
  );

  const groupOffsets = useMemo(() => {
    const offsets: number[] = [];
    let acc = filteredCommands.length;
    for (const g of groups) {
      offsets.push(acc);
      acc += g.rows.length;
    }
    return offsets;
  }, [filteredCommands, groups]);

  useEffect(() => {
    setHighlight(0);
  }, [query, groups]);

  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  if (!open) return null;

  const activate = (item: Item) => {
    navigate(item.kind === "nav" ? item.path : `/${item.object}/${item.id}`);
    onClose();
  };

  const rowClass = (active: boolean) =>
    active
      ? "w-full flex items-center gap-3 px-4 py-2 text-sm text-left bg-[rgba(60,201,152,0.08)] text-[var(--mint)] cursor-pointer"
      : "w-full flex items-center gap-3 px-4 py-2 text-sm text-left text-[var(--text-mid)] cursor-pointer";

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setHighlight((h) => Math.min(h + 1, Math.max(items.length - 1, 0)));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setHighlight((h) => Math.max(h - 1, 0));
        } else if (e.key === "Enter") {
          e.preventDefault();
          const item = items[highlight];
          if (item) activate(item);
        }
      }}
    >
      <div className="max-w-xl mt-[12vh] mx-auto bg-[var(--card)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-xl)] shadow-[0_0_60px_rgba(60,201,152,0.05)] overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-[rgba(255,255,255,0.08)]">
          <Search
            size={16}
            strokeWidth={1.5}
            className="text-[var(--text-dim)] shrink-0"
          />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search records or jump to a page…"
            className="flex-1 bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--text-faint)] focus:outline-none"
          />
        </div>
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {filteredCommands.length > 0 && (
            <p className="label-mono px-4 pt-2 pb-1">Navigate</p>
          )}
          {filteredCommands.map((cmd, i) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.path + cmd.label}
                data-highlighted={highlight === i}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => activate(items[i])}
                className={rowClass(highlight === i)}
              >
                <Icon size={15} strokeWidth={1.5} className="shrink-0" />
                {cmd.label}
              </button>
            );
          })}
          {groups.map((g, gi) => {
            const def = OBJECTS[g.object];
            const Icon = def.icon;
            return (
              <div key={g.object}>
                <p className="label-mono flex items-center gap-2 px-4 pt-3 pb-1">
                  <Icon size={13} strokeWidth={1.5} />
                  {def.plural}
                </p>
                {g.rows.map((row, ri) => {
                  const idx = groupOffsets[gi] + ri;
                  return (
                    <button
                      key={String(row.id)}
                      data-highlighted={highlight === idx}
                      onMouseEnter={() => setHighlight(idx)}
                      onClick={() => activate(items[idx])}
                      className={rowClass(highlight === idx)}
                    >
                      {recordTitle(def, row)}
                    </button>
                  );
                })}
              </div>
            );
          })}
          {searching && groups.length === 0 && (
            <p className="label-mono px-4 pt-3 pb-1">Searching…</p>
          )}
          {items.length === 0 && !searching && (
            <p className="text-sm text-[var(--text-dim)] text-center px-4 py-6">
              No results for “{query.trim()}”
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
