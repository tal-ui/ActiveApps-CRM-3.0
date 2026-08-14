import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { DEFAULT_CURRENCY } from "./format";
import { DEFAULT_EMAIL_BODY, DEFAULT_EMAIL_SUBJECT } from "./emailTemplateText";

/**
 * The workspace_settings row is a single jsonb blob edited from more than one
 * screen (Settings → Workspace for branding and defaults, Settings → Tax
 * Invoicing for VAT and issuer identity). This module gives the rest of the
 * app a typed, cached read of the keys it cares about, plus the one safe way
 * to write them, so consumers never have to know the storage shape.
 *
 * Unknown keys are deliberately not modelled here — saveWorkspaceSettings
 * preserves whatever else is in the row.
 */
export interface WorkspaceSettings {
  workspaceName: string;
  pdfFooterText: string;
  pdfAccentColor: string;
  defaultHourlyRate: number;
  defaultCurrency: string;
  /** Israeli VAT, percent. 18% since January 2025. */
  defaultVatRate: number;
  issuerLegalName: string;
  /** ח.פ. (company) or ע.מ. (sole trader) */
  issuerTaxId: string;
  issuerAddress: string;
  issuerPhone: string;
  issuerEmail: string;
  issuerBusinessType: "osek_murshe" | "company" | "osek_patur";
  /* Client email — who the monthly invoice email comes from and what it says.
     Deliberately separate from the issuer block: the issuer is the legal
     entity ("Tech Rider and Success Ltd", office@…), the sender is the person
     the client actually corresponds with. */
  emailSenderName: string;
  emailSenderPhone: string;
  emailSenderEmail: string;
  /** The DKIM selector in use, once known. Configuration, not a verdict. */
  emailDkimSelector: string;
  /** Where DMARC aggregate reports should go. An input to the record we generate. */
  emailDmarcRua: string;
  emailSubjectTemplate: string;
  /** Includes the sign-off. One field, not body + signature: two would need a
   *  join rule nobody remembers, for six lines of text. */
  emailBodyTemplate: string;
}

export const DEFAULT_VAT_RATE = 18;

export const EMPTY_SETTINGS: WorkspaceSettings = {
  workspaceName: "",
  pdfFooterText: "",
  pdfAccentColor: "#3CC998",
  defaultHourlyRate: 300,
  defaultCurrency: DEFAULT_CURRENCY,
  defaultVatRate: DEFAULT_VAT_RATE,
  issuerLegalName: "",
  issuerTaxId: "",
  issuerAddress: "",
  issuerPhone: "",
  issuerEmail: "",
  issuerBusinessType: "osek_murshe",
  emailSenderName: "",
  emailSenderPhone: "",
  emailSenderEmail: "",
  emailDkimSelector: "",
  emailDmarcRua: "",
  emailSubjectTemplate: DEFAULT_EMAIL_SUBJECT,
  emailBodyTemplate: DEFAULT_EMAIL_BODY,
};

function coerce(raw: Record<string, unknown>): WorkspaceSettings {
  const num = (v: unknown, fallback: number) => {
    const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
    return Number.isFinite(n) ? n : fallback;
  };
  const str = (v: unknown, fallback = "") => (v == null ? fallback : String(v));
  const businessType = str(raw.issuerBusinessType, "osek_murshe");
  return {
    workspaceName: str(raw.workspaceName),
    pdfFooterText: str(raw.pdfFooterText),
    pdfAccentColor: str(raw.pdfAccentColor, "#3CC998"),
    defaultHourlyRate: num(raw.defaultHourlyRate, 300),
    defaultCurrency: str(raw.defaultCurrency, DEFAULT_CURRENCY),
    defaultVatRate: num(raw.defaultVatRate, DEFAULT_VAT_RATE),
    issuerLegalName: str(raw.issuerLegalName),
    issuerTaxId: str(raw.issuerTaxId),
    issuerAddress: str(raw.issuerAddress),
    issuerPhone: str(raw.issuerPhone),
    issuerEmail: str(raw.issuerEmail),
    issuerBusinessType:
      businessType === "company" || businessType === "osek_patur"
        ? businessType
        : "osek_murshe",
    emailSenderName: str(raw.emailSenderName),
    emailSenderPhone: str(raw.emailSenderPhone),
    emailSenderEmail: str(raw.emailSenderEmail),
    // Falling back to the defaults means the feature works before anyone opens
    // the settings page.
    emailDkimSelector: str(raw.emailDkimSelector),
    emailDmarcRua: str(raw.emailDmarcRua),
    emailSubjectTemplate: str(raw.emailSubjectTemplate, DEFAULT_EMAIL_SUBJECT),
    emailBodyTemplate: str(raw.emailBodyTemplate, DEFAULT_EMAIL_BODY),
  };
}

// Module-level cache, same idiom as lib/lookups.ts.
let cache: WorkspaceSettings | null = null;
let pending: Promise<WorkspaceSettings> | null = null;

export async function fetchWorkspaceSettings(): Promise<WorkspaceSettings> {
  if (cache) return cache;
  if (pending) return pending;
  pending = (async () => {
    const { data } = await supabase
      .from("workspace_settings")
      .select("settings")
      .limit(1)
      .maybeSingle();
    const raw = ((data as { settings?: Record<string, unknown> } | null)
      ?.settings ?? {}) as Record<string, unknown>;
    cache = coerce(raw);
    pending = null;
    return cache;
  })();
  return pending;
}

export function invalidateWorkspaceSettings() {
  cache = null;
}

/**
 * Merge `patch` into the stored settings and write the row back.
 *
 * The merge reads the row again immediately before writing rather than
 * spreading a snapshot taken when the page mounted. That matters because
 * workspace_settings is a *single* row edited from two different screens: a
 * stale snapshot would quietly revert whatever the other screen saved. Each
 * caller passes only the keys it owns.
 *
 * Returns an error message, or null on success.
 */
export async function saveWorkspaceSettings(
  patch: Record<string, unknown>,
): Promise<{ error: string | null; settings: Record<string, unknown> }> {
  const { data, error: readError } = await supabase
    .from("workspace_settings")
    .select("id, settings")
    .limit(1)
    .maybeSingle();
  if (readError) return { error: readError.message, settings: {} };

  const row = data as { id: string; settings?: Record<string, unknown> } | null;
  const merged = { ...(row?.settings ?? {}), ...patch };

  const { error: writeError } = row
    ? await supabase
        .from("workspace_settings")
        .update({ settings: merged, updated_at: Date.now() })
        .eq("id", row.id)
    : await supabase
        .from("workspace_settings")
        .insert({ id: "default", settings: merged, updated_at: Date.now() });

  if (writeError) return { error: writeError.message, settings: merged };
  invalidateWorkspaceSettings();
  return { error: null, settings: merged };
}

export function useWorkspaceSettings(): WorkspaceSettings {
  const [settings, setSettings] = useState<WorkspaceSettings>(
    cache ?? EMPTY_SETTINGS,
  );
  useEffect(() => {
    let mounted = true;
    fetchWorkspaceSettings().then((s) => {
      if (mounted) setSettings(s);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return settings;
}

/**
 * The VAT rate that should apply to an invoice for this account: the
 * workspace default, or zero when the client is flagged VAT exempt.
 */
export function vatRateFor(
  settings: WorkspaceSettings,
  account: { vat_exempt?: boolean | null } | null | undefined,
): number {
  return account?.vat_exempt ? 0 : settings.defaultVatRate;
}
