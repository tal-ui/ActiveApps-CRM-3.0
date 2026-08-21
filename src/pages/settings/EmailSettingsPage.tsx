import { useEffect, useState } from "react";
import { Check, Mail } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import { describeFunctionError } from "../../lib/functionError";
import {
  fetchWorkspaceSettings,
  saveWorkspaceSettings,
} from "../../lib/workspaceSettings";
import {
  DEFAULT_EMAIL_BODY,
  DEFAULT_EMAIL_SUBJECT,
  PLACEHOLDER_HELP,
} from "../../lib/emailTemplate";
import DeliverabilityPanel from "../../components/DeliverabilityPanel";
import {
  Button,
  ConfirmModal,
  ErrorNote,
  FieldLabel,
  Input,
  Spinner,
  Textarea,
} from "../../components/ui";
import HelpButton from "../../components/HelpButton";

/**
 * How the monthly invoice email goes out: who it comes from, what it says, and
 * the Gmail app password that sends it.
 *
 * Kept apart from Tax Invoicing because this is correspondence rather than
 * compliance — and because it holds a password, it is admin-gated like Slack.
 */
export default function EmailSettingsPage() {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [senderName, setSenderName] = useState("");
  const [senderPhone, setSenderPhone] = useState("");
  const [senderEmail, setSenderEmail] = useState("");
  const [subjectTemplate, setSubjectTemplate] = useState(DEFAULT_EMAIL_SUBJECT);
  const [dkimSelector, setDkimSelector] = useState("");
  const [dmarcRua, setDmarcRua] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState(DEFAULT_EMAIL_BODY);

  // Gmail SMTP — integrations row key = "email_smtp". Same invariant as the
  // Green Invoice card: only id/connected are ever read here. The app password
  // is written and never selected by the browser, never rendered, and never
  // written into an audit payload.
  const [rowId, setRowId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [fromName, setFromName] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [defaultBcc, setDefaultBcc] = useState("");
  const [smtpBusy, setSmtpBusy] = useState(false);
  const [smtpError, setSmtpError] = useState("");
  const [smtpNote, setSmtpNote] = useState("");
  const [smtpSavedFlash, setSmtpSavedFlash] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);

  useEffect(() => {
    fetchWorkspaceSettings().then((s) => {
      setSenderName(s.emailSenderName);
      setSenderPhone(s.emailSenderPhone);
      setSenderEmail(s.emailSenderEmail);
      setSubjectTemplate(s.emailSubjectTemplate);
      setDkimSelector(s.emailDkimSelector);
      setDmarcRua(s.emailDmarcRua);
      setBodyTemplate(s.emailBodyTemplate);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    supabase
      .from("integrations")
      .select("id, connected")
      .eq("key", "email_smtp")
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setRowId(String(data.id));
          setConnected(Boolean(data.connected));
        }
      });
  }, []);

  async function save() {
    setBusy(true);
    setError("");
    const patch = {
      emailSenderName: senderName.trim(),
      emailSenderPhone: senderPhone.trim(),
      emailSenderEmail: senderEmail.trim(),
      emailDkimSelector: dkimSelector.trim(),
      emailDmarcRua: dmarcRua.trim(),
      emailSubjectTemplate: subjectTemplate,
      emailBodyTemplate: bodyTemplate,
    };
    const { error: err } = await saveWorkspaceSettings(patch);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "workspace_settings",
      entity_id: "default",
      summary: "Updated the client email sender and template",
      after: patch,
    });
  }

  async function saveSmtp() {
    const user = username.trim();
    const pass = appPassword.trim();
    // Both halves are required — a partial credential fails at Gmail with a
    // confusing error rather than here.
    if (!user || !pass) return;
    setSmtpBusy(true);
    setSmtpError("");
    setSmtpNote("");
    const config = {
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      username: user,
      app_password: pass,
      from_name: fromName.trim() || senderName.trim(),
      from_address: fromAddress.trim() || user,
      reply_to: replyTo.trim(),
      default_bcc: defaultBcc.trim(),
    };
    let err: string | null = null;
    let idForAudit = rowId;
    if (rowId) {
      const { error: e } = await supabase
        .from("integrations")
        .update({ connected: true, config, updated_at: Date.now() })
        .eq("id", rowId);
      err = e?.message ?? null;
    } else {
      const { data, error: e } = await supabase
        .from("integrations")
        .insert({
          key: "email_smtp",
          name: "Gmail SMTP",
          category: "email",
          connected: true,
          config,
          created_at: Date.now(),
          updated_at: Date.now(),
        })
        .select("id")
        .single();
      err = e?.message ?? null;
      if (data) {
        idForAudit = String((data as { id: string }).id);
        setRowId(idForAudit);
      }
    }
    setSmtpBusy(false);
    if (err) {
      setSmtpError(
        err.includes("policy")
          ? "Only admins can change integration settings."
          : err,
      );
      return;
    }
    setConnected(true);
    // Cleared so the password does not linger in React state.
    setAppPassword("");
    setSmtpSavedFlash(true);
    setTimeout(() => setSmtpSavedFlash(false), 2000);
    // Summary only — credentials never enter the audit payload.
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "integration",
      entity_id: idForAudit,
      summary: "Gmail SMTP credentials updated",
    });
  }

  /** Connects and authenticates without sending anything. */
  async function verifySmtp() {
    setSmtpBusy(true);
    setSmtpError("");
    setSmtpNote("");
    const { error: e } = await supabase.functions.invoke("send-summary-email", {
      body: { test: true },
    });
    setSmtpBusy(false);
    if (e) {
      setSmtpError(await describeFunctionError(e));
      return;
    }
    setSmtpNote("Gmail accepted the app password. Nothing was sent.");
  }

  /** One real message, to yourself — proves delivery, not just credentials. */
  async function sendTestToSelf() {
    const target = profile?.email ?? "";
    if (!target) return;
    setSmtpBusy(true);
    setSmtpError("");
    setSmtpNote("");
    const { error: e } = await supabase.functions.invoke("send-summary-email", {
      body: { test: true, testTo: target },
    });
    setSmtpBusy(false);
    if (e) {
      setSmtpError(await describeFunctionError(e));
      return;
    }
    setSmtpNote(`Test message sent to ${target}.`);
  }

  async function disconnectSmtp() {
    if (!rowId) return;
    setSmtpBusy(true);
    setSmtpError("");
    const { error: e } = await supabase
      .from("integrations")
      .update({ connected: false, config: {}, updated_at: Date.now() })
      .eq("id", rowId);
    setSmtpBusy(false);
    setShowDisconnect(false);
    if (e) {
      setSmtpError(
        e.message.includes("policy")
          ? "Only admins can change integration settings."
          : e.message,
      );
      return;
    }
    setConnected(false);
    setUsername("");
    setAppPassword("");
    setSmtpNote("");
    void insertAudit(profile, {
      action: "settings_update",
      entity_type: "integration",
      entity_id: rowId,
      summary: "Gmail SMTP disconnected",
    });
  }

  if (loading) return <Spinner />;

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
            <Mail size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
                Email
              </h1>
              <HelpButton topic="/settings/email" />
            </div>
            <p className="label-mono">sender, template & Gmail</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {saved && (
            <span className="inline-flex items-center gap-1.5 text-sm text-[var(--mint)]">
              <Check size={15} strokeWidth={2} />
              Saved
            </span>
          )}
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4">
        <div>
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Sender
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel>Name</FieldLabel>
            <Input
              value={senderName}
              onChange={(e) => setSenderName(e.target.value)}
              placeholder="Tal Oryon"
            />
          </div>
          <div>
            <FieldLabel>Phone</FieldLabel>
            <Input
              value={senderPhone}
              onChange={(e) => setSenderPhone(e.target.value)}
              placeholder="+972 52 8855779"
            />
          </div>
          <div>
            <FieldLabel>Email</FieldLabel>
            <Input
              value={senderEmail}
              onChange={(e) => setSenderEmail(e.target.value)}
              placeholder="tal@techrider.co.il"
            />
          </div>
        </div>
      </section>

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4 mt-6">
        <div>
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Monthly Invoice Template
          </h3>
        </div>
        <div>
          <FieldLabel>Subject</FieldLabel>
          <Input
            value={subjectTemplate}
            onChange={(e) => setSubjectTemplate(e.target.value)}
          />
        </div>
        <div>
          <FieldLabel>Body</FieldLabel>
          <Textarea
            rows={16}
            value={bodyTemplate}
            onChange={(e) => setBodyTemplate(e.target.value)}
            className="font-[var(--font-mono)] text-xs"
          />
        </div>
        <div>
          <p className="label-mono mb-2">Placeholders</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {PLACEHOLDER_HELP.map((p) => (
              <p key={p.key} className="text-xs text-[var(--text-faint)]">
                <span className="font-[var(--font-mono)] text-[var(--text-mid)]">
                  {`{{${p.key}}}`}
                </span>{" "}
                — {p.describes}
              </p>
            ))}
          </div>
          <p className="text-xs text-[var(--text-faint)] mt-2">
            A placeholder that resolves to nothing blocks the send, so an
            invoice email can never go out reading “Amount:  + VAT”.
          </p>
        </div>
      </section>

      <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4 mt-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
              Gmail (SMTP)
            </h3>
          </div>
          <span
            className={`label-mono ${connected ? "text-[var(--mint)]" : "text-[var(--text-faint)]"}`}
          >
            {connected ? "connected" : "not connected"}
          </span>
        </div>

        {smtpError && <ErrorNote message={smtpError} />}
        {smtpNote && (
          <p className="text-sm text-[var(--mint)]">{smtpNote}</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Gmail Address</FieldLabel>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="tal@techrider.co.il"
              autoComplete="off"
            />
          </div>
          <div>
            <FieldLabel>App Password</FieldLabel>
            <Input
              type="password"
              value={appPassword}
              onChange={(e) => setAppPassword(e.target.value)}
              placeholder={connected ? "••••••••" : "16 characters from Google"}
              autoComplete="new-password"
            />
          </div>
          <div>
            <FieldLabel>From Name</FieldLabel>
            <Input
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
              placeholder={senderName || "Tal Oryon"}
            />
          </div>
          <div>
            <FieldLabel>From Address</FieldLabel>
            <Input
              value={fromAddress}
              onChange={(e) => setFromAddress(e.target.value)}
              placeholder="defaults to the Gmail address"
            />
          </div>
          <div>
            <FieldLabel>Reply-To</FieldLabel>
            <Input
              value={replyTo}
              onChange={(e) => setReplyTo(e.target.value)}
              placeholder="defaults to the From address"
            />
          </div>
          <div>
            <FieldLabel>Always BCC</FieldLabel>
            <Input
              value={defaultBcc}
              onChange={(e) => setDefaultBcc(e.target.value)}
              placeholder="tal@techrider.co.il"
            />
            <p className="text-xs text-[var(--text-faint)] mt-1.5">
              Gmail does not file SMTP messages in Sent, so this copy is your
              archive — and your proof the message really went.
            </p>
          </div>
        </div>

        {connected && (
          <p className="text-sm text-[var(--text-mid)]">
            App password:{" "}
            <span className="font-[var(--font-mono)]">••••••••</span>
          </p>
        )}

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            onClick={saveSmtp}
            disabled={smtpBusy || !username.trim() || !appPassword.trim()}
          >
            {smtpSavedFlash ? "Saved" : connected ? "Update" : "Connect"}
          </Button>
          <Button
            variant="ghost"
            onClick={verifySmtp}
            disabled={smtpBusy || !connected}
          >
            Verify
          </Button>
          <Button
            variant="ghost"
            onClick={sendTestToSelf}
            disabled={smtpBusy || !connected || !profile?.email}
          >
            Send test to me
          </Button>
          {connected && (
            <Button
              variant="subtle"
              onClick={() => setShowDisconnect(true)}
              disabled={smtpBusy}
            >
              Disconnect
            </Button>
          )}
        </div>
      </section>

      <DeliverabilityPanel
        dkimSelector={dkimSelector}
        dmarcRua={dmarcRua}
        onSelectorChange={setDkimSelector}
        onRuaChange={setDmarcRua}
      />

      {showDisconnect && (
        <ConfirmModal
          title="Disconnect Gmail"
          confirmLabel="Disconnect"
          destructive
          busy={smtpBusy}
          onConfirm={disconnectSmtp}
          onClose={() => setShowDisconnect(false)}
        >
          <p>
            This removes the stored app password. Emails already sent are
            unaffected, but no invoice email can go out until Gmail is connected
            again.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
