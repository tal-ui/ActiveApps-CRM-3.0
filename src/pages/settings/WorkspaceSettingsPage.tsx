import { useEffect, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import {
  DEFAULT_VAT_RATE,
  invalidateWorkspaceSettings,
} from "../../lib/workspaceSettings";
import {
  Button,
  ConfirmModal,
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

  // Israeli invoicing — issuer identity and the VAT rate applied to new invoices
  const [defaultVatRate, setDefaultVatRate] = useState(String(DEFAULT_VAT_RATE));
  const [issuerLegalName, setIssuerLegalName] = useState("");
  const [issuerTaxId, setIssuerTaxId] = useState("");
  const [issuerAddress, setIssuerAddress] = useState("");
  const [issuerPhone, setIssuerPhone] = useState("");
  const [issuerEmail, setIssuerEmail] = useState("");
  const [issuerBusinessType, setIssuerBusinessType] = useState("osek_murshe");

  // AI Assistant (Claude) — integrations row key = "anthropic".
  // Invariant: only id/connected are ever read here — the stored API key is
  // never selected by the browser and never rendered (masked display only).
  const [aiRowId, setAiRowId] = useState<string | null>(null);
  const [aiConnected, setAiConnected] = useState(false);
  const [aiKeyInput, setAiKeyInput] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");
  const [aiNote, setAiNote] = useState("");
  const [aiSavedFlash, setAiSavedFlash] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);

  // Green Invoice — integrations row key = "green_invoice". Same invariant as
  // the Anthropic key above: the secret is written but never read back.
  const [giRowId, setGiRowId] = useState<string | null>(null);
  const [giConnected, setGiConnected] = useState(false);
  const [giKeyId, setGiKeyId] = useState("");
  const [giSecret, setGiSecret] = useState("");
  const [giBusy, setGiBusy] = useState(false);
  const [giError, setGiError] = useState("");
  const [giNote, setGiNote] = useState("");
  const [giSavedFlash, setGiSavedFlash] = useState(false);
  const [showGiDisconnect, setShowGiDisconnect] = useState(false);

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
          if (s.defaultVatRate != null) setDefaultVatRate(String(s.defaultVatRate));
          setIssuerLegalName(String(s.issuerLegalName ?? ""));
          setIssuerTaxId(String(s.issuerTaxId ?? ""));
          setIssuerAddress(String(s.issuerAddress ?? ""));
          setIssuerPhone(String(s.issuerPhone ?? ""));
          setIssuerEmail(String(s.issuerEmail ?? ""));
          if (s.issuerBusinessType != null)
            setIssuerBusinessType(String(s.issuerBusinessType));
        } else {
          setFetched({});
        }
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    supabase
      .from("integrations")
      .select("id, key, connected")
      .in("key", ["anthropic", "green_invoice"])
      .then(({ data }) => {
        for (const row of (data ?? []) as {
          id: string;
          key: string;
          connected: boolean;
        }[]) {
          if (row.key === "anthropic") {
            setAiRowId(String(row.id));
            setAiConnected(Boolean(row.connected));
          } else if (row.key === "green_invoice") {
            setGiRowId(String(row.id));
            setGiConnected(Boolean(row.connected));
          }
        }
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
      // parseFloat, not `|| DEFAULT`: a deliberate 0% VAT must survive the save.
      defaultVatRate: Number.isFinite(parseFloat(defaultVatRate))
        ? parseFloat(defaultVatRate)
        : DEFAULT_VAT_RATE,
      issuerLegalName,
      issuerTaxId,
      issuerAddress,
      issuerPhone,
      issuerEmail,
      issuerBusinessType,
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
    // Invoicing and PDF code read these through a module-level cache.
    invalidateWorkspaceSettings();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function saveAiKey() {
    // Never write when the input is empty — an existing key must not be
    // clobbered with a blank value (button is also disabled in that state).
    const value = aiKeyInput.trim();
    if (!value) return;
    setAiError("");
    setAiNote("");
    setAiBusy(true);
    let err: string | null = null;
    let idForAudit = aiRowId;
    if (aiRowId) {
      const { error: e } = await supabase
        .from("integrations")
        .update({
          connected: true,
          config: { api_key: value },
          updated_at: Date.now(),
        })
        .eq("id", aiRowId);
      err = e?.message ?? null;
    } else {
      const { data, error: e } = await supabase
        .from("integrations")
        .insert({
          key: "anthropic",
          name: "Anthropic",
          category: "ai",
          connected: true,
          config: { api_key: value },
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .select("id")
        .single();
      err = e?.message ?? null;
      if (!e && data) {
        idForAudit = String((data as { id: string }).id);
        setAiRowId(idForAudit);
      }
    }
    setAiBusy(false);
    if (err) {
      setAiError(
        err.includes("policy")
          ? "Only admins can change integration settings."
          : err,
      );
      return;
    }
    setAiConnected(true);
    setAiKeyInput("");
    setAiSavedFlash(true);
    setTimeout(() => setAiSavedFlash(false), 2000);
    // Audit never includes the key — summary only, no before/after payloads.
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "integration",
      entity_id: idForAudit,
      summary: "Anthropic API key updated",
    });
  }

  async function testAi() {
    setAiBusy(true);
    setAiError("");
    setAiNote("");
    const { error: e } = await supabase.functions.invoke("ai-assist", {
      body: { test: true },
    });
    setAiBusy(false);
    if (!e) {
      setAiNote("Claude responded — AI assistant is working.");
      return;
    }
    if (e instanceof FunctionsHttpError) {
      let body: { error?: string; detail?: string } | null = null;
      try {
        body = (await e.context.json()) as { error?: string; detail?: string };
      } catch {
        /* error body wasn't JSON */
      }
      if (body?.error === "not_configured") {
        setAiNote("Not configured yet — save an API key first.");
        return;
      }
      if (body?.error === "invalid_key") {
        setAiNote(
          "The Anthropic API key was rejected — check it and save again.",
        );
        return;
      }
      setAiError(`Test failed: ${body?.detail ?? e.message}`);
      return;
    }
    setAiError(`Test failed: ${String((e as Error).message ?? e)}`);
  }

  async function disconnectAi() {
    if (!aiRowId) {
      setShowDisconnect(false);
      return;
    }
    setAiError("");
    setAiNote("");
    setAiBusy(true);
    const { error: e } = await supabase
      .from("integrations")
      .update({ connected: false, config: {}, updated_at: Date.now() })
      .eq("id", aiRowId);
    setAiBusy(false);
    setShowDisconnect(false);
    if (e) {
      setAiError(
        e.message.includes("policy")
          ? "Only admins can change integration settings."
          : e.message,
      );
      return;
    }
    setAiConnected(false);
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "integration",
      entity_id: aiRowId,
      summary: "Anthropic disconnected",
    });
  }

  async function saveGiKey() {
    const keyId = giKeyId.trim();
    const secret = giSecret.trim();
    // Both halves are required — a partial credential would fail at the
    // provider with a confusing error rather than here.
    if (!keyId || !secret) return;
    setGiError("");
    setGiNote("");
    setGiBusy(true);
    let err: string | null = null;
    let idForAudit = giRowId;
    if (giRowId) {
      const { error: e } = await supabase
        .from("integrations")
        .update({
          connected: true,
          config: { api_key_id: keyId, api_secret: secret },
          updated_at: Date.now(),
        })
        .eq("id", giRowId);
      err = e?.message ?? null;
    } else {
      const { data, error: e } = await supabase
        .from("integrations")
        .insert({
          key: "green_invoice",
          name: "Green Invoice",
          category: "finance",
          connected: true,
          config: { api_key_id: keyId, api_secret: secret },
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .select("id")
        .single();
      err = e?.message ?? null;
      if (!e && data) {
        idForAudit = String((data as { id: string }).id);
        setGiRowId(idForAudit);
      }
    }
    setGiBusy(false);
    if (err) {
      setGiError(
        err.includes("policy")
          ? "Only admins can change integration settings."
          : err,
      );
      return;
    }
    setGiConnected(true);
    setGiKeyId("");
    setGiSecret("");
    setGiSavedFlash(true);
    setTimeout(() => setGiSavedFlash(false), 2000);
    // Summary only — credentials never enter the audit payload.
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "integration",
      entity_id: idForAudit,
      summary: "Green Invoice credentials updated",
    });
  }

  async function testGi() {
    setGiBusy(true);
    setGiError("");
    setGiNote("");
    const { error: e } = await supabase.functions.invoke("issue-invoice", {
      body: { test: true },
    });
    setGiBusy(false);
    if (!e) {
      setGiNote("Green Invoice accepted the credentials.");
      return;
    }
    if (e instanceof FunctionsHttpError) {
      let body: { error?: string; detail?: string } | null = null;
      try {
        body = (await e.context.json()) as { error?: string; detail?: string };
      } catch {
        /* error body wasn't JSON */
      }
      if (body?.error === "not_configured") {
        setGiNote("Not configured yet — save an API key and secret first.");
        return;
      }
      if (body?.error === "invalid_key") {
        setGiNote(
          "Green Invoice rejected these credentials — check the key ID and secret.",
        );
        return;
      }
      setGiError(`Test failed: ${body?.detail ?? e.message}`);
      return;
    }
    setGiError(`Test failed: ${String((e as Error).message ?? e)}`);
  }

  async function disconnectGi() {
    if (!giRowId) {
      setShowGiDisconnect(false);
      return;
    }
    setGiError("");
    setGiNote("");
    setGiBusy(true);
    const { error: e } = await supabase
      .from("integrations")
      .update({ connected: false, config: {}, updated_at: Date.now() })
      .eq("id", giRowId);
    setGiBusy(false);
    setShowGiDisconnect(false);
    if (e) {
      setGiError(
        e.message.includes("policy")
          ? "Only admins can change integration settings."
          : e.message,
      );
      return;
    }
    setGiConnected(false);
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "integration",
      entity_id: giRowId,
      summary: "Green Invoice disconnected",
    });
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

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4 mt-6">
        <div>
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Invoicing (Israel)
          </h3>
          <p className="text-xs text-[var(--text-faint)] mt-1">
            These details appear on every invoice PDF and are sent to the tax
            invoicing provider when a document is issued.
          </p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <FieldLabel>Default VAT Rate (%)</FieldLabel>
            <Input
              type="number"
              step="any"
              min="0"
              value={defaultVatRate}
              onChange={(e) => setDefaultVatRate(e.target.value)}
            />
            <p className="text-xs text-[var(--text-faint)] mt-1.5">
              Applied to new invoices unless the account is marked VAT exempt.
            </p>
          </div>
          <div>
            <FieldLabel>Business Type</FieldLabel>
            <Select
              value={issuerBusinessType}
              onChange={(e) => setIssuerBusinessType(e.target.value)}
            >
              <option value="osek_murshe">Osek Murshe (עוסק מורשה)</option>
              <option value="company">Company / Ltd (חברה בע״מ)</option>
              <option value="osek_patur">Osek Patur (עוסק פטור)</option>
            </Select>
            <p className="text-xs text-[var(--text-faint)] mt-1.5">
              An Osek Patur issues receipts, not tax invoices — this decides
              which document type is requested.
            </p>
          </div>
          <div>
            <FieldLabel>Legal Business Name</FieldLabel>
            <Input
              value={issuerLegalName}
              onChange={(e) => setIssuerLegalName(e.target.value)}
              placeholder="ActiveApps Ltd"
            />
          </div>
          <div>
            <FieldLabel>Tax ID (ח.פ. / ע.מ.)</FieldLabel>
            <Input
              value={issuerTaxId}
              onChange={(e) => setIssuerTaxId(e.target.value)}
              placeholder="515123456"
            />
          </div>
          <div>
            <FieldLabel>Business Address</FieldLabel>
            <Input
              value={issuerAddress}
              onChange={(e) => setIssuerAddress(e.target.value)}
              placeholder="12 Rothschild Blvd, Tel Aviv"
            />
          </div>
          <div>
            <FieldLabel>Billing Phone</FieldLabel>
            <Input
              value={issuerPhone}
              onChange={(e) => setIssuerPhone(e.target.value)}
              placeholder="+972-3-000-0000"
            />
          </div>
          <div>
            <FieldLabel>Billing Email</FieldLabel>
            <Input
              type="email"
              value={issuerEmail}
              onChange={(e) => setIssuerEmail(e.target.value)}
              placeholder="billing@activeapps.io"
            />
          </div>
        </div>
        <p className="text-xs text-[#D9B96A]">
          Enter these in Latin characters: the PDF engine's built-in fonts have
          no Hebrew glyphs, so Hebrew text here will not render in the document.
        </p>
      </section>

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4 mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Green Invoice (חשבונית ירוקה)
          </h3>
          <p className="label-mono flex items-center gap-2">
            {giConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] animate-pulse" />
                Connected
              </>
            ) : (
              <span className="text-[var(--text-faint)]">Not configured</span>
            )}
          </p>
        </div>
        <p className="text-xs text-[var(--text-faint)]">
          Connecting Green Invoice lets the CRM issue real tax invoices, so
          each one receives a legal document number and an allocation number
          (מספר הקצאה). Create an API key under Settings → Developer Tools in
          your Green Invoice account.
        </p>
        {giConnected && (
          <p className="text-sm text-[var(--text-mid)]">
            API secret: <span className="font-[var(--font-mono)]">••••••••</span>
          </p>
        )}
        {giError && <ErrorNote message={giError} />}
        {giNote && (
          <div className="bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--mint)]">
            {giNote}
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>API Key ID</FieldLabel>
            <Input
              autoComplete="off"
              placeholder="key id"
              value={giKeyId}
              onChange={(e) => setGiKeyId(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>API Secret</FieldLabel>
            <Input
              type="password"
              autoComplete="off"
              placeholder="secret"
              value={giSecret}
              onChange={(e) => setGiSecret(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={saveGiKey}
            disabled={giBusy || !giKeyId.trim() || !giSecret.trim()}
          >
            {giSavedFlash ? (
              <>
                <Check size={15} strokeWidth={2} />
                Saved
              </>
            ) : giBusy ? (
              "Working…"
            ) : (
              "Save Credentials"
            )}
          </Button>
          <Button
            variant="subtle"
            onClick={testGi}
            disabled={giBusy || !giConnected}
          >
            Test
          </Button>
          {giConnected && (
            <Button
              variant="subtle"
              onClick={() => setShowGiDisconnect(true)}
              disabled={giBusy}
            >
              Disconnect
            </Button>
          )}
        </div>
      </section>

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4 mt-6">
        <div className="flex items-center justify-between">
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            AI Assistant (Claude)
          </h3>
          <p className="label-mono flex items-center gap-2">
            {aiConnected ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] animate-pulse" />
                Connected
              </>
            ) : (
              <span className="text-[var(--text-faint)]">Not configured</span>
            )}
          </p>
        </div>
        {aiConnected && (
          <p className="text-sm text-[var(--text-mid)]">
            API key: <span className="font-[var(--font-mono)]">••••••••</span>
          </p>
        )}
        {aiError && <ErrorNote message={aiError} />}
        {aiNote && (
          <div className="bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--mint)]">
            {aiNote}
          </div>
        )}
        <div>
          <FieldLabel>Anthropic API Key</FieldLabel>
          <Input
            type="password"
            autoComplete="off"
            placeholder="sk-ant-…"
            value={aiKeyInput}
            onChange={(e) => setAiKeyInput(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={saveAiKey} disabled={aiBusy || !aiKeyInput.trim()}>
            {aiSavedFlash ? (
              <>
                <Check size={15} strokeWidth={2} />
                Saved
              </>
            ) : aiBusy ? (
              "Working…"
            ) : (
              "Save Key"
            )}
          </Button>
          <Button
            variant="subtle"
            onClick={testAi}
            disabled={aiBusy || !aiConnected}
          >
            Test
          </Button>
          {aiConnected && (
            <Button
              variant="subtle"
              onClick={() => setShowDisconnect(true)}
              disabled={aiBusy}
            >
              Disconnect
            </Button>
          )}
        </div>
      </section>
      <p className="text-xs text-[var(--text-faint)] mt-3">
        When an insight is requested, that record's CRM data (and closely
        related records) is sent to Anthropic's API. Nothing is sent otherwise.
      </p>
      {showDisconnect && (
        <ConfirmModal
          title="Disconnect AI Assistant"
          confirmLabel="Disconnect"
          destructive
          busy={aiBusy}
          onConfirm={disconnectAi}
          onClose={() => setShowDisconnect(false)}
        >
          <p>
            This removes the stored Anthropic API key. AI insights will stop
            working until a new key is added.
          </p>
        </ConfirmModal>
      )}
      {showGiDisconnect && (
        <ConfirmModal
          title="Disconnect Green Invoice"
          confirmLabel="Disconnect"
          destructive
          busy={giBusy}
          onConfirm={disconnectGi}
          onClose={() => setShowGiDisconnect(false)}
        >
          <p>
            This removes the stored Green Invoice credentials. Invoices already
            issued keep their document numbers, but no new tax invoices can be
            issued until credentials are added again.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
