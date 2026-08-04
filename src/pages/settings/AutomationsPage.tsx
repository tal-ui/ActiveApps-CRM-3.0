import { useCallback, useEffect, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  Send,
  Trash2,
  Webhook,
  Zap,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import { fmtDateTime, timeAgo, titleCase } from "../../lib/format";
import { OBJECTS } from "../../lib/objects";
import {
  ConfirmModal,
  EmptyState,
  ErrorNote,
  Modal,
  Button,
  Spinner,
  Toggle,
} from "../../components/ui";
import AutomationRuleForm, {
  type AutomationRule,
} from "../../components/AutomationRuleForm";
import WebhookForm, { type WebhookRow } from "../../components/WebhookForm";

type RuleRow = AutomationRule & {
  run_count: number;
  last_run: number | null;
};

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
  const [editRule, setEditRule] = useState<AutomationRule | null | undefined>(undefined);
  const [editHook, setEditHook] = useState<WebhookRow | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<
    { kind: "rule" | "webhook"; id: string; name: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<string>("");

  const load = useCallback(() => {
    supabase
      .from("automation_rules")
      .select(
        "id, name, description, object_name, trigger_event, trigger_field, conditions, actions, enabled, run_count, last_run",
      )
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

  useEffect(load, [load]);

  async function removeTarget() {
    if (!deleteTarget) return;
    setBusy(true);
    const table = deleteTarget.kind === "rule" ? "automation_rules" : "webhooks";
    const { error: err } = await supabase.from(table).delete().eq("id", deleteTarget.id);
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    void insertAudit(profile, {
      action: "delete",
      entity_type: deleteTarget.kind === "rule" ? "automation_rule" : "webhook",
      entity_id: deleteTarget.id,
      summary: `Deleted ${deleteTarget.kind} "${deleteTarget.name}"`,
    });
    setDeleteTarget(null);
    load();
  }

  async function testWebhook(hook: WebhookRow) {
    setBusy(true);
    setTestResult("");
    setError("");
    const { data, error: err } = await supabase.functions.invoke("automations", {
      body: { type: "TEST_WEBHOOK", webhook_id: hook.id },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    const ok = (data as { ok?: boolean })?.ok;
    setTestResult(
      ok
        ? `✓ ${hook.name} responded successfully`
        : `✗ ${hook.name} failed — see Deliveries for details`,
    );
    load();
  }

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
      {testResult && (
        <div className="mb-6 bg-[var(--card)] border border-[rgba(60,201,152,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--text-light)]">
          {testResult}
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
          <Button
            className="!px-3 !py-1.5 ml-auto"
            onClick={() => setEditRule(null)}
          >
            <Plus size={14} strokeWidth={2} />
            New Rule
          </Button>
        </div>
        {!rules ? (
          <Spinner />
        ) : rules.length === 0 ? (
          <EmptyState message="No automation rules yet. Create one to react to record changes." />
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
                      <span className="label-mono shrink-0">
                        {r.object_name ? OBJECTS[r.object_name]?.plural ?? r.object_name : "—"} ·{" "}
                        {titleCase(r.trigger_event)}
                      </span>
                    </button>
                    <span className="text-xs text-[var(--text-dim)] shrink-0 hidden md:inline">
                      {r.run_count} runs · {r.last_run ? timeAgo(r.last_run) : "never"}
                    </span>
                    <button
                      onClick={() => setEditRule(r)}
                      className="text-[var(--text-dim)] hover:text-[var(--mint)] cursor-pointer transition-colors p-1.5"
                      aria-label={`Edit rule ${r.name}`}
                    >
                      <Pencil size={14} strokeWidth={1.5} />
                    </button>
                    <button
                      onClick={() => setDeleteTarget({ kind: "rule", id: r.id, name: r.name })}
                      className="text-[var(--text-dim)] hover:text-[#F2697A] cursor-pointer transition-colors p-1.5"
                      aria-label={`Delete rule ${r.name}`}
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
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
                          {(r.conditions?.rules ?? []).length === 0 ? (
                            <p className="text-sm text-[var(--text-faint)]">
                              Runs on every {titleCase(r.trigger_event).toLowerCase()} event.
                            </p>
                          ) : (
                            <ul className="space-y-1 text-sm text-[var(--text-mid)]">
                              {(r.conditions?.rules ?? []).map((c, i) => (
                                <li key={i}>
                                  <span className="font-[var(--font-mono)] text-xs">
                                    {c.field}
                                  </span>{" "}
                                  {c.op.replace(/_/g, " ")}{" "}
                                  <span className="text-[var(--foreground)]">{c.value}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        <div>
                          <p className="label-mono mb-1.5">Actions</p>
                          <ul className="space-y-1 text-sm text-[var(--text-mid)]">
                            {(r.actions ?? []).map((a, i) => (
                              <li key={i}>
                                <span className="text-[var(--mint)]">
                                  {titleCase(a.type)}
                                </span>
                                {a.message ? ` — ${a.message}` : ""}
                                {a.field ? ` — ${a.field} = ${a.value ?? ""}` : ""}
                                {a.webhook_id
                                  ? ` — ${hooks?.find((h) => h.id === a.webhook_id)?.name ?? "endpoint"}`
                                  : ""}
                              </li>
                            ))}
                          </ul>
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
          <Button
            className="!px-3 !py-1.5 ml-auto"
            onClick={() => setEditHook(null)}
          >
            <Plus size={14} strokeWidth={2} />
            New Webhook
          </Button>
        </div>
        {!hooks ? (
          <Spinner />
        ) : hooks.length === 0 ? (
          <EmptyState message="No endpoints yet. Add your Make scenario URL to start receiving events." />
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
                      <div className="flex items-center gap-1.5 justify-end">
                        <Button
                          variant="ghost"
                          disabled={busy}
                          onClick={() => testWebhook(h)}
                          className="!px-3 !py-1.5"
                        >
                          <Send size={13} strokeWidth={1.5} />
                          Test
                        </Button>
                        <Button
                          variant="subtle"
                          onClick={() => setDeliveryHook(h)}
                          className="!px-3 !py-1.5"
                        >
                          Deliveries
                        </Button>
                        <button
                          onClick={() => setEditHook(h)}
                          className="text-[var(--text-dim)] hover:text-[var(--mint)] cursor-pointer transition-colors p-1.5"
                          aria-label={`Edit webhook ${h.name}`}
                        >
                          <Pencil size={14} strokeWidth={1.5} />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ kind: "webhook", id: h.id, name: h.name })}
                          className="text-[var(--text-dim)] hover:text-[#F2697A] cursor-pointer transition-colors p-1.5"
                          aria-label={`Delete webhook ${h.name}`}
                        >
                          <Trash2 size={14} strokeWidth={1.5} />
                        </button>
                      </div>
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

      {editRule !== undefined && (
        <AutomationRuleForm
          rule={editRule}
          webhooks={hooks ?? []}
          onClose={() => setEditRule(undefined)}
          onSaved={() => {
            setEditRule(undefined);
            load();
          }}
        />
      )}
      {editHook !== undefined && (
        <WebhookForm
          webhook={editHook}
          onClose={() => setEditHook(undefined)}
          onSaved={() => {
            setEditHook(undefined);
            load();
          }}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Delete ${deleteTarget.kind}`}
          confirmLabel="Delete"
          destructive
          busy={busy}
          onConfirm={removeTarget}
          onClose={() => setDeleteTarget(null)}
        >
          <p>
            Delete "{deleteTarget.name}"?{" "}
            {deleteTarget.kind === "webhook"
              ? "Rules pointing at this endpoint will stop delivering."
              : "This can't be undone."}
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
