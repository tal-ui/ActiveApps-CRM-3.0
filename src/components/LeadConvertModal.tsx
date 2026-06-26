import { useState, type FormEvent } from "react";
import { ArrowRight } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { invalidateLookup } from "../lib/lookups";
import { DEFAULT_CURRENCY } from "../lib/format";
import {
  Button,
  ErrorNote,
  FieldLabel,
  Input,
  Modal,
  Select,
  Toggle,
} from "./ui";

export default function LeadConvertModal({
  lead,
  onClose,
  onConverted,
}: {
  lead: Record<string, unknown>;
  onClose: () => void;
  onConverted: (accountId: string) => void;
}) {
  const { profile } = useAuth();
  const [accountName, setAccountName] = useState(
    String(lead.company ?? `${lead.last_name ?? ""} Co.`).trim(),
  );
  const [createOpp, setCreateOpp] = useState(true);
  const [oppName, setOppName] = useState(
    `${String(lead.company ?? lead.last_name ?? "New Client")} — New Business`,
  );
  const [amount, setAmount] = useState("");
  const [stage, setStage] = useState("discovery");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!accountName.trim()) {
      setError("Account name is required.");
      return;
    }
    setBusy(true);
    setError("");
    const now = Date.now();
    const me = profile?.id ?? "system";

    // 1. Create Account
    const { data: account, error: accErr } = await supabase
      .from("accounts")
      .insert({
        name: accountName.trim(),
        type: "prospect",
        status: "active",
        owner_id: me,
        created_by_id: me,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (accErr || !account) {
      setBusy(false);
      setError(accErr?.message ?? "Failed to create account.");
      return;
    }
    const accountId = (account as { id: string }).id;

    // 2. Create Contact
    const { data: contact, error: conErr } = await supabase
      .from("contacts")
      .insert({
        account_id: accountId,
        first_name: String(lead.first_name ?? "") || "—",
        last_name: String(lead.last_name ?? ""),
        email: lead.email ?? null,
        phone: lead.phone ?? null,
        title: lead.title ?? null,
        is_primary: true,
        owner_id: me,
        created_by_id: me,
        created_at: now,
        updated_at: now,
      })
      .select("id")
      .single();
    if (conErr || !contact) {
      setBusy(false);
      setError(conErr?.message ?? "Failed to create contact.");
      return;
    }
    const contactId = (contact as { id: string }).id;

    // 3. Optionally create Opportunity
    let opportunityId: string | null = null;
    if (createOpp) {
      const { data: opp, error: oppErr } = await supabase
        .from("opportunities")
        .insert({
          account_id: accountId,
          contact_id: contactId,
          name: oppName.trim() || `${accountName} — New Business`,
          stage,
          amount: amount ? parseFloat(amount) : null,
          currency: DEFAULT_CURRENCY,
          type: "new_business",
          owner_id: me,
          created_by_id: me,
          created_at: now,
          updated_at: now,
        })
        .select("id")
        .single();
      if (oppErr || !opp) {
        setBusy(false);
        setError(oppErr?.message ?? "Failed to create opportunity.");
        return;
      }
      opportunityId = (opp as { id: string }).id;
    }

    // 4. Mark lead converted
    const { error: leadErr } = await supabase
      .from("leads")
      .update({
        status: "converted",
        converted_account_id: accountId,
        converted_contact_id: contactId,
        converted_opportunity_id: opportunityId,
        converted_at: now,
        updated_at: now,
      })
      .eq("id", lead.id as string);
    if (leadErr) {
      setBusy(false);
      setError(leadErr.message);
      return;
    }

    invalidateLookup("accounts");
    invalidateLookup("contacts");
    invalidateLookup("opportunities");
    invalidateLookup("leads");
    setBusy(false);
    onConverted(accountId);
  }

  return (
    <Modal title="Convert Lead" onClose={onClose}>
      <p className="text-sm text-[var(--text-mid)] mb-5">
        Converting creates an <span className="text-[var(--mint)]">Account</span>,
        a <span className="text-[var(--mint)]">Contact</span>
        {createOpp && (
          <>
            {" "}and an <span className="text-[var(--mint)]">Opportunity</span>
          </>
        )}
        , then marks this lead as converted.
      </p>
      <form onSubmit={onSubmit} className="space-y-4">
        {error && <ErrorNote message={error} />}
        <div>
          <FieldLabel required>Account Name</FieldLabel>
          <Input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
          />
        </div>
        <div className="pt-1">
          <Toggle
            checked={createOpp}
            onChange={setCreateOpp}
            label="Create an Opportunity"
          />
        </div>
        {createOpp && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[var(--section-darker)] border border-[rgba(255,255,255,0.04)] rounded-[var(--radius-md)] p-4">
            <div className="sm:col-span-2">
              <FieldLabel>Opportunity Name</FieldLabel>
              <Input value={oppName} onChange={(e) => setOppName(e.target.value)} />
            </div>
            <div>
              <FieldLabel>Amount (USD)</FieldLabel>
              <Input
                type="number"
                step="any"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="25000"
              />
            </div>
            <div>
              <FieldLabel>Stage</FieldLabel>
              <Select value={stage} onChange={(e) => setStage(e.target.value)}>
                {["discovery", "qualification", "proposal", "negotiation"].map(
                  (s) => (
                    <option key={s} value={s}>
                      {s.charAt(0).toUpperCase() + s.slice(1)}
                    </option>
                  ),
                )}
              </Select>
            </div>
          </div>
        )}
        <div className="flex justify-end gap-3 pt-2">
          <Button type="button" variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Converting…" : "Convert Lead"}
            <ArrowRight size={16} strokeWidth={2} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
