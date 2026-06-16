// slack-interactions — handles Slack interactivity for the CRM.
//
// Feature: create a CRM task from any Slack message (DM or channel) via the
// message shortcut "Create CRM task". Flow:
//   1. message_action  -> open a modal (task name prefilled, pick Project,
//      optional Due date / Notes).
//   2. view_submission -> create the task in the CRM, assigning it to the CRM
//      profile whose email matches the Slack user (fallback: admin).
//
// Auth: Slack signing-secret verification (HMAC SHA-256), NOT Supabase JWT —
// so this function MUST be deployed with verify_jwt = false.
import { createClient } from "npm:@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const APP_URL_FALLBACK = "https://activeapps-crm-v3.vercel.app";

// callback_ids — must match the Slack app config (shortcut) and our modal.
const SHORTCUT_CALLBACK = "create_crm_task";
const MODAL_CALLBACK = "create_crm_task_modal";

interface SlackConfig {
  bot_token?: string;
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
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // replay guard
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

async function slack(
  cfg: SlackConfig,
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${cfg.bot_token}`,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
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

// Map a Slack user to a CRM profile by email (needs users:read.email scope).
async function profileForSlackUser(
  cfg: SlackConfig,
  slackUserId: string,
): Promise<string> {
  try {
    const res = await fetch(
      `https://slack.com/api/users.info?user=${encodeURIComponent(slackUserId)}`,
      { headers: { Authorization: `Bearer ${cfg.bot_token}` } },
    );
    const j = (await res.json()) as {
      ok?: boolean;
      user?: { profile?: { email?: string } };
    };
    const email = j?.user?.profile?.email;
    if (email) {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", email)
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();
      if (data?.id) return data.id as string;
    }
  } catch {
    // fall through to admin
  }
  return await adminProfileId();
}

async function projectOptions(): Promise<
  { text: { type: string; text: string }; value: string }[]
> {
  const { data } = await supabase
    .from("projects")
    .select("id, name")
    .order("updated_at", { ascending: false })
    .limit(100);
  return (data ?? []).map((p) => ({
    text: { type: "plain_text", text: String(p.name).slice(0, 75) },
    value: String(p.id),
  }));
}

function msFromDate(date: string | undefined | null): number | null {
  if (!date) return null;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isNaN(ms) ? null : ms;
}

function buildModal(
  privateMetadata: string,
  messageText: string,
  projects: { text: { type: string; text: string }; value: string }[],
) {
  const firstLine = (messageText.split("\n")[0] || "Task from Slack").slice(0, 250);
  return {
    type: "modal",
    callback_id: MODAL_CALLBACK,
    private_metadata: privateMetadata,
    title: { type: "plain_text", text: "Create CRM Task" },
    submit: { type: "plain_text", text: "Create" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "name",
        label: { type: "plain_text", text: "Task name" },
        element: {
          type: "plain_text_input",
          action_id: "val",
          initial_value: firstLine,
          max_length: 250,
        },
      },
      {
        type: "input",
        block_id: "project",
        label: { type: "plain_text", text: "Project" },
        element: {
          type: "static_select",
          action_id: "val",
          placeholder: { type: "plain_text", text: "Select a project" },
          options: projects,
        },
      },
      {
        type: "input",
        block_id: "due",
        optional: true,
        label: { type: "plain_text", text: "Due date" },
        element: { type: "datepicker", action_id: "val" },
      },
      {
        type: "input",
        block_id: "desc",
        optional: true,
        label: { type: "plain_text", text: "Notes" },
        element: {
          type: "plain_text_input",
          action_id: "val",
          multiline: true,
          initial_value: messageText.slice(0, 2900),
        },
      },
    ],
  };
}

function noProjectsModal() {
  return {
    type: "modal",
    callback_id: "noop",
    title: { type: "plain_text", text: "Create CRM Task" },
    close: { type: "plain_text", text: "Close" },
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text:
            "There are no projects in the CRM yet. Create a project first, then you can file tasks against it from Slack.",
        },
      },
    ],
  };
}

