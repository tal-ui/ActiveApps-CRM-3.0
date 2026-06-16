// slack-notify — posts CRM events to Slack (Block Kit).
// Triggered by: database webhooks (pg_net), hourly cron, and the app's Test button.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// CORS — required so the browser app (Vercel) can call this function via
// supabase.functions.invoke (the "Send Test" button). The browser sends an
// OPTIONS preflight first; without these headers + an OPTIONS handler the
// browser blocks the call and supabase-js reports
// "Failed to send a request to the Edge Function".
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

const APP_URL_FALLBACK = "https://activeapps-crm-v3.vercel.app";

interface SlackConfig {
  bot_token?: string;
  default_channel?: string;
  channel?: string; // legacy field from CRM 2.0
  channels?: Record<string, string>;
  events?: Record<string, boolean>;
  app_url?: string;
}

async function getConfig(): Promise<SlackConfig | null> {
  const { data } = await supabase
    .from("integrations")
    .select("connected, config")
    .eq("key", "slack")
    .maybeSingle();
  if (!data || !data.connected) return null;
  const cfg = (data.config ?? {}) as SlackConfig;
  if (!cfg.bot_token) return null;
  return cfg;
}

function channelFor(cfg: SlackConfig, kind: string): string {
  return (
    cfg.channels?.[kind] ||
    cfg.default_channel ||
    cfg.channel ||
    ""
  );
}

function enabled(cfg: SlackConfig, event: string): boolean {
  return cfg.events?.[event] !== false;
}

function money(n: unknown, currency = "USD"): string {
  const num = Number(n ?? 0);
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(num);
  } catch {
    return `$${num.toLocaleString()}`;
  }
}

function fdate(ms: unknown): string {
  if (!ms) return "—";
  return new Date(Number(ms)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function title(s: unknown): string {
  return String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function blocksFor(
  header: string,
  fields: [string, string][],
  url: string,
  buttonText = "View in CRM",
) {
  return [
    { type: "header", text: { type: "plain_text", text: header, emoji: true } },
    {
      type: "section",
      fields: fields.map(([k, v]) => ({
        type: "mrkdwn",
        text: `*${k}*\n${v}`,
      })),
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: buttonText },
          url,
          style: "primary",
        },
      ],
    },
  ];
}

