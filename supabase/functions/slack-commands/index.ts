// slack-commands — handles the /crm slash command from Slack.
// Auth: Slack signing-secret verification (HMAC SHA-256), NOT Supabase JWT.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const APP_URL_FALLBACK = "https://activeapps-crm-v3.vercel.app";
const OPEN_STAGES = ["discovery", "qualification", "proposal", "negotiation"];

interface SlackConfig {
  signing_secret?: string;
  app_url?: string;
}

async function getConfig(): Promise<SlackConfig> {
  const { data } = await supabase
    .from("integrations")
    .select("config")
    .eq("key", "slack")
    .maybeSingle();
  return ((data?.config ?? {}) as SlackConfig) || {};
}

async function verifySlackSignature(
  req: Request,
  rawBody: string,
  secret: string,
): Promise<boolean> {
  const ts = req.headers.get("x-slack-request-timestamp") ?? "";
  const sig = req.headers.get("x-slack-signature") ?? "";
  if (!ts || !sig) return false;
  // Reject replays older than 5 minutes
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const base = `v0:${ts}:${rawBody}`;
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
    new TextEncoder().encode(base),
  );
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${hex}`;
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  }
  return diff === 0;
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

function titleCase(s: unknown): string {
  return String(s ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function ephemeral(text: string, blocks?: unknown[]) {
  return Response.json({
    response_type: "ephemeral",
    text,
    ...(blocks ? { blocks } : {}),
  });
}

async function adminProfileId(): Promise<string> {
  const { data } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "admin")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? "system";
}

function startOfDayMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

async function cmdSearch(query: string, appUrl: string): Promise<Response> {
  if (!query) return ephemeral("Usage: `/crm search <query>`");
  const q = `%${query}%`;
  const [accounts, contacts, leads] = await Promise.all([
    supabase.from("accounts").select("id, name").ilike("name", q).limit(5),
    supabase
      .from("contacts")
      .select("id, first_name, last_name")
      .or(`first_name.ilike.${q},last_name.ilike.${q}`)
      .limit(5),
    supabase
      .from("leads")
      .select("id, first_name, last_name, company")
      .or(`last_name.ilike.${q},company.ilike.${q}`)
      .limit(5),
  ]);
  const lines: string[] = [];
  for (const a of accounts.data ?? []) {
    lines.push(`🏢 <${appUrl}/accounts/${a.id}|${a.name}> · Account`);
  }
  for (const c of contacts.data ?? []) {
    lines.push(
      `👤 <${appUrl}/contacts/${c.id}|${c.first_name} ${c.last_name}> · Contact`,
    );
  }
  for (const l of leads.data ?? []) {
    lines.push(
      `🎯 <${appUrl}/leads/${l.id}|${`${l.first_name ?? ""} ${l.last_name}`.trim()}>${l.company ? ` · ${l.company}` : ""} · Lead`,
    );
  }
  if (lines.length === 0) return ephemeral(`No results for \"${query}\".`);
  return ephemeral(`Results for \"${query}\"`, [
    {
      type: "section",
      text: { type: "mrkdwn", text: lines.slice(0, 10).join("\n") },
    },
  ]);
}

