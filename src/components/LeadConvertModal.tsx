import { useEffect, useState, type FormEvent } from "react";
import { ArrowRight, Link2 } from "lucide-react";
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

interface MatchedAccount {
  id: string;
  name: string;
}

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
  // Duplicate guard: existing accounts whose name looks like this one. When
  // the user picks one, we attach to it instead of creating a second account.
  const [matches, setMatches] = useState<MatchedAccount[]>([]);
  const [existingAccountId, setExistingAccountId] = useState<string | null>(null);

  useEffect(() => {
    const q = accountName.trim();
    if (q.length < 2) {
      setMatches([]);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      supabase
        .from("accounts")
        .select("id, name")
        .eq("is_deleted", false)
        .ilike("name", `%${q}%`)
        .limit(5)
        .then(({ data }) => {
          if (live) setMatches((data ?? []) as MatchedAccount[]);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [accountName]);

  // A picked account stops being valid if the name is edited away from it
  useEffect(() => {
    if (
      existingAccountId &&
      !matches.some((m) => m.id === existingAccountId)
    ) {
      setExistingAccountId(null);
    }
  }, [matches, existingAccountId]);

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

    // 1. Attach to the chosen existing account, or create a new one
    let accountId: string;
    if (existingAccountId) {
      accountId = existingAccountId;
    } else {
      const { data: account, error: accErr } = await supabase
        .from("accounts")
        .insert({
          name: accountName.trim(),
          type: "prospect",
          status: "active",
          source: lead.source ?? null,
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
      accountId = (account as { id: string }).id;
    }

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
          source: lead.source ?? null,
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
        Converting {existingAccountId ? "links to the selected" : "creates an"}{" "}
        <span className="text-[var(--mint)]">Account</span>, creates a{" "}
        <span className="text-[var(--mint)]">Contact</span>
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
            disabled={!!existingAccountId}
          />
          {matches.length > 0 && (
            <div className="mt-2 bg-[var(--section-darker)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] p-3">
              <p className="label-mono mb-2">
                {existingAccountId
                  ? "Linking to existing account"
                  : "Similar accounts already exist"}
              </p>
              <div className="flex flex-wrap gap-2">
                {matches.map((m) => {
                  const picked = existingAccountId === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setExistingAccountId(picked ? null : m.id)}
                      className={`inline-flex items-center gap-1.5 border rounded-full px-3 py-1 text-xs cursor-pointer transition-colors ${
                        picked
                          ? "bg-[rgba(60,201,152,0.1)] border-[rgba(60,201,152,0.35)] text-[var(--mint)]"
                          : "border-[rgba(255,255,255,0.12)] text-[var(--text-mid)] hover:text-[var(--foreground)] hover:border-[rgba(60,201,152,0.25)]"
                      }`}
                    >
                      <Link2 size={12} strokeWidth={1.5} />
                      {m.name}
                    </button>
                  );
                })}
              </div>
              <p className="text-[0.68rem] text-[var(--text-faint)] mt-2">
                {existingAccountId
                  ? "Click again to unlink and create a new account instead."
                  : "Pick one to attach this lead to it instead of creating a duplicate."}
              </p>
            </div>
          )}
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
              <FieldLabel>Amount ({DEFAULT_CURRENCY})</FieldLabel>
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
