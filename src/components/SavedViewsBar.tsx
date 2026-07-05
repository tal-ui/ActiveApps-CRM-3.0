import { useEffect, useRef, useState } from "react";
import { Plus, Star, X } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import {
  Button,
  ConfirmModal,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Toggle,
} from "./ui";
import type { ListFilter } from "./FilterBar";

export interface ViewConfig {
  filters: ListFilter[];
  sortField: string;
  sortAsc: boolean;
}

interface SavedView {
  id: string;
  object_name: string;
  name: string;
  config: Partial<ViewConfig> | null;
  owner_id: string;
  is_default: boolean;
  created_at: number;
  updated_at: number;
}

function normalizeConfig(config: Partial<ViewConfig> | null | undefined): ViewConfig {
  const filters = config?.filters;
  return {
    filters: Array.isArray(filters) ? filters : [],
    sortField: typeof config?.sortField === "string" ? config.sortField : "updated_at",
    sortAsc: Boolean(config?.sortAsc),
  };
}

const chipBase =
  "shrink-0 inline-flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs cursor-pointer transition-colors";
const chipActive =
  "bg-[rgba(60,201,152,0.08)] border-[rgba(60,201,152,0.25)] text-[var(--mint)] font-medium";
const chipIdle =
  "bg-transparent border-[rgba(255,255,255,0.12)] text-[var(--text-mid)] hover:border-[rgba(60,201,152,0.25)] hover:text-[var(--foreground)]";

export default function SavedViewsBar({
  object,
  filters,
  sortField,
  sortAsc,
  onApply,
  onClear,
}: {
  object: string;
  filters: ListFilter[];
  sortField: string;
  sortAsc: boolean;
  onApply: (config: ViewConfig) => void;
  onClear: () => void;
}) {
  const { profile } = useAuth();
  const [views, setViews] = useState<SavedView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SavedView | null>(null);
  const [reload, setReload] = useState(0);
  // Auto-apply the default view only once per object, so "All" stays clearable.
  const appliedDefaultFor = useRef("");

  useEffect(() => {
    setActiveId(null);
  }, [object]);

  useEffect(() => {
    if (!profile) return;
    let mounted = true;
    supabase
      .from("saved_views")
      .select("*")
      .eq("owner_id", profile.id)
      .eq("object_name", object)
      .order("name")
      .then(({ data }) => {
        if (!mounted) return;
        const list = (data ?? []) as SavedView[];
        setViews(list);
        if (appliedDefaultFor.current !== object) {
          appliedDefaultFor.current = object;
          const defaultView = list.find((v) => v.is_default);
          if (defaultView) {
            setActiveId(defaultView.id);
            onApply(normalizeConfig(defaultView.config));
          }
        }
      });
    return () => {
      mounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object, profile, reload]);

  const activeView = views.find((v) => v.id === activeId) ?? null;
  const currentConfig: ViewConfig = { filters, sortField, sortAsc };
  const dirty =
    !!activeView &&
    JSON.stringify(currentConfig) !== JSON.stringify(normalizeConfig(activeView.config));

  async function saveView() {
    if (!profile || !name.trim()) return;
    setSaveError("");
    setBusy(true);
    if (makeDefault) {
      await supabase
        .from("saved_views")
        .update({ is_default: false })
        .eq("owner_id", profile.id)
        .eq("object_name", object);
    }
    const { data, error } = await supabase
      .from("saved_views")
      .insert({
        object_name: object,
        name: name.trim(),
        config: currentConfig,
        owner_id: profile.id,
        is_default: makeDefault,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
      .select()
      .single();
    setBusy(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    setActiveId((data as SavedView).id);
    setShowSave(false);
    setName("");
    setMakeDefault(false);
    setReload((r) => r + 1);
  }

  async function updateView() {
    if (!activeView) return;
    setBusy(true);
    await supabase
      .from("saved_views")
      .update({ config: currentConfig, updated_at: Date.now() })
      .eq("id", activeView.id);
    setBusy(false);
    setReload((r) => r + 1);
  }

  async function deleteView() {
    if (!deleteTarget) return;
    setBusy(true);
    await supabase.from("saved_views").delete().eq("id", deleteTarget.id);
    setBusy(false);
    if (activeId === deleteTarget.id) {
      setActiveId(null);
      onClear();
    }
    setDeleteTarget(null);
    setReload((r) => r + 1);
  }

  if (!profile) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <div className="flex items-center gap-2 overflow-x-auto max-w-full py-0.5">
        <button
          onClick={() => {
            setActiveId(null);
            onClear();
          }}
          className={`${chipBase} ${activeId === null ? chipActive : chipIdle}`}
        >
          All
        </button>
        {views.map((v) => (
          <span
            key={v.id}
            onClick={() => {
              setActiveId(v.id);
              onApply(normalizeConfig(v.config));
            }}
            className={`group ${chipBase} ${activeId === v.id ? chipActive : chipIdle}`}
          >
            {v.is_default && (
              <Star size={11} strokeWidth={1.5} fill="currentColor" className="shrink-0" />
            )}
            <span className="whitespace-nowrap">{v.name}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setDeleteTarget(v);
              }}
              className={`text-[var(--text-dim)] hover:text-[#F2697A] cursor-pointer transition-opacity shrink-0 ${
                activeId === v.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
              aria-label={`Delete view ${v.name}`}
            >
              <X size={12} strokeWidth={1.5} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {dirty && (
          <Button variant="ghost" onClick={updateView} disabled={busy}>
            Update view
          </Button>
        )}
        <Button variant="ghost" onClick={() => setShowSave(true)}>
          <Plus size={15} strokeWidth={1.5} />
          Save view
        </Button>
      </div>

      {showSave && (
        <Modal title="Save view" onClose={() => setShowSave(false)}>
          <div className="space-y-4">
            <div>
              <FieldLabel required>Name</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My open items"
                autoFocus
              />
            </div>
            <Toggle checked={makeDefault} onChange={setMakeDefault} label="Make default" />
            {saveError && <ErrorNote message={saveError} />}
            <div className="flex justify-end gap-3">
              <Button variant="subtle" onClick={() => setShowSave(false)}>
                Cancel
              </Button>
              <Button onClick={saveView} disabled={busy || !name.trim()}>
                {busy ? "Saving…" : "Save view"}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmModal
          title="Delete view"
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={deleteView}
          onClose={() => setDeleteTarget(null)}
        >
          <p>
            Delete the saved view "{deleteTarget.name}"? This can't be undone.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
