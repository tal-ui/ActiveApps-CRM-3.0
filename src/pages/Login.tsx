import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Button, ErrorNote, FieldLabel, Input } from "../components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setError(error.message);
      return;
    }
    navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-[radial-gradient(ellipse,rgba(60,201,152,0.08),transparent_70%)]" />

      <div className="relative w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <img src="/aa-logo.png" alt="ActiveApps" className="w-12 h-12 rounded mb-4 glow-mint" />
          <div className="text-xl">
            <span className="font-[var(--font-heading)] font-bold text-[var(--text-light)]">
              ACTIVE
            </span>
            <span className="font-[var(--font-heading)] font-bold text-[var(--mint)]">
              APPS
            </span>
          </div>
          <p className="label-mono text-[#5E6268] mt-1">Tech Orchestration</p>
        </div>

        <form
          onSubmit={onSubmit}
          className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-xl)] p-7 space-y-5"
        >
          <h1 className="font-[var(--font-heading)] font-bold text-lg text-[var(--foreground)]">
            Sign in to CRM
          </h1>
          {error && <ErrorNote message={error} />}
          <div>
            <FieldLabel required>Email</FieldLabel>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@activeapps.io"
              autoComplete="email"
              required
            />
          </div>
          <div>
            <FieldLabel required>Password</FieldLabel>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? "Signing in…" : "Sign In"}
            <ArrowRight size={16} strokeWidth={2} />
          </Button>
        </form>

        <p className="text-center text-xs text-[var(--text-muted)] mt-6">
          ActiveApps CRM · Internal use
        </p>
      </div>
    </div>
  );
}
