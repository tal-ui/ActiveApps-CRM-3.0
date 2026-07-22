import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckSquare, FolderKanban, Target } from "lucide-react";
import { OBJECTS } from "../lib/objects";
import RecordForm from "./RecordForm";

const ACTIONS = [
  { object: "tasks", icon: CheckSquare },
  { object: "projects", icon: FolderKanban },
  { object: "leads", icon: Target },
] as const;

/**
 * Header quick-create actions: one-click "New Task / Project / Lead" that
 * opens the standard record form and jumps to the new record on save.
 */
export default function QuickActions() {
  const [creating, setCreating] = useState<string | null>(null);
  const navigate = useNavigate();

  return (
    <>
      <div className="hidden sm:flex items-center gap-1.5">
        {ACTIONS.map(({ object, icon: Icon }) => {
          const def = OBJECTS[object];
          return (
            <button
              key={object}
              onClick={() => setCreating(object)}
              title={`New ${def.singular}`}
              aria-label={`New ${def.singular}`}
              className="relative flex items-center justify-center h-9 w-9 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] hover:border-[color-mix(in_oklab,var(--mint)_25%,transparent)] cursor-pointer transition-colors"
            >
              <Icon size={15} strokeWidth={1.5} />
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--mint)] text-[var(--primary-foreground)] text-[9px] font-bold leading-none flex items-center justify-center">
                +
              </span>
            </button>
          );
        })}
      </div>

      {creating && (
        <RecordForm
          object={creating}
          record={null}
          onClose={() => setCreating(null)}
          onSaved={(id) => {
            const target = creating;
            setCreating(null);
            navigate(`/${target}/${id}`);
          }}
        />
      )}
    </>
  );
}
