import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Webhook, Zap } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import { fmtDateTime, timeAgo, titleCase } from "../../lib/format";
import {
  EmptyState,
  ErrorNote,
  Modal,
  Button,
  Spinner,
  Toggle,
} from "../../components/ui";

interface RuleRow {
  id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  conditions: unknown;
  actions: unknown;
  enabled: boolean;
  run_count: number;
  last_run: number | null;
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[] | null;
  enabled: boolean;
  last_delivery: number | null;
}

interface DeliveryRow {
  id: string;
  event: string;
  status: string;
  status_code: number | null;
  attempt: number;
  duration_ms: number | null;
  created_at: number;
  payload: unknown;
  response: string | null;
}

function StatusChip({ status }: { status: string }) {
  const ok = status === "success" || status === "delivered";
  return (
    <span
      className={`inline-flex border font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.13em] px-2 py-0.5 rounded-[var(--radius-sm)] ${
        ok
          ? "bg-[rgba(60,201,152,0.1)] text-[var(--mint)] border-[rgba(60,201,152,0.2)]"
          : "bg-[rgba(228,0,22,0.08)] text-[#F2697A] border-[rgba(228,0,22,0.25)]"
      }`}
    >
      {status}
    </span>
  );
}

export default function AutomationsPage() {
  const { profile } = useAuth();
  const [rules, setRules] = useState<RuleRow[] | null>(null);
  const [hooks, setHooks] = useState<WebhookRow[] | null>(null);
  const [expandedRule, setExpandedRule] = useState<string | null>(null);
  const [deliveryHook, setDeliveryHook] = useState<WebhookRow | null>(null);
  const [deliveries, setDeliveries] = useState<DeliveryRow[] | null>(null);
  const [expandedDelivery, setExpandedDelivery] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("automation_rules")
      .select("id, name, description, trigger_event, conditions, actions, enabled, run_count, last_run")
      .order("name")
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setRules((data ?? []) as RuleRow[]);
      });
    // never select `secret`
    supabase
      .from("webhooks")
      .select("id, name, url, events, enabled, last_delivery")
      .order("name")
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setHooks((data ?? []) as WebhookRow[]);
      });
  }, []);

  useEffect(() => {
    if (!deliveryHook) {
      setDeliveries(null);
      setExpandedDelivery(null);
      return;
    }
    supabase
      .from("webhook_deliveries")
      .select("id, event, status, status_code, attempt, duration_ms, created_at, payload, response")
      .eq("webhook_id", deliveryHook.id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => setDeliveries((data ?? []) as DeliveryRow[]));
  }, [deliveryHook]);

  async function toggle(
    table: "automation_rules" | "webhooks",
    row: { id: string; name: string; enabled: boolean },
    enabled: boolean,
  ) {
    setError("");
    const { error: err } = await supabase
      .from(table)
      .update({ enabled, updated_at: Date.now() })
      .eq("id", row.id);
    if (err) {
      setError(err.message);
      return;
    }
    if (table === "automation_rules") {
      setRules((prev) =>
        prev ? prev.map((r) => (r.id === row.id ? { ...r, enabled } : r)) : prev,
      );
    } else {
      setHooks((prev) =>
        prev ? prev.map((h) => (h.id === row.id ? { ...h, enabled } : h)) : prev,
      );
    }
    void insertAudit(profile, {
      action: enabled ? "enable" : "disable",
      entity_type: table === "automation_rules" ? "automation_rule" : "webhook",
      entity_id: row.id,
      summary: `${enabled ? "Enabled" : "Disabled"} ${table === "automation_rules" ? "automation rule" : "webhook"} "${row.name}"`,
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
          <Webhook size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
        </div>
        <div>
          <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
            Automations & Webhooks
          </h1>
          <p className="label-mono">rules · endpoints · deliveries</p>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      {/* Automation rules */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-6">
        <div className="flex items-center gap-2.5 mb-4">
          <Zap size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Automation Rules
          </h3>
          <span className="label-mono">({rules?.length ?? "…"})</span>
        </div>
        {!rules ? (
          <Spinner />
        ) : rules.length === 0 ? (
          <EmptyState message="No automation rules configured." />
        ) : (
          <div className="space-y-1">
            {rules.map((r) => {
              const open = expandedRule === r.id;
              return (
                <div key={r.id} className="border-b border-[rgba(255,255,255,0.05)] last:border-0">
                  <div className="flex items-center gap-3 py-2.5 px-2">
                    <button
                      type="button"
                      onClick={() => setExpandedRule(open ? null : r.id)}
                      className="flex items-center gap-3 flex-1 min-w-0 text-left cursor-pointer"
                    >
                      {open ? (
                        <ChevronDown size={14} className="text-[var(--text-faint)] shrink-0" />
                      ) : (
                        <ChevronRight size={14} className="text-[var(--text-faint)] shrink-0" />
                      )}
                      <span className="text-sm text-[var(--foreground)] truncate">{r.name}</span>
                      <span className="label-mono shrink-0">{titleCase(r.trigger_event)}</span>
                    </button>
                    <span className="text-xs text-[var(--text-dim)] shrink-0 hidden md:inline">
                      {r.run_count} runs · {r.last_run ? timeAgo(r.last_run) : "never"}
                    </span>
                    <Toggle checked={r.enabled} onChange={(v) => toggle("automation_rules", r, v)} />
                  </div>
                  {open && (
                    <div className="px-9 pb-4 pt-1 space-y-3">
                      {r.description && (
                        <p className="text-sm text-[var(--text-mid)]">{r.description}</p>
                      )}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <p className="label-mono mb-1.5">Conditions</p>
                          <pre className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3 overflow-x-auto">
                            {JSON.stringify(r.conditions, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="label-mono mb-1.5">Actions</p>
                          <pre className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3 overflow-x-auto">
                            {JSON.stringify(r.actions, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Webhooks */}
      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
        <div className="flex items-center gap-2.5 mb-4">
          <Webhook size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Webhooks
          </h3>
          <span className="label-mono">({hooks?.length ?? "…"})</span>
        </div>
        {!hooks ? (
          <Spinner />
        ) : hooks.length === 0 ? (
          <EmptyState message="No webhooks configured." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left">
                  {["Name", "URL", "Events", "Last Delivery", "Enabled", ""].map((h, i) => (
                    <th key={i} className="label-mono font-normal pb-3 pr-4">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {hooks.map((h) => (
                  <tr key={h.id} className="border-t border-[rgba(255,255,255,0.05)]">
                    <td className="py-3 pr-4 text-[var(--foreground)]">{h.name}</td>
                    <td className="py-3 pr-4">
                      <span className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] block max-w-64 truncate">
                        {h.url}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-dim)] text-xs">
                      {(h.events ?? []).join(", ") || "all"}
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-dim)] text-xs">
                      {h.last_delivery ? timeAgo(h.last_delivery) : "never"}
                    </td>
                    <td className="py-3 pr-4">
                      <Toggle checked={h.enabled} onChange={(v) => toggle("webhooks", h, v)} />
                    </td>
                    <td className="py-3">
                      <Button
                        variant="subtle"
                        onClick={() => setDeliveryHook(h)}
                        className="!px-3 !py-1.5"
                      >
                        Deliveries
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Delivery log */}
      {deliveryHook && (
        <Modal
          title={`Deliveries — ${deliveryHook.name}`}
          onClose={() => setDeliveryHook(null)}
          wide
        >
          {!deliveries ? (
            <Spinner />
          ) : deliveries.length === 0 ? (
            <EmptyState message="No deliveries recorded for this webhook." />
          ) : (
            <div className="space-y-1 max-h-[55vh] overflow-y-auto">
              {deliveries.map((d) => {
                const open = expandedDelivery === d.id;
                return (
                  <div key={d.id} className="border-b border-[rgba(255,255,255,0.05)] last:border-0">
                    <button
                      type="button"
                      onClick={() => setExpandedDelivery(open ? null : d.id)}
                      className="w-full flex items-center gap-3 py-2.5 px-1 text-left cursor-pointer hover:bg-[var(--navy-surface)] rounded-[var(--radius-sm)] transition-colors"
                    >
                      <span className="font-[var(--font-mono)] text-xs text-[var(--text-faint)] w-36 shrink-0">
                        {fmtDateTime(d.created_at)}
                      </span>
                      <span className="text-sm text-[var(--text-light)] flex-1 truncate">
                        {d.event}
                      </span>
                      <StatusChip status={d.status} />
                      <span className="font-[var(--font-mono)] text-xs text-[var(--text-dim)] shrink-0">
                        {d.status_code ?? "—"} · try {d.attempt} · {d.duration_ms ?? "—"}ms
                      </span>
                    </button>
                    {open && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-1 pb-4 pt-1">
                        <div className="min-w-0">
                          <p className="label-mono mb-1.5">Payload</p>
                          <pre className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3 overflow-x-auto max-h-52">
                            {JSON.stringify(d.payload, null, 2)}
                          </pre>
                        </div>
                        <div className="min-w-0">
                          <p className="label-mono mb-1.5">Response</p>
                          <pre className="font-[var(--font-mono)] text-xs text-[var(--text-mid)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3 overflow-x-auto max-h-52 whitespace-pre-wrap">
                            {d.response ?? "—"}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
