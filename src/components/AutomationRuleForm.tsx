import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { NAV_OBJECTS, OBJECTS, type FieldDef } from "../lib/objects";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Textarea,
} from "./ui";

export interface RuleCondition {
  field: string;
  op: string;
  value?: string;
}

export interface RuleAction {
  type: string;
  webhook_id?: string;
  field?: string;
  value?: string;
  task_name?: string;
  due_in_days?: number;
  message?: string;
  channel?: string;
}

export interface AutomationRule {
  id: string;
  name: string;
  description: string | null;
  object_name: string | null;
  trigger_event: string;
  trigger_field: string | null;
  conditions: { match?: string; rules?: RuleCondition[] } | null;
  actions: RuleAction[] | null;
  enabled: boolean;
}

// Objects the DB dispatcher has triggers on (see the automation_engine
// migration) — keep in sync if that list changes.
const AUTOMATABLE = [
  "leads",
  "accounts",
  "contacts",
  "opportunities",
  "projects",
  "tasks",
  "invoices",
  "quotes",
  "time_entries",
].filter((o) => NAV_OBJECTS.includes(o) || OBJECTS[o]);

const TRIGGERS = [
  { value: "created", label: "Record is created" },
  { value: "updated", label: "Record is updated" },
  { value: "field_changed", label: "A field changes" },
];

const CONDITION_OPS = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "not equals" },
  { value: "contains", label: "contains" },
  { value: "ncontains", label: "doesn't contain" },
  { value: "gt", label: "greater than" },
  { value: "lt", label: "less than" },
  { value: "is_empty", label: "is empty" },
  { value: "is_not_empty", label: "is not empty" },
];

const ACTION_TYPES = [
  { value: "webhook", label: "Send webhook (Make, Zapier…)" },
  { value: "slack", label: "Post to Slack" },
  { value: "notify", label: "In-app notification" },
  { value: "create_task", label: "Create a task" },
  { value: "update_field", label: "Update a field" },
];

interface WebhookOption {
  id: string;
  name: string;
}

