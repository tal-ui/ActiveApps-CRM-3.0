// Turns an edge-function error envelope into something worth reading.
//
// Lifted out of InvoiceActions once send-summary-email became a second caller:
// two copies of this decoder would drift, and the half that drifted would be
// the one showing a user why their invoice email didn't go out.
import { FunctionsHttpError } from "@supabase/supabase-js";

const MESSAGES: Record<string, string> = {
  not_configured:
    "Green Invoice isn't connected yet — add the API credentials in Settings → Tax Invoicing.",
  invalid_key: "Green Invoice rejected the API credentials.",
  smtp_not_configured:
    "Email sending isn't set up yet — add the Gmail app password in Settings → Email.",
  smtp_invalid_key:
    "Gmail rejected the app password. Regenerate it in your Google account and save it again in Settings → Email.",
  not_issued:
    "This invoice has no tax document yet. Issue it at Green Invoice first.",
  no_recipients: "Add at least one valid recipient address.",
  too_large:
    "The attachments are too large to email. Gmail refuses anything over 25 MB.",
  forbidden: "Only admins can email clients.",
};

export async function describeFunctionError(e: unknown): Promise<string> {
  if (e instanceof FunctionsHttpError) {
    let body: { error?: string; detail?: string } | null = null;
    try {
      body = (await e.context.json()) as { error?: string; detail?: string };
    } catch {
      /* error body wasn't JSON */
    }
    if (body?.error && MESSAGES[body.error]) return MESSAGES[body.error];
    if (body?.detail) {
      // Provider errors arrive as a JSON string; surface the message alone.
      try {
        const inner = JSON.parse(body.detail) as { errorMessage?: string };
        if (inner?.errorMessage) return `Green Invoice: ${inner.errorMessage}`;
      } catch {
        /* not nested JSON — show it as-is */
      }
      return body.detail;
    }
    return e.message;
  }
  return String((e as Error)?.message ?? e);
}