async function post(
  cfg: SlackConfig,
  kind: string,
  text: string,
  blocks: unknown[],
): Promise<unknown> {
  const channel = channelFor(cfg, kind);
  if (!channel) return { ok: false, error: "no_channel_configured" };
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${cfg.bot_token}`,
    },
    body: JSON.stringify({ channel, text, blocks, unfurl_links: false }),
  });
  return await res.json();
}

async function accountName(id: unknown): Promise<string> {
  if (!id) return "—";
  const { data } = await supabase
    .from("accounts")
    .select("name")
    .eq("id", String(id))
    .maybeSingle();
  return (data?.name as string) ?? "—";
}

async function projectName(id: unknown): Promise<string> {
  if (!id) return "—";
  const { data } = await supabase
    .from("projects")
    .select("name")
    .eq("id", String(id))
    .maybeSingle();
  return (data?.name as string) ?? "—";
}

interface WebhookPayload {
  type: string;
  table?: string;
  record?: Record<string, unknown>;
  old_record?: Record<string, unknown> | null;
}

async function handleCron(cfg: SlackConfig): Promise<unknown[]> {
  const results: unknown[] = [];
  const now = Date.now();

  // 1. Long-running timers (8-9h window so the hourly cron reminds once)
  if (enabled(cfg, "timer_reminder")) {
    const { data: running } = await supabase
      .from("time_entries")
      .select("id, project_id, start_time, description")
      .eq("is_running", true)
      .lt("start_time", now - 8 * 3600000)
      .gte("start_time", now - 9 * 3600000);
    for (const t of running ?? []) {
      const hours = ((now - Number(t.start_time)) / 3600000).toFixed(1);
      const pname = await projectName(t.project_id);
      const appUrl = cfg.app_url || APP_URL_FALLBACK;
      results.push(
        await post(
          cfg,
          "default",
          `Timer running ${hours}h`,
          blocksFor(
            "⏱ Timer still running",
            [
              ["Duration", `${hours} hours`],
              ["Project", pname],
              ["Note", String(t.description ?? "—")],
            ],
            `${appUrl}/time_entries`,
            "Stop in CRM",
          ),
        ),
      );
    }
  }

  // 2. Flip sent → overdue (the invoices status trigger sends the notification)
  await supabase
    .from("invoices")
    .update({ status: "overdue", updated_at: now })
    .eq("status", "sent")
    .lt("due_date", now);

  return results;
}

async function handleWebhook(
  cfg: SlackConfig,
  payload: WebhookPayload,
): Promise<unknown> {
  const rec = payload.record ?? {};
  const old = payload.old_record ?? {};
  const appUrl = cfg.app_url || APP_URL_FALLBACK;

  switch (payload.table) {
    case "leads": {
      if (payload.type !== "INSERT" || !enabled(cfg, "lead_created")) return null;
      const name = `${rec.first_name ?? ""} ${rec.last_name ?? ""}`.trim();
      return await post(
        cfg,
        "leads",
        `New lead: ${name}`,
        blocksFor(
          "🎯 New Lead",
          [
            ["Name", name || "—"],
            ["Company", String(rec.company ?? "—")],
            ["Source", title(rec.source ?? "—")],
            ["Status", title(rec.status ?? "new")],
          ],
          `${appUrl}/leads/${rec.id}`,
        ),
      );
    }
    case "opportunities": {
      if (payload.type !== "UPDATE" || rec.stage === old.stage) return null;
      const acc = await accountName(rec.account_id);
      const cur = String(rec.currency ?? "USD");
      if (rec.stage === "closed_won" && enabled(cfg, "deal_won")) {
        return await post(
          cfg,
          "wins",
          `Deal won: ${rec.name}`,
          blocksFor(
            "🏆 Deal Won!",
            [
              ["Opportunity", String(rec.name ?? "—")],
              ["Account", acc],
              ["Amount", money(rec.amount, cur)],
            ],
            `${appUrl}/opportunities/${rec.id}`,
          ),
        );
      }
      if (rec.stage === "closed_lost" && enabled(cfg, "deal_lost")) {
        return await post(
          cfg,
          "pipeline",
          `Deal lost: ${rec.name}`,
          blocksFor(
            "❌ Deal Lost",
            [
              ["Opportunity", String(rec.name ?? "—")],
              ["Account", acc],
              ["Amount", money(rec.amount, cur)],
              ["Reason", String(rec.lost_reason ?? "—")],
            ],
            `${appUrl}/opportunities/${rec.id}`,
          ),
        );
      }
      if (!enabled(cfg, "stage_change")) return null;
      return await post(
        cfg,
        "pipeline",
        `Stage change: ${rec.name}`,
        blocksFor(
          "📈 Opportunity Stage Change",
          [
            ["Opportunity", String(rec.name ?? "—")],
            ["Account", acc],
            ["Stage", `${title(old.stage)} → *${title(rec.stage)}*`],
            ["Amount", money(rec.amount, cur)],
          ],
          `${appUrl}/opportunities/${rec.id}`,
        ),
      );
    }
    case "invoices": {
      if (payload.type !== "UPDATE" || rec.status === old.status) return null;
      const acc = await accountName(rec.account_id);
      const cur = String(rec.currency ?? "USD");
      if (rec.status === "overdue" && enabled(cfg, "invoice_overdue")) {
        const days = Math.max(
          1,
          Math.floor((Date.now() - Number(rec.due_date)) / 86400000),
        );
        return await post(
          cfg,
          "finance",
          `Invoice overdue: ${rec.invoice_number}`,
          blocksFor(
            "🚨 Invoice Overdue",
            [
              ["Invoice", String(rec.invoice_number ?? "—")],
              ["Account", acc],
              ["Amount", money(rec.total_amount, cur)],
              ["Days Overdue", String(days)],
            ],
            `${appUrl}/invoices/${rec.id}`,
          ),
        );
      }
      if (rec.status === "paid" && enabled(cfg, "invoice_paid")) {
        return await post(
          cfg,
          "finance",
          `Invoice paid: ${rec.invoice_number}`,
          blocksFor(
            "💰 Invoice Paid",
            [
              ["Invoice", String(rec.invoice_number ?? "—")],
              ["Account", acc],
              ["Amount", money(rec.total_amount, cur)],
            ],
            `${appUrl}/invoices/${rec.id}`,
          ),
        );
      }
      return null;
    }
    case "tasks": {
      const assigneeChanged =
        payload.type === "INSERT"
          ? rec.assignee_id != null
          : rec.assignee_id != null && rec.assignee_id !== old.assignee_id;
      if (!assigneeChanged || !enabled(cfg, "task_assigned")) return null;
      const pname = await projectName(rec.project_id);
      const { data: assignee } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", String(rec.assignee_id))
        .maybeSingle();
      return await post(
        cfg,
        "default",
        `Task assigned: ${rec.name}`,
        blocksFor(
          "📋 Task Assigned",
          [
            ["Task", String(rec.name ?? "—")],
            ["Project", pname],
            ["Assignee", (assignee?.full_name as string) ?? "—"],
            ["Due", fdate(rec.due_date)],
          ],
          `${appUrl}/tasks/${rec.id}`,
        ),
      );
    }
    default:
      return null;
  }
}

Deno.serve(async (req: Request) => {
  // Handle CORS preflight — the browser sends this before the POST. This must
  // return before any body parsing (OPTIONS has no body).
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const payload = (await req.json()) as WebhookPayload;
    const cfg = await getConfig();
    if (!cfg) {
      return json({ ok: false, reason: "slack_not_configured" });
    }

    let result: unknown;
    if (payload.type === "TEST") {
      const appUrl = cfg.app_url || APP_URL_FALLBACK;
      result = await post(
        cfg,
        "default",
        "ActiveApps CRM test message",
        blocksFor(
          "✅ ActiveApps CRM Connected",
          [
            ["Status", "Slack integration is working"],
            ["Sent", new Date().toLocaleString("en-US")],
          ],
          appUrl,
          "Open CRM",
        ),
      );
    } else if (payload.type === "CRON") {
      result = await handleCron(cfg);
    } else {
      result = await handleWebhook(cfg, payload);
    }
    return json({ ok: true, result });
  } catch (e) {
    return json({ ok: false, error: String(e) }, 500);
  }
});
