// ai-assist — generates an AI insight (summary / risks / actions) for a CRM
// record by sending its data + closely-related records to Anthropic's API.
// Deploy with verify_jwt = true — browser calls via supabase.functions.invoke
// carry the user's JWT, so only signed-in users can reach this function.
// No external call is ever made unless an admin has configured an API key
// in the integrations table (key = "anthropic").
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

// CORS — required so the browser app can call this function via
// supabase.functions.invoke. The browser sends an OPTIONS preflight first;
// without these headers + an OPTIONS handler the browser blocks the call and
// supabase-js reports "Failed to send a request to the Edge Function".
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT =
  "You are a CRM analyst for a small Israeli B2B professional-services firm; " +
  "currency ILS unless stated. Given JSON context about a record, return: " +
  "summary (2-3 sentences, concrete numbers), risks (0-4 short bullets, most " +
  "material first), actions (exactly 3 concrete next actions). Be specific " +
  "to the data; no fluff.";

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    actions: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "risks", "actions"],
};

interface AiAssistRequest {
  objectType?: string;
  recordId?: string;
  test?: boolean;
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  model?: string;
  stop_reason?: string;
  content?: AnthropicContentBlock[];
}

type Row = Record<string, unknown>;

// Returns the configured Anthropic API key, or null when the integrations row
// is missing, disconnected, or has no key stored. Callers must never contact
// Anthropic when this returns null.
async function getConfig(): Promise<string | null> {
  const { data } = await supabase
    .from("integrations")
    .select("connected, config")
    .eq("key", "anthropic")
    .maybeSingle();
  if (!data || data.connected !== true) return null;
  const key = (data.config as { api_key?: unknown } | null)?.api_key;
  return typeof key === "string" && key.length > 0 ? key : null;
}

function truncate(s: unknown, n: number): string {
  const str = String(s ?? "");
  return str.length > n ? str.slice(0, n) : str;
}

function num(v: unknown): number {
  return Number(v ?? 0) || 0;
}

function callAnthropic(apiKey: string, payload: unknown): Promise<Response> {
  // Never send temperature/top_p — Sonnet 5 rejects non-default values.
  return fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

function mapActivities(rows: Row[] | null): Row[] {
  return (rows ?? []).map((a) => ({
    type: a.type,
    subject: a.subject,
    body: truncate(a.body, 300),
    date: a.date,
  }));
}

async function accountContext(id: string): Promise<Row | null> {
  const { data: account } = await supabase
    .from("accounts")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!account) return null;

  const [opps, projects, activities, invoices] = await Promise.all([
    supabase
      .from("opportunities")
      .select("name, stage, amount, currency, close_date")
      .eq("account_id", id)
      .not("stage", "in", "(closed_won,closed_lost)")
      .limit(20),
    supabase
      .from("projects")
      .select("name, status, budget_amount, budget_hours, hourly_rate")
      .eq("account_id", id)
      .limit(20),
    supabase
      .from("activities")
      .select("type, subject, body, date")
      .eq("related_to_type", "account")
      .eq("related_to_id", id)
      .order("date", { ascending: false })
      .limit(15),
    supabase
      .from("invoices")
      .select("status, total_amount, due_date")
      .eq("account_id", id)
      .limit(100),
  ]);

  // Billed = sent | paid | overdue (same definition as AccountInsights).
  let invoicedTotal = 0;
  let paidTotal = 0;
  let overdueCount = 0;
  for (const inv of (invoices.data ?? []) as Row[]) {
    const amount = num(inv.total_amount);
    const status = String(inv.status ?? "");
    if (status === "sent" || status === "paid" || status === "overdue") {
      invoicedTotal += amount;
    }
    if (status === "paid") paidTotal += amount;
    if (status === "overdue") overdueCount += 1;
  }

  return {
    account,
    open_opportunities: opps.data ?? [],
    projects: projects.data ?? [],
    recent_activities: mapActivities(activities.data as Row[] | null),
    invoice_summary: {
      invoiced_total: invoicedTotal,
      paid_total: paidTotal,
      overdue_count: overdueCount,
      outstanding_total: invoicedTotal - paidTotal,
    },
  };
}

async function opportunityContext(id: string): Promise<Row | null> {
  const { data: opp } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!opp) return null;

  let accountName: string | null = null;
  if (opp.account_id) {
    const { data: acc } = await supabase
      .from("accounts")
      .select("name")
      .eq("id", String(opp.account_id))
      .maybeSingle();
    accountName = (acc?.name as string) ?? null;
  }

  const { data: activities } = await supabase
    .from("activities")
    .select("type, subject, body, date")
    .eq("related_to_type", "opportunity")
    .eq("related_to_id", id)
    .order("date", { ascending: false })
    .limit(15);

  return {
    opportunity: opp,
    account_name: accountName,
    recent_activities: mapActivities(activities as Row[] | null),
  };
}

