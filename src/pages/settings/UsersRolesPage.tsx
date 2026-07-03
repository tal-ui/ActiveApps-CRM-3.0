import { useEffect, useState } from "react";
import { Info, Users } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { insertAudit } from "../../lib/audit";
import { fmtDate } from "../../lib/format";
import { ErrorNote, Select, Spinner, Toggle } from "../../components/ui";

interface ProfileRow {
  id: string;
  auth_user_id: string | null;
  email: string;
  full_name: string;
  title: string | null;
  role: string;
  is_active: boolean;
  created_at: number;
}

export default function UsersRolesPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<ProfileRow[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    supabase
      .from("profiles")
      .select("id, auth_user_id, email, full_name, title, role, is_active, created_at")
      .order("created_at")
      .then(({ data, error: err }) => {
        if (err) setError(err.message);
        setRows((data ?? []) as ProfileRow[]);
      });
  }, []);

  async function updateRow(row: ProfileRow, patch: Partial<Pick<ProfileRow, "role" | "is_active">>) {
    setError("");
    const { error: err } = await supabase
      .from("profiles")
      .update({ ...patch, updated_at: Date.now() })
      .eq("id", row.id);
    if (err) {
      setError(err.message);
      return;
    }
    setRows((prev) =>
      prev ? prev.map((r) => (r.id === row.id ? { ...r, ...patch } : r)) : prev,
    );
    void insertAudit(profile, {
      action: patch.role !== undefined ? "role_change" : "active_toggle",
      entity_type: "profile",
      entity_id: row.id,
      summary:
        patch.role !== undefined
          ? `Changed role of ${row.email} from ${row.role} to ${patch.role}`
          : `${patch.is_active ? "Activated" : "Deactivated"} ${row.email}`,
      before: { role: row.role, is_active: row.is_active },
      after: { role: patch.role ?? row.role, is_active: patch.is_active ?? row.is_active },
    });
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-[var(--radius)] bg-[rgba(60,201,152,0.08)] border border-[rgba(60,201,152,0.2)] flex items-center justify-center">
          <Users size={20} strokeWidth={1.5} className="text-[var(--mint)]" />
        </div>
        <div>
          <h1 className="font-[var(--font-heading)] font-bold text-xl text-[var(--foreground)]">
            Users & Roles
          </h1>
          <p className="label-mono">
            {rows ? `${rows.length} profile${rows.length === 1 ? "" : "s"}` : "loading"}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6">
          <ErrorNote message={error} />
        </div>
      )}

      <div className="flex items-start gap-2.5 bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-md)] px-4 py-3 mb-6 text-sm text-[var(--text-mid)]">
        <Info size={15} strokeWidth={1.5} className="text-[var(--mint)] mt-0.5 shrink-0" />
        <span>
          New users are created in the Supabase dashboard (Auth → Invite). Once
          they sign in and have a profile, they appear here as members. Admins
          see the Setup section; members do not.
        </span>
      </div>

      {!rows ? (
        <Spinner />
      ) : (
        <div className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                {["Name", "Email", "Title", "Role", "Active", "Created"].map((h) => (
                  <th key={h} className="label-mono font-normal pb-3 pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelf = r.id === profile?.id;
                return (
                  <tr
                    key={r.id}
                    className="border-t border-[rgba(255,255,255,0.05)]"
                  >
                    <td className="py-3 pr-4 text-[var(--foreground)]">
                      {r.full_name || "—"}
                      {isSelf && (
                        <span className="label-mono ml-2 !text-[var(--mint)]">you</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-[var(--text-mid)]">{r.email}</td>
                    <td className="py-3 pr-4 text-[var(--text-dim)]">{r.title || "—"}</td>
                    <td className="py-3 pr-4">
                      <Select
                        value={r.role}
                        disabled={isSelf}
                        title={isSelf ? "You can't change your own role" : undefined}
                        onChange={(e) => updateRow(r, { role: e.target.value })}
                        className="!w-32 !py-1.5"
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                      </Select>
                    </td>
                    <td className="py-3 pr-4">
                      <div
                        title={isSelf ? "You can't deactivate yourself" : undefined}
                        className={isSelf ? "opacity-50 pointer-events-none" : ""}
                      >
                        <Toggle
                          checked={r.is_active}
                          onChange={(v) => updateRow(r, { is_active: v })}
                        />
                      </div>
                    </td>
                    <td className="py-3 text-[var(--text-dim)]">{fmtDate(r.created_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
