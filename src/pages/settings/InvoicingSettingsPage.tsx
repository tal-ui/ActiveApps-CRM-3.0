import { useEffect, useState } from "react";
import { Check, Receipt } from "lucide-react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import {
  DEFAULT_VAT_RATE,
  fetchWorkspaceSettings,
  saveWorkspaceSettings,
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

/**
 * Everything needed to issue a legal Israeli tax invoice, in one place: the
 * VAT rate and issuer identity that print on the document, and the credentials
 * for the provider that allocates its legal number.
 */
export default function InvoicingSettingsPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [defaultVatRate, setDefaultVatRate] = useState(String(DEFAULT_VAT_RATE));
  const [issuerLegalName, setIssuerLegalName] = useState("");
  const [issuerTaxId, setIssuerTaxId] = useState("");
  const [issuerAddress, setIssuerAddress] = useState("");
  const [issuerPhone, setIssuerPhone] = useState("");
  const [issuerEmail, setIssuerEmail] = useState("");
  const [issuerBusinessType, setIssuerBusinessType] = useState("osek_murshe");

  // Green Invoice — integrations row key = "green_invoice". Invariant: only
  // id/connected are ever read here; the stored secret is written but never
  // selected by the browser and never rendered.
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
    fetchWorkspaceSettings().then((s) => {
      setDefaultVatRate(String(s.defaultVatRate));
      setIssuerLegalName(s.issuerLegalName);
      setIssuerTaxId(s.issuerTaxId);
      setIssuerAddress(s.issuerAddress);
      setIssuerPhone(s.issuerPhone);
      setIssuerEmail(s.issuerEmail);
      setIssuerBusinessType(s.issuerBusinessType);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    supabase
      .from("integrations")
      .select("id, connected")
      .eq("key", "green_invoice")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setGiRowId(String(data.id));
          setGiConnected(Boolean(data.connected));
        }
      });
  }, []);

  async function save() {
    setError("");
    setBusy(true);
    // parseFloat, not `|| DEFAULT`: a deliberate 0% VAT must survive the save.
    const parsedVat = parseFloat(defaultVatRate);
    const patch = {
      defaultVatRate: Number.isFinite(parsedVat) ? parsedVat : DEFAULT_VAT_RATE,
      issuerLegalName,
      issuerTaxId,
      issuerAddress,
      issuerPhone,
      issuerEmail,
      issuerBusinessType,
    };
    const { error: err, settings } = await saveWorkspaceSettings(patch);
    setBusy(false);
    if (err) {
      setError(
        err.includes("policy") ? "Only admins can change these settings." : err,
      );
      return;
    }
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "workspace_settings",
      entity_id: "default",
      summary: "Updated tax invoicing settings",
      after: settings,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
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
            <Receipt size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
              Tax Invoicing
            </h1>
            <p className="label-mono">VAT, issuer identity & provider</p>
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

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4">
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
          Connecting Green Invoice lets the CRM issue real tax invoices, so each
          one receives a legal document number and an allocation number (מספר
          הקצאה). Create an API key under Settings → Developer Tools in your
          Green Invoice account, then paste the key ID and secret here.
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
        <p className="text-xs text-[var(--text-faint)]">
          Credentials are stored server-side and are never sent back to the
          browser. Test only exchanges them for a token — it issues no document.
        </p>
      </section>

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
