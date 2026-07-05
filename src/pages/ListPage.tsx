import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, Download, Kanban, Plus, Search, Wand2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { OBJECTS } from "../lib/objects";
import { useLookupMaps } from "../lib/lookups";
import { downloadCsv } from "../lib/csv";
import { dateToMs, msToDateInput } from "../lib/format";
import { Button, EmptyState, Input, Spinner } from "../components/ui";
import DataTable from "../components/DataTable";
import RecordForm from "../components/RecordForm";
import InvoiceGenerator from "../components/InvoiceGenerator";
import FilterBar, { type ListFilter } from "../components/FilterBar";
import SavedViewsBar from "../components/SavedViewsBar";

const PAGE_SIZE = 25;

export default function ListPage() {
  const { object = "" } = useParams();
  const def = OBJECTS[object];
  const navigate = useNavigate();

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<ListFilter[]>([]);
  const [sortField, setSortField] = useState("updated_at");
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [reload, setReload] = useState(0);

  const columns = useMemo(
    () => (def ? def.fields.filter((f) => f.showInList).slice(0, 7) : []),
    [def],
  );
  const lookupObjects = useMemo(
    () =>
      Array.from(
        new Set(
          columns
            .filter((c) => c.type === "lookup" && c.lookup)
            .map((c) => c.lookup as string),
        ),
      ),
    [columns],
  );
  const lookupMaps = useLookupMaps(lookupObjects);

  useEffect(() => {
    setFilters([]);
  }, [object]);

  useEffect(() => {
    if (!def) return;
    setLoading(true);
    setPage(0);
    supabase
      .from(object)
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        setRows((data ?? []) as Record<string, unknown>[]);
        setLoading(false);
      });
  }, [object, def, reload]);

  const filtered = useMemo(() => {
    let out = rows;
    for (const f of filters) {
      const fieldDef = def?.fields.find((fd) => fd.name === f.field);
      out = out.filter((r) => {
        if (f.op === "eq") {
          if (fieldDef?.type === "boolean") {
            return Boolean(r[f.field]) === (f.value === "true");
          }
          return String(r[f.field] ?? "") === (f.value ?? "");
        }
        const v = Number(r[f.field]);
        const fromMs = f.from ? dateToMs(f.from) : null;
        const toMs = f.to ? dateToMs(f.to) : null;
        if (fromMs != null && !(v >= fromMs)) return false;
        if (toMs != null && !(v <= toMs + 86399999)) return false;
        return true;
      });
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      out = out.filter((r) =>
        def.searchFields.some((f) =>
          String(r[f] ?? "").toLowerCase().includes(q),
        ),
      );
    }
    out = [...out].sort((a, b) => {
      const av = a[sortField];
      const bv = b[sortField];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortAsc ? cmp : -cmp;
    });
    return out;
  }, [rows, search, filters, sortField, sortAsc, def]);

  if (!def) {
    return <EmptyState message={`Unknown object: ${object}`} />;
  }

  const Icon = def.icon;
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Icon size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              {def.plural}
            </h1>
            <p className="label-mono">
              {filtered.length} record{filtered.length === 1 ? "" : "s"}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-auto">
            <Search
              size={16}
              strokeWidth={1.5}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]"
            />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
              placeholder={`Search ${def.plural.toLowerCase()}…`}
              className="pl-9 w-full"
            />
          </div>
          <FilterBar
            def={def}
            filters={filters}
            onChange={(f) => {
              setFilters(f);
              setPage(0);
            }}
          />
          {object === "tasks" && (
            <Button variant="ghost" onClick={() => navigate("/tasks/board")}>
              <Kanban size={15} strokeWidth={1.5} />
              Board
            </Button>
          )}
          {object === "invoices" && (
            <Button variant="ghost" onClick={() => setShowGenerator(true)}>
              <Wand2 size={15} strokeWidth={1.5} />
              From Time Entries
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={filtered.length === 0}
            onClick={() =>
              downloadCsv(
                `${object}-${msToDateInput(Date.now())}.csv`,
                columns,
                filtered,
                lookupMaps,
              )
            }
          >
            <Download size={15} strokeWidth={1.5} />
            Export CSV
          </Button>
          <Button onClick={() => setShowForm(true)}>
            <Plus size={16} strokeWidth={2} />
            New {def.singular}
          </Button>
        </div>
      </div>

      <SavedViewsBar
        key={object}
        object={object}
        filters={filters}
        sortField={sortField}
        sortAsc={sortAsc}
        onApply={(c) => {
          setFilters(c.filters);
          setSortField(c.sortField);
          setSortAsc(c.sortAsc);
          setPage(0);
        }}
        onClear={() => {
          setFilters([]);
          setPage(0);
        }}
      />

      {/* Table */}
      {loading ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <EmptyState
          message={
            search
              ? "No records match your search."
              : filters.length > 0
                ? "No records match your filters."
                : `No ${def.plural.toLowerCase()} yet. Create the first one.`
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={pageRows}
            lookupMaps={lookupMaps}
            onRowClick={(row) => navigate(`/${object}/${row.id}`)}
            sortField={sortField}
            sortAsc={sortAsc}
            onSort={(f) => {
              if (sortField === f) setSortAsc(!sortAsc);
              else {
                setSortField(f);
                setSortAsc(true);
              }
            }}
          />
          {pageCount > 1 && (
            <div className="flex flex-wrap items-center justify-end gap-3 mt-4">
              <span className="label-mono">
                Page {page + 1} / {pageCount}
              </span>
              <Button
                variant="subtle"
                disabled={page === 0}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft size={16} strokeWidth={1.5} />
              </Button>
              <Button
                variant="subtle"
                disabled={page >= pageCount - 1}
                onClick={() => setPage(page + 1)}
              >
                <ChevronRight size={16} strokeWidth={1.5} />
              </Button>
            </div>
          )}
        </>
      )}

      {showForm && (
        <RecordForm
          object={object}
          record={null}
          onClose={() => setShowForm(false)}
          onSaved={(id) => {
            setShowForm(false);
            setReload((r) => r + 1);
            navigate(`/${object}/${id}`);
          }}
        />
      )}
      {showGenerator && (
        <InvoiceGenerator onClose={() => setShowGenerator(false)} />
      )}
    </div>
  );
}
