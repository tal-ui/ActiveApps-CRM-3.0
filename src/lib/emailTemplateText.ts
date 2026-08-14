// The default monthly invoice email, as plain constants with no imports.
//
// Kept apart from emailTemplate.ts so workspaceSettings.ts can fall back to
// these defaults without an import cycle (emailTemplate needs the settings
// type; settings needs the default text).

export const DEFAULT_EMAIL_SUBJECT =
  "Invoice # {{doc_number}} - {{sender_name}} - {{month_year}}";

export const DEFAULT_EMAIL_BODY = `Hi {{client_short_name}} team,

Please find attached the invoice for {{month_year}}, along with a detailed breakdown of the hours worked.

Invoice Details:
• Invoice #: {{doc_number}}
• Amount: {{amount_net}} + VAT
• Billing Period: {{period_start}} - {{period_end}}


Best Regards,
{{sender_name}}
Cell. {{sender_phone}}
Email. {{sender_email}}`;
