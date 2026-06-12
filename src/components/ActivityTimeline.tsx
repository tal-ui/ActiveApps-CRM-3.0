import { useEffect, useState, type FormEvent } from "react";
import {
  CalendarClock,
  Mail,
  MessageSquare,
  Phone,
  StickyNote,
  Trash2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDateTime, titleCase } from "../lib/format";
import { Button, EmptyState, FieldLabel, Input, Select, Textarea } from "./ui";

const TYPE_ICONS: Record<string, typeof StickyNote> = {
  note: StickyNote,
  call: Phone,
  email: Mail,
  meeting: CalendarClock,
  other: MessageSquare,
};

interface Activity {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  date: number;
  duration: number | null;
}

export default function ActivityTimeline({
  relatedToType,
  relatedToId,
}: {
  relatedToType: string;
  relatedToId: string;
}) {
  const { profile } = useAuth();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [type, setType] = useState("note");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    supabase
      .from("activities")
      .select("id, type, subject, body, date, duration")
      .eq("related_to_type", relatedToType)
      .eq("related_to_id", relatedToId)
      .order("date", { ascending: false })
      .limit(100)
      .then(({ data }) => setActivities((data ?? []) as Activity[]));
  }, [relatedToType, relatedToId, reload]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim()) return;
    setBusy(true);
    await supabase.from("activities").insert({
      type,
      subject: subject.trim(),
      body: body.trim() || null,
      date: Date.now(),
      related_to_type: relatedToType,
      related_to_id: relatedToId,
      owner_id: profile?.id ?? "system",
      created_by_id: profile?.id ?? "system",
      created_at: Date.now(),
      updated_at: Date.now(),
    });
    setBusy(false);
    setSubject("");
    setBody("");
    setReload((r) => r + 1);
  }

  async function remove(id: string) {
    await supabase.from("activities").delete().eq("id", id);
    setReload((r) => r + 1);
  }

  return (
    <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <MessageSquare size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
        <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
          Activity
        </h3>
        <span className="label-mono">({activities.length})</span>
      </div>

      {/* Quick log form */}
      <form
        onSubmit={onSubmit}
        className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.04)] rounded-[var(--radius-md)] p-4 mb-5 space-y-3"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <FieldLabel>Type</FieldLabel>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              {["note", "call", "email", "meeting", "other"].map((t) => (
                <option key={t} value={t}>
                  {titleCase(t)}
                </option>
              ))}
            </Select>
          </div>
          <div className="sm:col-span-2">
            <FieldLabel>Subject</FieldLabel>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="e.g. Intro call with CTO"
            />
          </div>
        </div>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Notes (optional)…"
          rows={2}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={busy || !subject.trim()} className="!py-1.5">
            {busy ? "Logging…" : "Log Activity"}
          </Button>
        </div>
      </form>

      {/* Timeline */}
      {activities.length === 0 ? (
        <EmptyState message="No activity logged yet." />
      ) : (
        <ul className="space-y-3">
          {activities.map((a) => {
            const Icon = TYPE_ICONS[a.type] ?? MessageSquare;
            return (
              <li
                key={a.id}
                className="flex gap-3 group border-b border-[rgba(255,255,255,0.04)] last:border-b-0 pb-3 last:pb-0"
              >
                <div className="w-8 h-8 shrink-0 rounded-[var(--radius-sm)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.15)] flex items-center justify-center">
                  <Icon size={14} strokeWidth={1.5} className="text-[var(--mint)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-[var(--foreground)] font-medium truncate">
                      {a.subject}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="label-mono">{fmtDateTime(a.date)}</span>
                      <button
                        onClick={() => remove(a.id)}
                        className="opacity-0 group-hover:opacity-100 text-[var(--text-faint)] hover:text-[var(--destructive)] cursor-pointer transition-all p-0.5"
                        title="Delete"
                      >
                        <Trash2 size={13} strokeWidth={1.5} />
                      </button>
                    </div>
                  </div>
                  {a.body && (
                    <p className="text-sm text-[var(--text-dim)] mt-0.5 whitespace-pre-wrap">
                      {a.body}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
