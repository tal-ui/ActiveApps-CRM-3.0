import { useCallback, useEffect, useState } from "react";
import { Check, Copy, ShieldCheck } from "lucide-react";
import { copyText } from "../lib/clipboard";
import {
  DKIM_INSTRUCTIONS,
  buildDmarcRecord,
  buildSpfRecord,
  evaluate,
  fetchEmailAuth,
  parseAuthResults,
  type AuthCheck,
  type AuthRecords,
  type AuthStatus,
  type SuggestedRecord,
} from "../lib/emailAuth";
import { Button, ErrorNote, FieldLabel, Input, Textarea } from "./ui";

const TONE: Record<AuthStatus, { dot: string; text: string; label: string }> = {
  pass: { dot: "bg-[var(--mint)]", text: "text-[var(--mint)]", label: "pass" },
  warn: { dot: "bg-[#D9B96A]", text: "text-[#D9B96A]", label: "needs work" },
  fail: { dot: "bg-[#F2697A]", text: "text-[#F2697A]", label: "missing" },
  unknown: {
    dot: "bg-[var(--text-faint)]",
    text: "text-[var(--text-faint)]",
    label: "unknown",
  },
};

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="shrink-0 text-[var(--text-faint)] hover:text-[var(--mint)] transition-colors"
      title="Copy"
      onClick={async () => {
        if (await copyText(value)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check size={13} strokeWidth={2} /> : <Copy size={13} strokeWidth={2} />}
    </button>
  );
}

function RecordToPaste({
  record,
  domain,
}: {
  record: SuggestedRecord;
  domain: string;
}) {
  // Both host forms, because cPanel-style editors disagree about whether the
  // Host field is relative or absolute, and the classic result of guessing is
  // _dmarc.example.com.example.com.
  const absolute =
    record.host === "@" ? `${domain}.` : `${record.host}.${domain}.`;
  const rows: [string, string][] = [
    ["Type", record.type],
    ["Host (relative)", record.host],
    ["Host (absolute)", absolute],
    ["Value", record.value],
  ];
  return (
    <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] p-3 space-y-1.5">
      <p className="label-mono">Publish this record</p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start gap-2">
          <span className="text-xs text-[var(--text-faint)] w-32 shrink-0 pt-0.5">
            {label}
          </span>
          <span className="font-[var(--font-mono)] text-xs text-[var(--text-light)] break-all flex-1">
            {value}
          </span>
          <CopyButton value={value} />
        </div>
      ))}
    </div>
  );
}

