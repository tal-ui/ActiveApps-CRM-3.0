import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { insertAudit } from "../lib/audit";
import { fmtDateTime } from "../lib/format";
import { Button, ConfirmModal, EmptyState, ErrorNote } from "./ui";

interface AttachmentRow {
  id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by_email: string | null;
  created_at: number;
}

function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MAX_FILE_BYTES = 10 * 1024 * 1024;

export default function AttachmentsPanel({
  entityType,
  entityId,
}: {
  entityType: string;
  entityId: string;
}) {
  const { profile } = useAuth();
  const [rows, setRows] = useState<AttachmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<AttachmentRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from("attachments")
      .select("*")
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .order("created_at", { ascending: false });
    if (err) setError(err.message);
    else setRows((data as AttachmentRow[] | null) ?? []);
    setLoading(false);
  }, [entityType, entityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      setError("File is larger than 10 MB");
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const sanitized = file.name.replace(/[^\w.\-]+/g, "_");
      const path = `${entityType}/${entityId}/${crypto.randomUUID()}-${sanitized}`;
      const { error: upErr } = await supabase.storage
        .from("attachments")
        .upload(path, file, {
          contentType: file.type || "application/octet-stream",
        });
      if (upErr) {
        setError(upErr.message);
        return;
      }
      const { data: inserted, error: insErr } = await supabase
        .from("attachments")
        .insert({
          entity_type: entityType,
          entity_id: entityId,
          file_name: file.name,
          storage_path: path,
          mime_type: file.type || "application/octet-stream",
          size_bytes: file.size,
          uploaded_by_id: profile?.id ?? "system",
          uploaded_by_email: profile?.email ?? null,
          created_at: Date.now(),
        })
        .select("id")
        .single();
      if (insErr) {
        // Roll the object back out of storage so no orphan remains.
        await supabase.storage
          .from("attachments")
          .remove([path])
          .catch(() => {});
        setError(insErr.message);
        return;
      }
      void insertAudit(profile, {
        action: "upload",
        entity_type: "attachment",
        entity_id: (inserted as { id: string } | null)?.id ?? null,
        summary: `Uploaded ${file.name} to ${entityType}/${entityId}`,
      });
      await load();
    } finally {
      setUploading(false);
    }
  };

  const download = async (row: AttachmentRow) => {
    setError(null);
    const { data, error: err } = await supabase.storage
      .from("attachments")
      .createSignedUrl(row.storage_path, 60);
    if (err || !data?.signedUrl) {
      setError(err?.message ?? "Could not create download link");
      return;
    }
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = row.file_name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const row = pendingDelete;
    setDeleting(true);
    setError(null);
    try {
      // Tolerate storage errors (object may already be gone).
      await supabase.storage
        .from("attachments")
        .remove([row.storage_path])
        .catch(() => {});
      const { error: err } = await supabase
        .from("attachments")
        .delete()
        .eq("id", row.id);
      if (err) {
        setError(err.message);
        return;
      }
      void insertAudit(profile, {
        action: "delete",
        entity_type: "attachment",
        entity_id: row.id,
        summary: `Deleted ${row.file_name} from ${entityType}/${entityId}`,
      });
      await load();
    } finally {
      setDeleting(false);
      setPendingDelete(null);
    }
  };

  return (
    <section className="bg-[var(--card)] border border-[rgba(255,255,255,0.06)] rounded-[var(--radius-lg)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Paperclip size={16} strokeWidth={1.5} className="text-[var(--mint)]" />
          <h3 className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)]">
            Attachments
          </h3>
          <span className="label-mono">({rows.length})</span>
        </div>
        <Button
          variant="ghost"
          className="!px-3 !py-1.5"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={14} strokeWidth={2} />
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => void onFileChange(e)}
        />
      </div>

      {error && (
        <div className="mb-3">
          <ErrorNote message={error} />
        </div>
      )}

      {loading ? (
        <p className="label-mono py-6 text-center">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState message="No attachments yet." />
      ) : (
        <div className="divide-y divide-[rgba(255,255,255,0.04)]">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5"
            >
              <FileText
                size={15}
                strokeWidth={1.5}
                className="text-[var(--mint)] shrink-0"
              />
              <button
                onClick={() => void download(row)}
                title={`Download ${row.file_name}`}
                className="font-medium text-sm truncate text-[var(--foreground)] hover:text-[var(--mint)] cursor-pointer transition-colors text-left min-w-0 flex-1 basis-40"
              >
                {row.file_name}
              </button>
              <span className="label-mono shrink-0">{fmtSize(row.size_bytes)}</span>
              <span className="text-xs text-[var(--text-faint)] truncate">
                {fmtDateTime(row.created_at)}
                {row.uploaded_by_email ? ` · ${row.uploaded_by_email}` : ""}
              </span>
              <span className="ml-auto flex items-center gap-1 shrink-0">
                <button
                  onClick={() => void download(row)}
                  title="Download"
                  aria-label={`Download ${row.file_name}`}
                  className="p-1.5 text-[var(--text-dim)] hover:text-[var(--mint)] cursor-pointer transition-colors"
                >
                  <Download size={15} strokeWidth={1.5} />
                </button>
                <button
                  onClick={() => setPendingDelete(row)}
                  title="Delete"
                  aria-label={`Delete ${row.file_name}`}
                  className="p-1.5 text-[var(--text-dim)] hover:text-[#F2697A] cursor-pointer transition-colors"
                >
                  <Trash2 size={15} strokeWidth={1.5} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {pendingDelete && (
        <ConfirmModal
          title="Delete attachment"
          confirmLabel="Delete"
          destructive
          busy={deleting}
          onConfirm={() => void confirmDelete()}
          onClose={() => setPendingDelete(null)}
        >
          <p>
            Delete <strong>{pendingDelete.file_name}</strong>? The file will be
            removed from storage permanently.
          </p>
        </ConfirmModal>
      )}
    </section>
  );
}