async function projectContext(id: string): Promise<Row | null> {
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!project) return null;

  const [tasks, entries] = await Promise.all([
    supabase
      .from("tasks")
      .select("status, due_date")
      .eq("project_id", id)
      .limit(500),
    supabase
      .from("time_entries")
      .select("duration, hourly_rate, is_billable")
      .eq("project_id", id)
      .limit(2000),
  ]);

  const now = Date.now();
  const counts: Record<string, number> = {};
  let overdueCount = 0;
  for (const t of (tasks.data ?? []) as Row[]) {
    const status = String(t.status ?? "unknown");
    counts[status] = (counts[status] ?? 0) + 1;
    if (t.due_date != null && num(t.due_date) < now && status !== "done") {
      overdueCount += 1;
    }
  }

  // Same rate fallback as ProjectBudget: entry rate ?? project hourly_rate.
  let totalHours = 0;
  let billableValue = 0;
  for (const te of (entries.data ?? []) as Row[]) {
    const duration = num(te.duration);
    totalHours += duration;
    if (te.is_billable) {
      const rate =
        te.hourly_rate != null ? num(te.hourly_rate) : num(project.hourly_rate);
      billableValue += duration * rate;
    }
  }

  return {
    project,
    tasks: { counts, overdue_count: overdueCount },
    time: {
      total_hours: totalHours,
      billable_value: billableValue,
      budget_hours: project.budget_hours ?? null,
      budget_amount: project.budget_amount ?? null,
    },
  };
}

const OBJECT_TYPES = ["accounts", "opportunities", "projects"] as const;

Deno.serve(async (req: Request) => {
  // Handle CORS preflight — must return before any body parsing.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const body = (await req.json()) as AiAssistRequest;

    // Invariant: never contact Anthropic without a stored, connected key.
    const apiKey = await getConfig();
    if (!apiKey) return json(400, { error: "not_configured" });

    if (body.test === true) {
      const res = await callAnthropic(apiKey, {
        model: MODEL,
        max_tokens: 1,
        thinking: { type: "disabled" },
        messages: [{ role: "user", content: "ping" }],
      });
      if (res.ok) return json(200, { ok: true });
      if (res.status === 401) return json(401, { error: "invalid_key" });
      return json(502, {
        error: "upstream",
        detail: truncate(await res.text(), 500),
      });
    }

    const objectType = body.objectType;
    const recordId = body.recordId;
    if (
      !OBJECT_TYPES.includes(objectType as (typeof OBJECT_TYPES)[number]) ||
      typeof recordId !== "string" ||
      recordId.length === 0
    ) {
      return json(400, { error: "bad_request" });
    }

    let context: Row | null;
    if (objectType === "accounts") {
      context = await accountContext(recordId);
    } else if (objectType === "opportunities") {
      context = await opportunityContext(recordId);
    } else {
      context = await projectContext(recordId);
    }
    if (!context) return json(404, { error: "not_found" });

    const res = await callAnthropic(apiKey, {
      model: MODEL,
      max_tokens: 1000,
      thinking: { type: "disabled" },
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user", content: JSON.stringify({ objectType, context }) },
      ],
    });
    if (res.status === 401) return json(401, { error: "invalid_key" });
    if (!res.ok) {
      return json(502, {
        error: "upstream",
        detail: truncate(await res.text(), 500),
      });
    }

    const data = (await res.json()) as AnthropicResponse;
    const rawText = data.content?.find((b) => b.type === "text")?.text ?? "";

    let parsed: { summary: string; risks: string[]; actions: string[] };
    try {
      if (data.stop_reason !== "end_turn") throw new Error("truncated");
      const obj = JSON.parse(rawText) as {
        summary?: unknown;
        risks?: unknown;
        actions?: unknown;
      };
      parsed = {
        summary: String(obj.summary ?? ""),
        risks: Array.isArray(obj.risks) ? obj.risks.map(String) : [],
        actions: Array.isArray(obj.actions) ? obj.actions.map(String) : [],
      };
    } catch {
      parsed = { summary: rawText.slice(0, 1200), risks: [], actions: [] };
    }

    return json(200, {
      summary: parsed.summary,
      risks: parsed.risks,
      actions: parsed.actions,
      generatedAt: Date.now(),
      model: data.model ?? MODEL,
    });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
