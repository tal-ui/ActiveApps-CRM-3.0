import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { OBJECTS } from "../lib/objects";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
} from "./ui";

export interface WebhookRow {
  id: string;
  name: string;
  url: string;
  events: string[] | null;
  enabled: boolean;
  last_delivery: number | null;
}

// Events the DB dispatcher can emit — object.created / object.updated
const EVENT_OBJECTS = [
  "leads",
  "accounts",
  "contacts",
  "opportunities",
  "projects",
  "tasks",
  "invoices",
  "quotes",
  "time_entries",
];

function newSecret(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function WebhookForm({
  webhook,
  onClose,
  onSaved,
}: {
  webhook: WebhookRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const isEdit = !!webhook;

  const [name, setName] = useState(webhook?.name ?? "");
  const [url, setUrl] = useState(webhook?.url ?? "");
  const [events, setEvents] = useState<string[]>(webhook?.events ?? []);
  const [secret, setSecret] = useState(isEdit ? "" : newSecret());
  const [addObject, setAddObject] = useState("opportunities");
  const [addWhen, setAddWhen] = useState("updated");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  function addEvent() {
    const e = `${addObject}.${addWhen}`;
    setEvents((prev) => (prev.includes(e) ? prev : [...prev, e]));
  }

  async function save() {
    if (!name.trim() || !url.trim()) {
      setError("Name and URL are required.");
      return;
    }
    if (!/^https:\/\//i.test(url.trim())) {
      setError("URL must start with https://");
      return;
    }
    setBusy(true);
    setError("");
    const now = Date.now();
    const base = {
      name: name.trim(),
      url: url.trim(),
      events,
      updated_at: now,
    };

    if (isEdit) {
      // Only overwrite the secret when a new one was generated
      const payload = secret ? { ...base, secret } : base;
      const { error: err } = await supabase
        .from("webhooks")
        .update(payload)
        .eq("id", webhook!.id);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      void insertAudit(profile, {
        action: "update",
        entity_type: "webhook",
        entity_id: webhook!.id,
        summary: `Updated webhook "${base.name}"`,
      });
    } else {
      const { data, error: err } = await supabase
        .from("webhooks")
        .insert({
          ...base,
          secret,
          enabled: true,
          created_by_id: profile?.id ?? "system",
          created_at: now,
        })
        .select("id")
        .single();
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      void insertAudit(profile, {
        action: "create",
        entity_type: "webhook",
        entity_id: (data as { id: string }).id,
        summary: `Created webhook "${base.name}"`,
      });
    }
    onSaved();
  }

  return (
    <Modal title={isEdit ? "Edit Webhook" : "New Webhook"} onClose={onClose}>
      <div className="space-y-4">
        {error && <ErrorNote message={error} />}

        <div>
          <FieldLabel required>Name</FieldLabel>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Make — deal pipeline"
            autoFocus
          />
        </div>
        <div>
          <FieldLabel required>Endpoint URL</FieldLabel>
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hook.eu2.make.com/…"
          />
          <p className="text-[0.68rem] text-[var(--text-faint)] mt-1">
            Paste the webhook URL from your Make scenario (or any HTTPS endpoint).
          </p>
        </div>

        <div>
          <FieldLabel>Subscribed events</FieldLabel>
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Select
              value={addObject}
              onChange={(e) => setAddObject(e.target.value)}
              className="!w-auto flex-1 min-w-[9rem]"
            >
              {EVENT_OBJECTS.map((o) => (
                <option key={o} value={o}>
                  {OBJECTS[o]?.plural ?? o}
                </option>
              ))}
            </Select>
            <Select
              value={addWhen}
              onChange={(e) => setAddWhen(e.target.value)}
              className="!w-auto min-w-[7rem]"
            >
              <option value="created">created</option>
              <option value="updated">updated</option>
            </Select>
            <Button variant="ghost" className="!px-3 !py-2" onClick={addEvent}>
              Add
            </Button>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">
              No direct subscriptions — this endpoint will only fire when an
              automation rule targets it.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {events.map((e) => (
                <span
                  key={e}
                  className="inline-flex items-center gap-1.5 bg-[var(--navy-surface)] border border-[rgba(255,255,255,0.12)] rounded-full px-3 py-1 font-[var(--font-mono)] text-xs text-[var(--text-mid)]"
                >
                  {e}
                  <button
                    onClick={() => setEvents((prev) => prev.filter((x) => x !== e))}
                    className="text-[var(--text-dim)] hover:text-[#F2697A] cursor-pointer"
                    aria-label={`Remove ${e}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div>
          <FieldLabel>Signing secret</FieldLabel>
          <div className="flex items-center gap-2">
            <Input
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={isEdit ? "Unchanged — generate to rotate" : ""}
              className="font-[var(--font-mono)] !text-xs"
            />
            <Button
              variant="ghost"
              className="!px-3 !py-2 shrink-0"
              onClick={() => setSecret(newSecret())}
            >
              <RefreshCw size={14} strokeWidth={1.5} />
              {isEdit ? "Rotate" : "New"}
            </Button>
          </div>
          <p className="text-[0.68rem] text-[var(--text-faint)] mt-1">
            Payloads are signed with HMAC-SHA256 in the{" "}
            <span className="font-[var(--font-mono)]">X-AACRM-Signature</span> header.
            Copy this secret now — it isn't shown again.
          </p>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save Webhook" : "Create Webhook"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
