// automations — evaluates user-defined automation rules and delivers webhooks.
// Triggered by database webhooks (pg_net, see run_automations() in the
// migration) and by the app's "Test" buttons via supabase.functions.invoke.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MAX_ATTEMPTS = 3;

type Rec = Record<string, unknown>;

interface Condition {
  field: string;
  op: string;
  value?: string;
}

interface Action {
  type: string;
  // webhook
  webhook_id?: string;
  // update_field
  field?: string;
  value?: string;
  // create_task
  task_name?: string;
  due_in_days?: number;
  // notify / slack
  message?: string;
  channel?: string;
}

interface Rule {
  id: string;
  name: string;
  object_name: string;
  trigger_event: string; // created | updated | field_changed
  trigger_field: string | null;
  conditions: { match?: string; rules?: Condition[] } | null;
  actions: Action[] | null;
  run_count: number;
}

interface Payload {
  type: string; // INSERT | UPDATE | TEST_WEBHOOK | TEST_RULE
  table?: string;
  record?: Rec;
  old_record?: Rec | null;
  webhook_id?: string;
  rule_id?: string;
}

/* ---------------- condition evaluation (mirrors src/lib/filters.ts) -------- */

function matchesCondition(rec: Rec, c: Condition): boolean {
  const raw = rec[c.field];
  const want = c.value ?? "";

  // Numeric comparisons when both sides look numeric
  if (c.op === "gt" || c.op === "lt") {
    const a = Number(raw);
    const b = Number(want);
    if (Number.isNaN(a) || Number.isNaN(b)) return false;
    return c.op === "gt" ? a > b : a < b;
  }

  if (typeof raw === "boolean" || want === "true" || want === "false") {
    const a = Boolean(raw);
    const b = want === "true";
    return c.op === "neq" ? a !== b : a === b;
  }

  const s = String(raw ?? "").toLowerCase();
  const q = String(want).toLowerCase();
  switch (c.op) {
    case "contains":
      return s.includes(q);
    case "ncontains":
      return !s.includes(q);
    case "neq":
      return s !== q;
    case "is_empty":
      return s === "";
    case "is_not_empty":
      return s !== "";
    default:
      return s === q;
  }
}

function conditionsPass(rec: Rec, rule: Rule): boolean {
  const list = rule.conditions?.rules ?? [];
  if (list.length === 0) return true;
  const mode = rule.conditions?.match === "any" ? "any" : "all";
  return mode === "any"
    ? list.some((c) => matchesCondition(rec, c))
    : list.every((c) => matchesCondition(rec, c));
}

function triggerMatches(rule: Rule, p: Payload): boolean {
  if (rule.trigger_event === "created") return p.type === "INSERT";
  if (rule.trigger_event === "updated") return p.type === "UPDATE";
  if (rule.trigger_event === "field_changed") {
    if (p.type !== "UPDATE" || !rule.trigger_field) return false;
    const before = (p.old_record ?? {})[rule.trigger_field];
    const after = (p.record ?? {})[rule.trigger_field];
    return String(before ?? "") !== String(after ?? "");
  }
  return false;
}

/* ---------------- template rendering: "Deal {{name}} closed" -------------- */

function render(tpl: string, rec: Rec): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = rec[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

/* ---------------- webhook delivery with HMAC signing + retries ------------ */

async function sign(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

interface WebhookRow {
  id: string;
  name: string;
  url: string;
  secret: string | null;
  enabled: boolean;
  events: string[] | null;
}

async function deliver(
  hook: WebhookRow,
  event: string,
  payload: unknown,
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const body = JSON.stringify({ event, sent_at: Date.now(), data: payload });
  const signature = hook.secret ? await sign(hook.secret, body) : null;

  let last: { ok: boolean; status?: number; error?: string } = {
    ok: false,
    error: "not_attempted",
  };

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const started = Date.now();
    let status: number | null = null;
    let responseText = "";
    let ok = false;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 10000);
      const res = await fetch(hook.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AACRM-Event": event,
          ...(signature ? { "X-AACRM-Signature": `sha256=${signature}` } : {}),
        },
        body,
        signal: ctl.signal,
      });
      clearTimeout(timer);
      status = res.status;
      responseText = (await res.text()).slice(0, 2000);
      ok = res.ok;
    } catch (e) {
      responseText = String(e).slice(0, 2000);
    }

    await supabase.from("webhook_deliveries").insert({
      webhook_id: hook.id,
      event,
      payload: JSON.parse(body),
      status: ok ? "success" : "failed",
      status_code: status,
      response: responseText || null,
      signature,
      attempt,
      duration_ms: Date.now() - started,
      created_at: Date.now(),
    });

    last = { ok, status: status ?? undefined, error: ok ? undefined : responseText };
    if (ok) break;
    // Backoff before retrying: 400ms, 1200ms
    if (attempt < MAX_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 400 * attempt * attempt));
    }
  }

  await supabase
    .from("webhooks")
    .update({ last_delivery: Date.now(), updated_at: Date.now() })
    .eq("id", hook.id);

  return last;
}

/* ---------------- actions -------------------------------------------------- */

