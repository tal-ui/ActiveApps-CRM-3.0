import { useState } from "react";
import { ChevronDown, ChevronRight, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { Button, ErrorNote } from "./ui";

interface InsightResult {
  summary: string;
  risks: string[];
  actions: string[];
  generatedAt: number;
  model: string;
}

type ErrorKind = "" | "not_configured" | "invalid_key" | "generic";

export default function AiInsightPanel({
  objectType,
  recordId,
}: {
  objectType: "accounts" | "opportunities" | "projects";
  recordId: string;
}) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InsightResult | null>(null);
  const [errorKind, setErrorKind] = useState<ErrorKind>("");
  const [errorMsg, setErrorMsg] = useState("");

  async function generate() {
    setLoading(true);
    setErrorKind("");
    setErrorMsg("");
    setResult(null);
    const { data, error } = await supabase.functions.invoke("ai-assist", {
      body: { objectType, recordId },
    });
    setLoading(false);
    if (error) {
      if (error instanceof FunctionsHttpError) {
        let body: { error?: string } | null = null;
        try {
          body = (await error.context.json()) as { error?: string };
        } catch {
          /* error body wasn't JSON */
        }
        if (body?.error === "not_configured") {
          setErrorKind("not_configured");
        } else if (body?.error === "invalid_key") {
          setErrorKind("invalid_key");
        } else {
          setErrorKind("generic");
          setErrorMsg(String(body?.error ?? error.message));
        }
      } else {
        setErrorKind("generic");
        setErrorMsg(String((error as Error).message ?? error));
      }
      return;
    }
    const r = (data ?? {}) as Partial<InsightResult>;
    setResult({
      summary: String(r.summary ?? ""),
      risks: Array.isArray(r.risks) ? r.risks.map(String) : [],
      actions: Array.isArray(r.actions) ? r.actions.map(String) : [],
      generatedAt: Number(r.generatedAt ?? Date.now()),
      model: String(r.model ?? ""),
    });
  }

  return (
    <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 mb-6">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between cursor-pointer"
      >
        <span className="flex items-center gap-2">
          <Sparkles size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <span className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            AI Insight
          </span>
        </span>
        {open ? (
          <ChevronDown size={14} className="text-[var(--text-faint)]" />
        ) : (
          <ChevronRight size={14} className="text-[var(--text-faint)]" />
        )}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {loading ? (
            <div className="flex items-center gap-3 py-2">
              <div className="w-4 h-4 border-2 border-[var(--navy-surface)] border-t-[var(--mint)] rounded-full animate-spin" />
              <span className="label-mono">Analyzing…</span>
            </div>
          ) : (
            <>
              {errorKind === "not_configured" && (
                <div className="bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[var(--text-mid)]">
                  The AI assistant isn't configured yet.{" "}
                  {isAdmin && (
                    <Link
                      to="/settings/workspace"
                      className="text-[var(--mint)] hover:underline"
                    >
                      Add an Anthropic API key →
                    </Link>
                  )}
                </div>
              )}
              {errorKind === "invalid_key" && (
                <ErrorNote message="The configured Anthropic API key was rejected." />
              )}
              {errorKind === "generic" && <ErrorNote message={errorMsg} />}

              {result ? (
                <>
                  <p className="text-sm text-[var(--text-mid)]">
                    {result.summary}
                  </p>
                  {result.risks.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="label-mono">Risks</p>
                      {result.risks.map((risk, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#D9B96A] mt-1.5 shrink-0" />
                          <p className="text-sm text-[var(--text-mid)]">
                            {risk}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  {result.actions.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="label-mono">Suggested Actions</p>
                      <ol className="space-y-1.5">
                        {result.actions.map((action, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className="font-[var(--font-mono)] text-xs text-[var(--mint)] mt-0.5 shrink-0">
                              {i + 1}.
                            </span>
                            <p className="text-sm text-[var(--text-mid)]">
                              {action}
                            </p>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-3 border-t border-[rgba(255,255,255,0.06)] pt-3 mt-4">
                    <span className="label-mono">
                      {fmtDateTime(result.generatedAt)} · {result.model}
                    </span>
                    <Button
                      variant="ghost"
                      className="!px-3 !py-1.5"
                      onClick={generate}
                    >
                      <Sparkles size={14} strokeWidth={1.5} />
                      Regenerate
                    </Button>
                    <p className="text-[10px] text-[var(--text-faint)]">
                      Record data is sent to Anthropic's API when you generate
                      an insight.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  {errorKind === "" && (
                    <p className="text-sm text-[var(--text-mid)]">
                      Generate a summary, risks and next actions from this
                      record's data.
                    </p>
                  )}
                  <Button variant="ghost" onClick={generate}>
                    <Sparkles size={14} strokeWidth={1.5} />
                    {errorKind === "" ? "Generate insight" : "Retry"}
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