function Row({
  name,
  check,
  children,
}: {
  name: string;
  check: AuthCheck;
  children?: React.ReactNode;
}) {
  const tone = TONE[check.status];
  return (
    <div className="py-3 border-t border-[rgba(255,255,255,0.06)] first:border-t-0">
      <div className="flex items-center gap-2.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${tone.dot}`} />
        <span className="label-mono">{name}</span>
        <span className={`text-xs ${tone.text}`}>{tone.label}</span>
      </div>
      <p className="text-sm text-[var(--text-mid)] mt-1.5">{check.detail}</p>
      {check.record && (
        <p className="mt-2 font-[var(--font-mono)] text-xs text-[var(--text-faint)] break-all bg-[var(--section-darker)] rounded-[var(--radius-md)] p-2">
          {check.record}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * Whether a recipient's mail server can tell a message really came from you.
 *
 * The CRM cannot publish these records — they are DNS, and they live at the
 * domain's nameservers. What it can do is say precisely what is missing, hand
 * over the exact value to paste, and check again afterwards.
 */
export default function DeliverabilityPanel({
  dkimSelector,
  dmarcRua,
  onSelectorChange,
  onRuaChange,
}: {
  dkimSelector: string;
  dmarcRua: string;
  onSelectorChange: (selector: string) => void;
  onRuaChange: (rua: string) => void;
}) {
  const [records, setRecords] = useState<AuthRecords | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adHoc, setAdHoc] = useState("");
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);

  const run = useCallback(
    async (domain?: string, force = true) => {
      setLoading(true);
      setError("");
      const r = await fetchEmailAuth({ domain, dkimSelector, force });
      setLoading(false);
      if (!r) {
        setError(
          "Could not check DNS just now. That says nothing about your records — try again.",
        );
        return;
      }
      setRecords(r);
    },
    [dkimSelector],
  );

  useEffect(() => {
    void run(undefined, false);
  }, [run]);

  const checked = records?.domain ?? "";
  const isOwn = !!records?.fromDomain && checked === records.fromDomain;
  const verdicts = records ? evaluate(records, { knownSelector: dkimSelector }) : null;
  const parsed = pasted.trim() ? parseAuthResults(pasted) : null;

  return (
    <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 space-y-4 mt-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <ShieldCheck
            size={18}
            strokeWidth={1.5}
            className="text-[var(--mint)] mt-0.5"
          />
          <div>
            <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
              Deliverability
            </h3>
            <p className="text-xs text-[var(--text-faint)] mt-1">
              Whether a recipient's mail server can tell this really came from
              you. These are DNS records — the CRM can tell you what to publish,
              but only your DNS host can publish them.
            </p>
          </div>
        </div>
        <Button variant="ghost" onClick={() => void run(adHoc || undefined)} disabled={loading}>
          {loading ? "Checking…" : "Re-check"}
        </Button>
      </div>

      {error && <ErrorNote message={error} />}

      {records && (
        <>
          <p className="text-xs text-[var(--text-faint)]">
            Checked <span className="text-[var(--text-mid)]">{checked}</span>
            {isOwn
              ? " — the domain in your From address."
              : " — an ad-hoc lookup, not your sending domain."}{" "}
            {new Date(records.checkedAt).toLocaleTimeString()}
          </p>

          {!isOwn && (
            <p className="text-xs text-[#D9B96A] border border-[rgba(217,185,106,0.3)] bg-[rgba(217,185,106,0.06)] rounded-[var(--radius-md)] p-2">
              Showing {checked}, which is not the domain you send from
              {records.fromDomain ? ` (${records.fromDomain})` : ""}.{" "}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setAdHoc("");
                  void run(undefined);
                }}
              >
                Back to my domain
              </button>
            </p>
          )}

          {records.resolversDisagree && (
            <p className="text-xs text-[#D9B96A]">
              The two public resolvers disagree about this domain, which
              normally means a change is still spreading. Give it an hour.
            </p>
          )}

          <div>
            <Row name="SPF" check={verdicts!.spf}>
              {verdicts!.spf.status !== "pass" && isOwn && (
                <RecordToPaste record={buildSpfRecord()} domain={checked} />
              )}
            </Row>

            <Row name="DKIM" check={verdicts!.dkim}>
              {verdicts!.dkim.status !== "pass" && isOwn && (
                <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--section-darker)] border border-[rgba(255,255,255,0.05)] p-3 space-y-2">
                  <p className="text-xs text-[var(--text-mid)]">
                    This is the one record we cannot write for you. Its value is
                    a public key whose private half lives inside Google, so
                    nobody outside Google can produce a usable pair.
                  </p>
                  <ol className="text-xs text-[var(--text-faint)] list-decimal ml-4 space-y-0.5">
                    {DKIM_INSTRUCTIONS.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p className="text-xs text-[var(--text-faint)]">
                    Until then Google still signs your mail — with its own
                    generic key, not your domain's. Gmail will say “dkim=pass”
                    while DMARC still counts the message as unsigned.
                  </p>
                </div>
              )}
              <button
                type="button"
                className="text-xs text-[var(--mint)] underline mt-2"
                onClick={() => setShowPaste((v) => !v)}
              >
                {showPaste ? "Hide" : "Settle it with a real message"}
              </button>
              {showPaste && (
                <div className="mt-2 space-y-2">
                  <FieldLabel>
                    Paste the Authentication-Results header
                  </FieldLabel>
                  <Textarea
                    rows={5}
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    placeholder="In Gmail: open the BCC copy → ⋮ → Show original → copy the headers"
                    className="font-[var(--font-mono)] text-xs"
                  />
                  {parsed && (
                    <div className="text-xs space-y-1">
                      <p className="text-[var(--text-mid)]">
                        spf={parsed.spf ?? "—"} · dkim={parsed.dkim ?? "—"} ·
                        dmarc={parsed.dmarc ?? "—"}
                        {parsed.signingDomain
                          ? ` · signed for ${parsed.signingDomain}`
                          : ""}
                      </p>
                      {parsed.notes.map((n) => (
                        <p key={n} className="text-[#D9B96A]">
                          {n}
                        </p>
                      ))}
                      {parsed.selector && (
                        <Button
                          variant="ghost"
                          onClick={() => onSelectorChange(parsed.selector!)}
                        >
                          Use selector “{parsed.selector}”
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Row>

            <Row name="DMARC" check={verdicts!.dmarc}>
              {verdicts!.dmarc.status !== "pass" && isOwn && (
                <RecordToPaste
                  record={buildDmarcRecord(dmarcRua || `dmarc@${checked}`)}
                  domain={checked}
                />
              )}
            </Row>
          </div>

          {/* Configuration, not verdicts — these are the only two things this
              panel persists, because a stored check result would go stale and
              keep reassuring after DNS changed underneath it. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
            <div>
              <FieldLabel>DKIM selector</FieldLabel>
              <Input
                value={dkimSelector}
                onChange={(e) => onSelectorChange(e.target.value)}
                placeholder="google"
              />
              <p className="text-xs text-[var(--text-faint)] mt-1.5">
                Saved with the page. Turns the check from a guess into a lookup.
              </p>
            </div>
            <div>
              <FieldLabel>DMARC reports to</FieldLabel>
              <Input
                value={dmarcRua}
                onChange={(e) => onRuaChange(e.target.value)}
                placeholder={`dmarc@${checked}`}
              />
              <p className="text-xs text-[var(--text-faint)] mt-1.5">
                Goes into the record above. The mailbox has to exist.
              </p>
            </div>
          </div>

          <div className="flex items-end gap-3 flex-wrap pt-1">
            <div className="flex-1 min-w-[200px]">
              <FieldLabel>Check another domain</FieldLabel>
              <Input
                value={adHoc}
                onChange={(e) => setAdHoc(e.target.value)}
                placeholder={records.fromDomain || "example.com"}
              />
            </div>
            <Button
              variant="subtle"
              disabled={loading || !adHoc.trim()}
              onClick={() => void run(adHoc.trim())}
            >
              Check
            </Button>
          </div>

          <p className="text-xs text-[var(--text-faint)]">
            A newly published record can take up to an hour to show here — DNS
            resolvers remember a missing record for a while. And passing all
            three removes one reason for a mail server to reject you; it does
            not guarantee the inbox.
          </p>
        </>
      )}
    </section>
  );
}
