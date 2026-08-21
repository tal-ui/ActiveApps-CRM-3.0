import { useCallback, useEffect, useRef, useState } from "react";
import { Info } from "lucide-react";
import { helpFor } from "../lib/help";
import { renderMarkdown } from "../lib/markdown";
import { Modal } from "./ui";

/**
 * The "i" beside a page title: what this screen is for, on demand.
 *
 * Built on the shared Modal rather than a bespoke popover, which buys the two
 * things that are easy to get wrong here — it portals to document.body, so the
 * header's backdrop-filter cannot clip it, and its Escape handling is
 * stack-aware, so opening help from inside another modal closes the right one.
 *
 * Modal does no focus management, so this does it: focus moves into the dialog
 * on open and returns to the icon on close, which is what stops the popup from
 * being a dead end for anyone on a keyboard.
 */
export default function HelpButton({ topic }: { topic: string }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const help = helpFor(topic);

  const close = useCallback(() => {
    setOpen(false);
    // Back to the icon, so tabbing carries on from where it left off.
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    // Modal renders through a portal, so the content is not in the DOM until
    // after this component commits — hence the ref rather than autoFocus.
    // The close control is a sibling of this content, in Modal's header row.
    panelRef.current?.parentElement
      ?.querySelector<HTMLElement>('button[aria-label="Close"]')
      ?.focus();
  }, [open]);

  if (!help) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        title={`About ${help.title}`}
        aria-label={`About ${help.title}`}
        className="flex items-center justify-center w-7 h-7 shrink-0 rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
      >
        <Info size={15} strokeWidth={1.5} />
      </button>

      {open && (
        <Modal title={help.title} onClose={close}>
          <div
            data-help-panel
            ref={panelRef}
            className="rich-text-content text-sm max-h-[65vh] overflow-y-auto pr-1"
          >
            {/* A link in the body navigates and dismisses — "see Tax Invoicing"
                should be a click, not an errand. */}
            {renderMarkdown(help.body, close)}
          </div>
        </Modal>
      )}
    </>
  );
}
