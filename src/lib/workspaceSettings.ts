import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { DEFAULT_CURRENCY } from "./format";

/**
 * The workspace_settings row is a single jsonb blob edited on
 * Settings → Workspace. This module gives the rest of the app a typed,
 * cached read of the keys it cares about, so consumers never have to know
 * the storage shape or repeat the fetch.
 *
 * Unknown keys are deliberately not modelled here — the settings page
 * preserves them on save via a read-modify-write merge.
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
