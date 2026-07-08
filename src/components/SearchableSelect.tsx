import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, X } from "lucide-react";

export interface SearchableOption {
  value: string;
  label: string;
}

// Cap the rendered list — filtering is instant over the in-memory options,
// but rendering 1000 rows in the panel is wasteful.
const MAX_RENDERED = 100;

/**
 * Combobox for relationship (lookup) fields: a select-styled trigger that
 * opens a panel with type-to-search over the provided options. Filtering is
 * client-side (options come from the cached lookup lists). Keyboard: arrows
 * to highlight, Enter to pick, Escape to close.
 */
export default function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "— Select —",
  disabled,
  allowClear = true,
  className = "",
}: {
  options: SearchableOption[];
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);
  const rendered = matches.slice(0, MAX_RENDERED);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(v: string) {
    onChange(v);
    close();
  }

  // Close on outside interaction (same document-listener pattern as FilterBar)
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  // Keep the highlighted row in view while arrowing through the list
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${highlight}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, rendered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (rendered[highlight]) pick(rendered[highlight].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full bg-[var(--section-darker)] border border-[rgba(255,255,255,0.12)] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm text-left cursor-pointer transition-all duration-300 focus:outline-none focus:border-[var(--mint)] focus:ring-2 focus:ring-[var(--mint-glow)] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
      >
        <span
          className={`flex-1 truncate ${
            selected ? "text-[var(--foreground)]" : "text-[var(--text-faint)]"
          }`}
        >
          {selected ? selected.label : placeholder}
        </span>
        {allowClear && selected && !disabled && (
          <span
            role="button"
            aria-label="Clear selection"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
              close();
            }}
            className="shrink-0 text-[var(--text-faint)] hover:text-[var(--foreground)] transition-colors"
          >
            <X size={14} strokeWidth={1.5} />
          </span>
        )}
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`shrink-0 text-[var(--text-faint)] transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-[var(--card)] border border-[rgba(255,255,255,0.1)] rounded-[var(--radius-md)] shadow-[0_12px_40px_rgba(0,0,0,0.45)] overflow-hidden">
          <div className="relative border-b border-[rgba(255,255,255,0.06)]">
            <Search
              size={14}
              strokeWidth={1.5}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type to search…"
              className="w-full bg-transparent text-sm text-[var(--foreground)] placeholder:text-[var(--text-faint)] pl-9 pr-3.5 py-2.5 focus:outline-none"
            />
          </div>
          <div ref={listRef} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {rendered.length === 0 ? (
              <p className="px-3.5 py-2.5 text-sm text-[var(--text-faint)]">
                No matches.
              </p>
            ) : (
              rendered.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  data-idx={i}
                  role="option"
                  aria-selected={o.value === value}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pick(o.value)}
                  className={`block w-full text-left px-3.5 py-2 text-sm cursor-pointer transition-colors truncate ${
                    i === highlight
                      ? "bg-[var(--navy-surface)] text-[var(--foreground)]"
                      : "text-[var(--text-mid)]"
                  } ${o.value === value ? "!text-[var(--mint)]" : ""}`}
                >
                  {o.label}
                </button>
              ))
            )}
            {matches.length > MAX_RENDERED && (
              <p className="px-3.5 py-2 text-xs text-[var(--text-faint)]">
                {matches.length - MAX_RENDERED} more — keep typing to narrow down.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
