import { useEffect, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Select,
  Spinner,
} from "../../components/ui";

type SettingsJson = Record<string, unknown>;

export default function WorkspaceSettingsPage() {
  const { profile } = useAuth();
  const [rowId, setRowId] = useState<string | null>(null);
  const [fetched, setFetched] = useState<SettingsJson | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  // Edited fields (v1 keys)
  const [workspaceName, setWorkspaceName] = useState("");
  const [pdfFooterText, setPdfFooterText] = useState("");
  const [pdfAccentColor, setPdfAccentColor] = useState("#3CC998");
  const [defaultHourlyRate, setDefaultHourlyRate] = useState("300");
  const [defaultCurrency, setDefaultCurrency] = useState("ILS");

  useEffect(() => {
    supabase
      .from("workspace_settings")
      .select("id, settings")
      .limit(1)
      .maybeSingle()
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        const row = data as { id: string; settings: SettingsJson } | null;
        if (row) {
          setRowId(row.id);
          setFetched(row.settings ?? {});
          const s = row.settings ?? {};
          setWorkspaceName(String(s.workspaceName ?? ""));
          setPdfFooterText(String(s.pdfFooterText ?? ""));
          setPdfAccentColor(String(s.pdfAccentColor ?? "#3CC998"));
          if (s.defaultHourlyRate != null) setDefaultHourlyRate(String(s.defaultHourlyRate));
          if (s.defaultCurrency != null) setDefaultCurrency(String(s.defaultCurrency));
        } else {
          setFetched({});
        }
        setLoading(false);
      });
  }, []);

  async function save() {
    setError("");
    setBusy(true);
    // Read-modify-write merge: unknown keys in the fetched jsonb are preserved
    // by the spread. Benign last-write-wins for a single-admin workspace.
    const next: SettingsJson = {
      ...(fetched ?? {}),
      workspaceName,
      pdfFooterText,
      pdfAccentColor,
      defaultHourlyRate: parseFloat(defaultHourlyRate) || 300,
      defaultCurrency,
    };
    let err: string | null = null;
    if (rowId) {
      const { error: e } = await supabase
        .from("workspace_settings")
        .update({ settings: next, updated_at: Date.now() })
        .eq("id", rowId);
      err = e?.message ?? null;
    } else {
      const { error: e } = await supabase
        .from("workspace_settings")
        .insert({ id: "default", settings: next, updated_at: Date.now() });
      err = e?.message ?? null;
      if (!e) setRowId("default");
    }
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "workspace_settings",
      entity_id: rowId ?? "default",
      summary: "Updated workspace settings",
      before: fetched,
      after: next,
    });
    setFetched(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  if (loading) return <Spinner />;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Settings2 size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Workspace
            </h1>
            <p className="label-mono">branding & defaults</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-[var(--mint)]">
              <Check size={15} strokeWidth={2} />
              Saved
            </span>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4">
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            PDF Branding
          </h3>
          <div>
            <FieldLabel>Workspace Name</FieldLabel>
            <Input
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              placeholder="ActiveApps"
            />
          </div>
          <div>
            <FieldLabel>PDF Footer Text</FieldLabel>
            <Input
              value={pdfFooterText}
              onChange={(e) => setPdfFooterText(e.target.value)}
              placeholder="ActiveApps — Professional Services"
            />
          </div>
          <div>
            <FieldLabel>PDF Accent Color</FieldLabel>
            <div className="flex items-center gap-3">
              <input
                type="color"
                value={pdfAccentColor}
                onChange={(e) => setPdfAccentColor(e.target.value)}
                className="h-10 w-14 rounded-[var(--radius-md)] border border-[rgba(255,255,255,0.12)] bg-[var(--section-darker)] cursor-pointer"
                aria-label="PDF accent color"
              />
              <span className="font-[var(--font-mono)] text-sm text-[var(--text-mid)]">
                {pdfAccentColor}
              </span>
            </div>
          </div>
          <p className="text-xs text-[var(--text-faint)]">
            Other stored branding keys (signature labels, footer options) are
            preserved on save.
          </p>
        </section>

        <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4">
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Defaults
          </h3>
          <div>
            <FieldLabel>Default Hourly Rate</FieldLabel>
            <Input
              type="number"
              step="any"
              min="0"
              value={defaultHourlyRate}
              onChange={(e) => setDefaultHourlyRate(e.target.value)}
            />
            <p className="text-xs text-[var(--text-faint)] mt-1.5">
              New projects currently default to ₪300/h at the database level;
              this stored value is for upcoming consumers.
            </p>
          </div>
          <div>
            <FieldLabel>Default Currency</FieldLabel>
            <Select
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value)}
            >
              <option value="ILS">ILS — Israeli New Shekel</option>
              <option value="USD">USD — US Dollar</option>
              <option value="EUR">EUR — Euro</option>
              <option value="GBP">GBP — British Pound</option>
            </Select>
          </div>
        </section>
      </div>
    </div>
  );
}