async function slackPost(text: string, channelKey: string): Promise<unknown> {
  const { data } = await supabase
    .from("integrations")
    .select("connected, config")
    .eq("key", "slack")
    .maybeSingle();
  const cfg = (data?.config ?? {}) as {
    bot_token?: string;
    default_channel?: string;
    channel?: string;
    channels?: Record<string, string>;
  };
  if (!data?.connected || !cfg.bot_token) return { ok: false, error: "slack_not_configured" };
  const channel =
    (channelKey && cfg.channels?.[channelKey]) ||
    cfg.default_channel ||
    cfg.channel ||
    "";
  if (!channel) return { ok: false, error: "no_channel" };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${cfg.bot_token}`,
    },
    body: JSON.stringify({ channel, text, unfurl_links: false }),
  });
  return await res.json();
}

async function runAction(
  action: Action,
  rule: Rule,
  rec: Rec,
): Promise<{ type: string; ok: boolean; detail?: unknown }> {
  const now = Date.now();
  switch (action.type) {
    case "webhook": {
      if (!action.webhook_id) return { type: "webhook", ok: false, detail: "no_webhook" };
      const { data: hook } = await supabase
        .from("webhooks")
        .select("id, name, url, secret, enabled, events")
        .eq("id", action.webhook_id)
        .maybeSingle();
      if (!hook || !(hook as WebhookRow).enabled) {
        return { type: "webhook", ok: false, detail: "webhook_disabled_or_missing" };
      }
      const res = await deliver(
        hook as WebhookRow,
        `${rule.object_name}.${rule.trigger_event}`,
        { rule: rule.name, record: rec },
      );
      return { type: "webhook", ok: res.ok, detail: res };
    }

    case "update_field": {
      if (!action.field) return { type: "update_field", ok: false, detail: "no_field" };
      const value = action.value === "" ? null : render(String(action.value ?? ""), rec);
      const { error } = await supabase
        .from(rule.object_name)
        .update({ [action.field]: value, updated_at: now })
        .eq("id", String(rec.id));
      return { type: "update_field", ok: !error, detail: error?.message };
    }

    case "create_task": {
      // Tasks require a project; use the record's project_id, or its own id
      // when the rule runs on a project.
      const projectId =
        rule.object_name === "projects" ? String(rec.id) : (rec.project_id as string | null);
      if (!projectId) return { type: "create_task", ok: false, detail: "no_project_context" };
      const { error } = await supabase.from("tasks").insert({
        name: render(action.task_name || `Follow up: ${rule.name}`, rec),
        project_id: projectId,
        account_id: (rec.account_id as string) ?? null,
        status: "todo",
        due_date: action.due_in_days ? now + Number(action.due_in_days) * 86400000 : null,
        owner_id: (rec.owner_id as string) ?? "system",
        created_by_id: "system",
        created_at: now,
        updated_at: now,
      });
      return { type: "create_task", ok: !error, detail: error?.message };
    }

    case "notify": {
      const { error } = await supabase.from("notifications").insert({
        type: "automation",
        title: rule.name,
        body: render(action.message || "", rec),
        entity_type: rule.object_name,
        entity_id: String(rec.id),
        url_path: `/${rule.object_name}/${rec.id}`,
        // null recipient = broadcast, matching the existing DB triggers
        recipient_id: (rec.owner_id as string) ?? null,
        is_read: false,
        created_at: now,
      });
      return { type: "notify", ok: !error, detail: error?.message };
    }

    case "slack": {
      const text = render(action.message || rule.name, rec);
      const res = await slackPost(text, action.channel || "");
      return { type: "slack", ok: !!(res as { ok?: boolean })?.ok, detail: res };
    }

    default:
      return { type: action.type, ok: false, detail: "unknown_action" };
  }
}

/* ---------------- main ----------------------------------------------------- */

async function handleRecordEvent(p: Payload): Promise<unknown> {
  const rec = p.record ?? {};
  const results: unknown[] = [];

  // 1. Rules for this table
  const { data: rules } = await supabase
    .from("automation_rules")
    .select("id, name, object_name, trigger_event, trigger_field, conditions, actions, run_count")
    .eq("enabled", true)
    .eq("object_name", p.table ?? "");

  for (const r of (rules ?? []) as Rule[]) {
    if (!triggerMatches(r, p)) continue;
    if (!conditionsPass(rec, r)) continue;
    const actionResults = [];
    for (const a of r.actions ?? []) {
      actionResults.push(await runAction(a, r, rec));
    }
    await supabase
      .from("automation_rules")
      .update({ run_count: (r.run_count ?? 0) + 1, last_run: Date.now() })
      .eq("id", r.id);
    results.push({ rule: r.name, actions: actionResults });
  }

  // 2. Webhooks subscribed directly to this event (no rule needed) — the
  //    zero-config path for Make.com scenarios.
  const eventName = `${p.table}.${p.type === "INSERT" ? "created" : "updated"}`;
  const { data: hooks } = await supabase
    .from("webhooks")
    .select("id, name, url, secret, enabled, events")
    .eq("enabled", true)
    .contains("events", [eventName]);
  for (const h of (hooks ?? []) as WebhookRow[]) {
    const res = await deliver(h, eventName, { record: rec, old_record: p.old_record ?? null });
    results.push({ webhook: h.name, ...res });
  }

  return results;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const p = (await req.json()) as Payload;

    if (p.type === "TEST_WEBHOOK") {
      const { data: hook } = await supabase
        .from("webhooks")
        .select("id, name, url, secret, enabled, events")
        .eq("id", p.webhook_id ?? "")
        .maybeSingle();
      if (!hook) return json({ ok: false, error: "webhook_not_found" }, 404);
      const res = await deliver(hook as WebhookRow, "test.ping", {
        message: "ActiveApps CRM webhook test",
      });
      return json({ ok: res.ok, result: res });
    }

    if (p.type === "INSERT" || p.type === "UPDATE") {
      const result = await handleRecordEvent(p);
      return json({ ok: true, result });
    }

    return json({ ok: false, error: "unsupported_type" }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