async function cmdPipeline(appUrl: string): Promise<Response> {
  const { data } = await supabase
    .from("opportunities")
    .select("stage, amount")
    .in("stage", OPEN_STAGES);
  const opps = data ?? [];
  const lines = OPEN_STAGES.map((stage) => {
    const list = opps.filter((o) => o.stage === stage);
    const total = list.reduce((s, o) => s + Number(o.amount ?? 0), 0);
    return `*${titleCase(stage)}*: ${list.length} · ${money(total)}`;
  });
  const grand = opps.reduce((s, o) => s + Number(o.amount ?? 0), 0);
  return ephemeral("Pipeline summary", [
    {
      type: "header",
      text: { type: "plain_text", text: "📈 Open Pipeline", emoji: true },
    },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Total: *${money(grand)}* across ${opps.length} open deals · <${appUrl}/opportunities|Open in CRM>`,
      },
    },
  ]);
}

async function cmdMyTasks(appUrl: string): Promise<Response> {
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, name, status, priority, due_date, project_id")
    .not("status", "in", "(done)")
    .order("due_date", { ascending: true, nullsFirst: false })
    .limit(10);
  if (!tasks || tasks.length === 0) return ephemeral("No open tasks. 🎉");
  const projectIds = Array.from(new Set(tasks.map((t) => t.project_id)));
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", projectIds);
  const pname = Object.fromEntries((projects ?? []).map((p) => [p.id, p.name]));
  const lines = tasks.map((t) => {
    const due = t.due_date
      ? new Date(Number(t.due_date)).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })
      : "no due date";
    return `• <${appUrl}/tasks/${t.id}|${t.name}> · ${pname[t.project_id] ?? "—"} · ${titleCase(t.status)} · ${due}`;
  });
  return ephemeral("Open tasks", [
    {
      type: "header",
      text: { type: "plain_text", text: "📋 Open Tasks", emoji: true },
    },
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } },
  ]);
}

async function cmdLog(args: string, appUrl: string): Promise<Response> {
  // /crm log <hours> <project word> <description...>
  const parts = args.split(/\s+/).filter(Boolean);
  const hours = parseFloat(parts[0] ?? "");
  if (isNaN(hours) || hours <= 0 || parts.length < 2) {
    return ephemeral(
      "Usage: `/crm log <hours> <project> <description>` — e.g. `/crm log 2.5 Acme integration work`",
    );
  }
  const projectHint = parts[1];
  const description = parts.slice(2).join(" ") || null;
  const { data: project } = await supabase
    .from("projects")
    .select("id, name")
    .ilike("name", `%${projectHint}%`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!project) {
    return ephemeral(`No project matching \"${projectHint}\" found.`);
  }
  const now = Date.now();
  const userId = await adminProfileId();
  const { error } = await supabase.from("time_entries").insert({
    project_id: project.id,
    user_id: userId,
    date: startOfDayMs(),
    duration: hours,
    description,
    is_billable: true,
    is_running: false,
    created_at: now,
    updated_at: now,
  });
  if (error) return ephemeral(`Failed to log time: ${error.message}`);
  return ephemeral(
    `✅ Logged *${hours}h* on *${project.name}*${description ? ` — ${description}` : ""} · <${appUrl}/time_entries|View in CRM>`,
  );
}

async function cmdTimer(args: string, appUrl: string): Promise<Response> {
  const sub = args.split(/\s+/)[0]?.toLowerCase();
  const userId = await adminProfileId();
  const now = Date.now();

  if (sub === "start") {
    const { data: running } = await supabase
      .from("time_entries")
      .select("id")
      .eq("user_id", userId)
      .eq("is_running", true)
      .limit(1);
    if (running && running.length > 0) {
      return ephemeral("A timer is already running. Use `/crm timer stop` first.");
    }
    const hint = args.split(/\s+/).slice(1).join(" ");
    let projectQuery = supabase
      .from("projects")
      .select("id, name")
      .order("updated_at", { ascending: false })
      .limit(1);
    if (hint) projectQuery = projectQuery.ilike("name", `%${hint}%`);
    const { data: projects } = await projectQuery;
    const project = (projects ?? [])[0];
    if (!project) return ephemeral("No project found to track against.");
    const { error } = await supabase.from("time_entries").insert({
      project_id: project.id,
      user_id: userId,
      date: startOfDayMs(),
      start_time: now,
      duration: 0,
      is_billable: true,
      is_running: true,
      created_at: now,
      updated_at: now,
    });
    if (error) return ephemeral(`Failed to start timer: ${error.message}`);
    return ephemeral(`⏱ Timer started on *${project.name}*.`);
  }

  if (sub === "stop") {
    const { data: running } = await supabase
      .from("time_entries")
      .select("id, start_time, project_id")
      .eq("user_id", userId)
      .eq("is_running", true)
      .order("start_time", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!running) return ephemeral("No timer is running.");
    const duration = Math.max(
      0.01,
      +((now - Number(running.start_time)) / 3600000).toFixed(2),
    );
    const { error } = await supabase
      .from("time_entries")
      .update({ end_time: now, duration, is_running: false, updated_at: now })
      .eq("id", running.id);
    if (error) return ephemeral(`Failed to stop timer: ${error.message}`);
    const { data: project } = await supabase
      .from("projects")
      .select("name")
      .eq("id", running.project_id)
      .maybeSingle();
    return ephemeral(
      `✅ Timer stopped: *${duration}h* on *${project?.name ?? "project"}* · <${appUrl}/time_entries|Review in CRM>`,
    );
  }

  return ephemeral("Usage: `/crm timer start [project]` or `/crm timer stop`");
}

const HELP = [
  "`/crm search <query>` — find accounts, contacts, leads",
  "`/crm pipeline` — open pipeline summary",
  "`/crm my-tasks` — your open tasks",
  "`/crm log <hours> <project> <description>` — quick time entry",
  "`/crm timer start [project]` / `/crm timer stop`",
  "`/crm report` — monthly hours report",
].join("\n");

Deno.serve(async (req: Request) => {
  const rawBody = await req.text();
  const cfg = await getConfig();
  if (!cfg.signing_secret) {
    return ephemeral("Slack integration is not fully configured (missing signing secret in CRM Settings → Slack).");
  }
  const valid = await verifySlackSignature(req, rawBody, cfg.signing_secret);
  if (!valid) {
    return new Response("invalid signature", { status: 401 });
  }

  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") ?? "").trim();
  const [sub, ...rest] = text.split(/\s+/);
  const args = rest.join(" ");
  const appUrl = cfg.app_url || APP_URL_FALLBACK;

  try {
    switch ((sub ?? "").toLowerCase()) {
      case "search":
        return await cmdSearch(args, appUrl);
      case "pipeline":
        return await cmdPipeline(appUrl);
      case "my-tasks":
      case "tasks":
        return await cmdMyTasks(appUrl);
      case "log":
        return await cmdLog(args, appUrl);
      case "timer":
        return await cmdTimer(args, appUrl);
      case "report":
        return ephemeral(
          `📄 Monthly hours report: <${appUrl}/time_entries|open Time Tracking> and click *Export PDF*.`,
        );
      default:
        return ephemeral(`ActiveApps CRM commands:\n${HELP}`);
    }
  } catch (e) {
    return ephemeral(`Something went wrong: ${String(e)}`);
  }
});
