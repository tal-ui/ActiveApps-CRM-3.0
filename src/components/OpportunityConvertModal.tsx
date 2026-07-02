import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { invalidateLookup } from "../lib/lookups";
import { DEFAULT_CURRENCY, dateToMs, msToDateInput } from "../lib/format";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Textarea,
} from "./ui";

export default function OpportunityConvertModal({
  opportunity,
  onClose,
  onConverted,
}: {
  opportunity: Record<string, unknown>;
  onClose: () => void;
  onConverted: (projectId: string) => void;
}) {
  const { profile } = useAuth();
  const currency = String(opportunity.currency ?? "") || DEFAULT_CURRENCY;
  const [projectName, setProjectName] = useState(
    String(opportunity.name ?? "").trim(),
  );
  const [startDate, setStartDate] = useState(msToDateInput(Date.now()));
  const [budgetAmount, setBudgetAmount] = useState(
    opportunity.amount != null ? String(opportunity.amount) : "",
  );
  const [hourlyRate, setHourlyRate] = useState("300");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!projectName.trim()) {
      setError("Project name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const now = Date.now();
    const me = profile?.id ?? "system";

    const { data: project, error: projErr } = await supabase
      .from("projects")
      .insert({
        name: projectName.trim(),
        account_id: opportunity.account_id,
        opportunity_id: opportunity.id,
        status: "planning",
        start_date: dateToMs(startDate),
        budget_amount: budgetAmount ? parseFloat(budgetAmount) : null,
        hourly_rate: hourlyRate ? parseFloat(hourlyRate) : null,
        currency,
        description: description.trim() || null,
        owner_id: me,
        created_by_id: me,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (projErr || !project) {
      setBusy(false);
      setError(projErr?.message ?? "Failed to create project.");
      return;
    }

    invalidateLookup("projects");
    setBusy(false);
    onConverted((project as { id: string }).id);
  }

  return (
    <Modal title="Create Project" onClose={onClose}>
      <p className="text-sm text-[var(--text-mid)] mb-5">
        Creates a <span className="text-[var(--mint)]">Project</span> from this
        won opportunity, carrying over the account and budget.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <FieldLabel required>Project Name</FieldLabel>
          <Input
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <FieldLabel>Start Date</FieldLabel>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <FieldLabel>Budget Amount ({currency})</FieldLabel>
            <Input
              type="number"
              step="any"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="50000"
            />
          </div>
          <div>
            <FieldLabel>Hourly Rate ({currency})</FieldLabel>
            <Input
              type="number"
              step="any"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
              placeholder="300"
            />
          </div>
        </div>
        <div>
          <FieldLabel>Scope &amp; Notes</FieldLabel>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Deliverables, milestones, assumptions…"
          />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create Project"}
            <ArrowRight size={16} strokeWidth={2} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