export default function AutomationRuleForm({
  rule,
  webhooks,
  onClose,
  onSaved,
}: {
  rule: AutomationRule | null;
  webhooks: WebhookOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { profile } = useAuth();
  const isEdit = !!rule;

  const [name, setName] = useState(rule?.name ?? "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [objectName, setObjectName] = useState(rule?.object_name ?? "opportunities");
  const [trigger, setTrigger] = useState(rule?.trigger_event ?? "created");
  const [triggerField, setTriggerField] = useState(rule?.trigger_field ?? "");
  const [match, setMatch] = useState(rule?.conditions?.match ?? "all");
  const [conditions, setConditions] = useState<RuleCondition[]>(
    rule?.conditions?.rules ?? [],
  );
  const [actions, setActions] = useState<RuleAction[]>(
    rule?.actions?.length ? rule.actions : [{ type: "webhook" }],
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const fields: FieldDef[] = useMemo(
    () => (OBJECTS[objectName]?.fields ?? []).filter((f) => !f.hidden),
    [objectName],
  );

  // Reset field references when the object changes
  useEffect(() => {
    if (!isEdit) {
      setTriggerField("");
      setConditions([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectName]);

  function setAction(i: number, patch: Partial<RuleAction>) {
    setActions((prev) => prev.map((a, j) => (j === i ? { ...a, ...patch } : a)));
  }

  async function save() {
    if (!name.trim()) {
      setError("Give the rule a name.");
      return;
    }
    if (trigger === "field_changed" && !triggerField) {
      setError("Pick the field to watch.");
      return;
    }
    if (actions.length === 0) {
      setError("Add at least one action.");
      return;
    }
    for (const a of actions) {
      if (a.type === "webhook" && !a.webhook_id) {
        setError("Pick a webhook endpoint for the webhook action.");
        return;
      }
      if (a.type === "update_field" && !a.field) {
        setError("Pick the field to update.");
        return;
      }
    }

    setBusy(true);
    setError("");
    const now = Date.now();
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      object_name: objectName,
      trigger_event: trigger,
      trigger_field: trigger === "field_changed" ? triggerField : null,
      conditions: { match, rules: conditions.filter((c) => c.field) },
      actions,
      updated_at: now,
    };

    if (isEdit) {
      const { error: err } = await supabase
        .from("automation_rules")
        .update(payload)
        .eq("id", rule!.id);
      setBusy(false);
      if (err) {
        setError(err.message);
        return;
      }
      void insertAudit(profile, {
        action: "update",
        entity_type: "automation_rule",
        entity_id: rule!.id,
        summary: `Updated automation rule "${payload.name}"`,
      });
    } else {
      const { data, error: err } = await supabase
        .from("automation_rules")
        .insert({
          ...payload,
          enabled: true,
          run_count: 0,
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
        entity_type: "automation_rule",
        entity_id: (data as { id: string }).id,
        summary: `Created automation rule "${payload.name}"`,
      });
    }
    onSaved();
  }

  return (
    <Modal title={isEdit ? "Edit Rule" : "New Rule"} onClose={onClose} wide>
      <div className="space-y-5 max-h-[70vh] overflow-y-auto pr-1">
        {error && <ErrorNote message={error} />}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel required>Rule Name</FieldLabel>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Notify Make when a deal is won"
              autoFocus
            />
          </div>
          <div>
            <FieldLabel>Description</FieldLabel>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        {/* Trigger */}
        <section className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-4">
          <p className="label-mono mb-3">When</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <FieldLabel>Object</FieldLabel>
              <Select
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
              >
                {AUTOMATABLE.map((o) => (
                  <option key={o} value={o}>
                    {OBJECTS[o]?.plural ?? o}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <FieldLabel>Trigger</FieldLabel>
              <Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
                {TRIGGERS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            {trigger === "field_changed" && (
              <div>
                <FieldLabel required>Field</FieldLabel>
                <Select
                  value={triggerField}
                  onChange={(e) => setTriggerField(e.target.value)}
                >
                  <option value="">Select…</option>
                  {fields.map((f) => (
                    <option key={f.name} value={f.name}>
                      {f.label}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>
        </section>

        {/* Conditions */}
        <section className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="label-mono">
              And only if{" "}
              {conditions.length > 0 && (
                <Select
                  value={match}
                  onChange={(e) => setMatch(e.target.value)}
                  className="!inline-block !w-auto !py-0.5 !px-2 ml-1 !text-xs"
                >
                  <option value="all">all match</option>
                  <option value="any">any match</option>
                </Select>
              )}
            </p>
            <Button
              variant="ghost"
              className="!px-3 !py-1"
              onClick={() =>
                setConditions((c) => [...c, { field: "", op: "eq", value: "" }])
              }
            >
              <Plus size={13} strokeWidth={2} />
              Condition
            </Button>
          </div>
          {conditions.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">
              No conditions — the rule runs on every matching event.
            </p>
          ) : (
            <div className="space-y-2">
              {conditions.map((c, i) => {
                const fd = fields.find((f) => f.name === c.field);
                const needsValue = c.op !== "is_empty" && c.op !== "is_not_empty";
                return (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <Select
                      value={c.field}
                      onChange={(e) =>
                        setConditions((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, field: e.target.value } : x,
                          ),
                        )
                      }
                      className="!w-auto min-w-[9rem] flex-1"
                    >
                      <option value="">Field…</option>
                      {fields.map((f) => (
                        <option key={f.name} value={f.name}>
                          {f.label}
                        </option>
                      ))}
                    </Select>
                    <Select
                      value={c.op}
                      onChange={(e) =>
                        setConditions((prev) =>
                          prev.map((x, j) =>
                            j === i ? { ...x, op: e.target.value } : x,
                          ),
                        )
                      }
                      className="!w-auto min-w-[8rem]"
                    >
                      {CONDITION_OPS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                    {needsValue &&
                      (fd?.type === "picklist" ? (
                        <Select
                          value={c.value ?? ""}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, value: e.target.value } : x,
                              ),
                            )
                          }
                          className="!w-auto min-w-[8rem] flex-1"
                        >
                          <option value="">Value…</option>
                          {(fd.options ?? []).map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Input
                          value={c.value ?? ""}
                          onChange={(e) =>
                            setConditions((prev) =>
                              prev.map((x, j) =>
                                j === i ? { ...x, value: e.target.value } : x,
                              ),
                            )
                          }
                          placeholder="Value"
                          className="!w-auto min-w-[8rem] flex-1"
                        />
                      ))}
                    <button
                      onClick={() =>
                        setConditions((prev) => prev.filter((_, j) => j !== i))
                      }
                      className="text-[var(--text-faint)] hover:text-[#F2697A] cursor-pointer transition-colors p-2"
                      aria-label="Remove condition"
                    >
                      <Trash2 size={14} strokeWidth={1.5} />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Actions */}
        <section className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="label-mono">Then</p>
            <Button
              variant="ghost"
              className="!px-3 !py-1"
              onClick={() => setActions((a) => [...a, { type: "webhook" }])}
            >
              <Plus size={13} strokeWidth={2} />
              Action
            </Button>
          </div>
          <div className="space-y-3">
            {actions.map((a, i) => (
              <div
                key={i}
                className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3"
              >
                <div className="flex items-start gap-2">
                  <Select
                    value={a.type}
                    onChange={(e) => setActions((prev) => prev.map((x, j) => (j === i ? { type: e.target.value } : x)))}
                    className="flex-1"
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                  <button
                    onClick={() => setActions((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[var(--text-faint)] hover:text-[#F2697A] cursor-pointer transition-colors p-2"
                    aria-label="Remove action"
                  >
                    <Trash2 size={14} strokeWidth={1.5} />
                  </button>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {a.type === "webhook" && (
                    <div className="sm:col-span-2">
                      <FieldLabel required>Endpoint</FieldLabel>
                      <Select
                        value={a.webhook_id ?? ""}
                        onChange={(e) => setAction(i, { webhook_id: e.target.value })}
                      >
                        <option value="">Select webhook…</option>
                        {webhooks.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                  )}

                  {(a.type === "slack" || a.type === "notify") && (
                    <div className="sm:col-span-2">
                      <FieldLabel>Message</FieldLabel>
                      <Textarea
                        rows={2}
                        value={a.message ?? ""}
                        onChange={(e) => setAction(i, { message: e.target.value })}
                        placeholder="Deal {{name}} moved to {{stage}}"
                      />
                      <p className="text-[0.68rem] text-[var(--text-faint)] mt-1">
                        Use {"{{field_name}}"} to insert values from the record.
                      </p>
                    </div>
                  )}

                  {a.type === "create_task" && (
                    <>
                      <div>
                        <FieldLabel>Task Name</FieldLabel>
                        <Input
                          value={a.task_name ?? ""}
                          onChange={(e) => setAction(i, { task_name: e.target.value })}
                          placeholder="Follow up on {{name}}"
                        />
                      </div>
                      <div>
                        <FieldLabel>Due in (days)</FieldLabel>
                        <Input
                          type="number"
                          value={a.due_in_days ?? ""}
                          onChange={(e) =>
                            setAction(i, {
                              due_in_days: e.target.value ? Number(e.target.value) : undefined,
                            })
                          }
                          placeholder="3"
                        />
                      </div>
                    </>
                  )}

                  {a.type === "update_field" && (
                    <>
                      <div>
                        <FieldLabel required>Field</FieldLabel>
                        <Select
                          value={a.field ?? ""}
                          onChange={(e) => setAction(i, { field: e.target.value })}
                        >
                          <option value="">Select…</option>
                          {fields
                            .filter((f) => !f.readOnly)
                            .map((f) => (
                              <option key={f.name} value={f.name}>
                                {f.label}
                              </option>
                            ))}
                        </Select>
                      </div>
                      <div>
                        <FieldLabel>Value</FieldLabel>
                        <Input
                          value={a.value ?? ""}
                          onChange={(e) => setAction(i, { value: e.target.value })}
                          placeholder="New value"
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="flex justify-end gap-3 pt-1">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? "Saving…" : isEdit ? "Save Rule" : "Create Rule"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