async function handleMessageAction(
  cfg: SlackConfig,
  payload: Record<string, any>,
): Promise<Response> {
  const channelId = payload.channel?.id ?? "";
  const messageTs = payload.message?.ts ?? payload.message_ts ?? "";
  const messageText = String(payload.message?.text ?? "");
  const slackUserId = payload.user?.id ?? "";
  const triggerId = payload.trigger_id;

  // Permalink back to the original message (best effort).
  let permalink = "";
  if (channelId && messageTs) {
    const r = await slack(cfg, "chat.getPermalink", {
      channel: channelId,
      message_ts: messageTs,
    });
    if (r.ok) permalink = String(r.permalink ?? "");
  }

  const projects = await projectOptions();
  const view = projects.length
    ? buildModal(
        JSON.stringify({ channelId, messageTs, slackUserId, permalink, messageText }),
        messageText,
        projects,
      )
    : noProjectsModal();

  await slack(cfg, "views.open", { trigger_id: triggerId, view });
  // Ack the interaction (empty 200).
  return new Response(null, { status: 200 });
}

async function handleViewSubmission(
  cfg: SlackConfig,
  payload: Record<string, any>,
): Promise<Response> {
  const meta = (() => {
    try {
      return JSON.parse(payload.view?.private_metadata ?? "{}");
    } catch {
      return {};
    }
  })();
  const values = payload.view?.state?.values ?? {};
  const name = String(values.name?.val?.value ?? "").trim();
  const projectId = values.project?.val?.selected_option?.value ?? "";
  const dueMs = msFromDate(values.due?.val?.selected_date);
  const notes = String(values.desc?.val?.value ?? "").trim();

  if (!projectId) {
    return Response.json({
      response_action: "errors",
      errors: { project: "Please choose a project." },
    });
  }
  if (!name) {
    return Response.json({
      response_action: "errors",
      errors: { name: "Please enter a task name." },
    });
  }

  const slackUserId = payload.user?.id ?? meta.slackUserId ?? "";
  const profileId = await profileForSlackUser(cfg, slackUserId);

  const permalink = meta.permalink ? `\n\nFrom Slack: ${meta.permalink}` : "";
  const description = (notes || String(meta.messageText ?? "")) + permalink;

  const now = Date.now();
  const { data: inserted, error } = await supabase
    .from("tasks")
    .insert({
      project_id: projectId,
      name: name.slice(0, 250),
      description: description || null,
      status: "todo",
      due_date: dueMs,
      assignee_id: profileId,
      owner_id: profileId,
      created_by_id: profileId,
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) {
    return Response.json({
      response_action: "errors",
      errors: { name: `Could not create task: ${error.message}` },
    });
  }

  // Best-effort confirmation back in Slack (ephemeral to the triggering user).
  const appUrl = cfg.app_url || APP_URL_FALLBACK;
  const taskUrl = `${appUrl}/tasks/${inserted?.id}`;
  if (meta.channelId && slackUserId) {
    try {
      await slack(cfg, "chat.postEphemeral", {
        channel: meta.channelId,
        user: slackUserId,
        text: `✅ Task created: <${taskUrl}|${name}>`,
      });
    } catch {
      // ignore — task is already created
    }
  }

  // Empty 200 closes the modal.
  return new Response(null, { status: 200 });
}

Deno.serve(async (req: Request) => {
  const rawBody = await req.text();
  const cfg = await getConfig();

  if (!cfg.signing_secret || !cfg.bot_token) {
    return new Response("Slack not configured", { status: 200 });
  }
  const valid = await verifySlackSignature(req, rawBody, cfg.signing_secret);
  if (!valid) return new Response("invalid signature", { status: 401 });

  // Interactivity payloads arrive form-encoded as payload=<json>.
  const params = new URLSearchParams(rawBody);
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(params.get("payload") ?? "{}");
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  try {
    if (
      payload.type === "message_action" &&
      payload.callback_id === SHORTCUT_CALLBACK
    ) {
      return await handleMessageAction(cfg, payload);
    }
    if (
      payload.type === "view_submission" &&
      payload.view?.callback_id === MODAL_CALLBACK
    ) {
      return await handleViewSubmission(cfg, payload);
    }
    // Anything else (other shortcuts, block_actions on our modal, etc.): ack.
    return new Response(null, { status: 200 });
  } catch (e) {
    console.error("slack-interactions error", e);
    return new Response(null, { status: 200 });
  }
});
