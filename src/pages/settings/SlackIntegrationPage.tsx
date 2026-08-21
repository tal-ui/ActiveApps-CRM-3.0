import { useEffect, useState } from "react";
import { Check, Send, Slack } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Spinner,
  Toggle,
} from "../../components/ui";
import HelpButton from "../../components/HelpButton";

const EVENTS = [
  ["lead_created", "New lead created"],
  ["stage_change", "Opportunity stage change"],
  ["deal_won", "Deal won"],
  ["deal_lost", "Deal lost"],
  ["invoice_overdue", "Invoice overdue"],
  ["invoice_paid", "Invoice paid"],
  ["task_assigned", "Task assigned"],
  ["timer_reminder", "Timer running > 8 hours"],
  ["retainer_generated", "Retainer invoice generated"],
] as const;

const CHANNEL_KINDS = [
  ["leads", "Leads"],
  ["pipeline", "Pipeline"],
  ["wins", "Wins"],
  ["finance", "Finance"],
] as const;

interface SlackCfg {
  bot_token?: string;
  signing_secret?: string;
  default_channel?: string;
  channels?: Record<string, string>;
  events?: Record<string, boolean>;
  app_url?: string;
}

export default function SlackIntegrationPage() {
  const [rowId, setRowId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [cfg, setCfg] = useState<SlackCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedFlash, setSavedFlash] = useState(false);
  const [testResult, setTestResult] = useState("");

  useEffect(() => {
    supabase
      .from("integrations")
      .select("id, connected, config")
      .eq("key", "slack")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRowId(data.id as string);
          setConnected(Boolean(data.connected));
          setCfg((data.config ?? {}) as SlackCfg);
        } else {
          setCfg({});
        }
      });
  }, []);

  if (!cfg) return <Spinner />;

  function patch(p: Partial<SlackCfg>) {
    setCfg((prev) => ({ ...(prev ?? {}), ...p }));
  }

  async function save() {
    setBusy(true);
    setError("");
    const isConnected = Boolean(cfg?.bot_token);
    const payload = {
      key: "slack",
      name: "Slack",
      category: "messaging",
      connected: isConnected,
      config: cfg,
      updated_at: Date.now(),
    };
    const result = rowId
      ? await supabase.from("integrations").update(payload).eq("id", rowId)
      : await supabase.from("integrations").insert(payload);
    setBusy(false);
    if (result.error) {
      setError(
        result.error.message.includes("policy")
          ? "Only admins can change integration settings."
          : result.error.message,
      );
      return;
    }
    setConnected(isConnected);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }

  async function sendTest() {
    setBusy(true);
    setTestResult("");
    setError("");
    const { data, error } = await supabase.functions.invoke("slack-notify", {
      body: { type: "TEST" },
    });
    setBusy(false);
    if (error) {
      setError(`Test failed: ${error.message}`);
      return;
    }
    const res = data as { ok?: boolean; reason?: string; result?: { ok?: boolean; error?: string } };
    if (res?.reason === "slack_not_configured") {
      setTestResult("Not configured yet — save a bot token first.");
    } else if (res?.result && (res.result as { ok?: boolean }).ok === false) {
      setTestResult(`Slack said: ${(res.result as { error?: string }).error ?? "unknown error"}`);
    } else {
      setTestResult("Test message sent — check your Slack channel.");
    }
  }

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Slack size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                Slack Integration
              </h1>
              <HelpButton topic="/settings/slack" />
            </div>
            <p className="label-mono flex items-center gap-2">
              {connected ? (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] animate-pulse" />
                  Connected
                </>
              ) : (
                "Not connected"
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={sendTest} disabled={busy || !connected}>
            <Send size={14} strokeWidth={1.5} />
            Send Test
          </Button>
          <Button onClick={save} disabled={busy}>
            {savedFlash ? <Check size={15} strokeWidth={2} /> : null}
            {busy ? "Saving…" : savedFlash ? "Saved" : "Save Settings"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4">
          <ErrorNote message={error} />
        </div>
      )}
      {testResult && (
        <div className="mb-4 bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--mint)]">
          {testResult}
        </div>
      )}

      {/* Credentials */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-5">
        <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)] mb-4">
          Slack App Credentials
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel required>Bot Token (xoxb-…)</FieldLabel>
            <Input
              type="password"
              value={cfg.bot_token ?? ""}
              onChange={(e) => patch({ bot_token: e.target.value })}
              placeholder="xoxb-…"
            />
          </div>
          <div>
            <FieldLabel>Signing Secret</FieldLabel>
            <Input
              type="password"
              value={cfg.signing_secret ?? ""}
              onChange={(e) => patch({ signing_secret: e.target.value })}
              placeholder="for /crm slash commands"
            />
          </div>
          <div>
            <FieldLabel required>Default Channel ID</FieldLabel>
            <Input
              value={cfg.default_channel ?? ""}
              onChange={(e) => patch({ default_channel: e.target.value })}
              placeholder="C0123456789"
            />
          </div>
          <div>
            <FieldLabel>CRM App URL</FieldLabel>
            <Input
              value={cfg.app_url ?? ""}
              onChange={(e) => patch({ app_url: e.target.value })}
              placeholder="https://activeapps-crm-v3.vercel.app"
            />
          </div>
        </div>
      </section>

      {/* Channel routing */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-5">
        <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)] mb-1">
          Channel Routing
        </h3>
        <p className="text-xs text-[var(--text-faint)] mb-4">
          Optional — route event types to specific channel IDs. Empty fields fall
          back to the default channel.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {CHANNEL_KINDS.map(([kind, label]) => (
            <div key={kind}>
              <FieldLabel>{label}</FieldLabel>
              <Input
                value={cfg.channels?.[kind] ?? ""}
                onChange={(e) =>
                  patch({
                    channels: { ...(cfg.channels ?? {}), [kind]: e.target.value },
                  })
                }
                placeholder="C…"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Event toggles */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-5">
        <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)] mb-4">
          Notifications
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {EVENTS.map(([key, label]) => (
            <Toggle
              key={key}
              checked={cfg.events?.[key] !== false}
              onChange={(v) =>
                patch({ events: { ...(cfg.events ?? {}), [key]: v } })
              }
              label={label}
            />
          ))}
        </div>
      </section>

    </div>
  );
}
