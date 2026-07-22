import { useEffect, useRef } from "react";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  RemoveFormatting,
  Strikethrough,
  Underline,
} from "lucide-react";
import { isEmptyHtml, sanitizeHtml } from "../lib/sanitizeHtml";

const TOOLS: { icon: typeof Bold; cmd: string; title: string }[] = [
  { icon: Bold, cmd: "bold", title: "Bold" },
  { icon: Italic, cmd: "italic", title: "Italic" },
  { icon: Underline, cmd: "underline", title: "Underline" },
  { icon: Strikethrough, cmd: "strikeThrough", title: "Strikethrough" },
  { icon: List, cmd: "insertUnorderedList", title: "Bullet list" },
  { icon: ListOrdered, cmd: "insertOrderedList", title: "Numbered list" },
  { icon: RemoveFormatting, cmd: "removeFormat", title: "Clear formatting" },
];

/**
 * Minimal rich text editor for custom fields: contentEditable surface with a
 * formatting toolbar. Emits sanitized HTML ("" when visually empty).
 */
export default function RichTextEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (html: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Once the user has edited, external value changes must never clobber the
  // DOM (an async-loaded stored value can otherwise arrive mid-edit and wipe
  // their input — or the reverse). Before the first edit, always accept it.
  const dirty = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!dirty.current && el.innerHTML !== value) {
      el.innerHTML = sanitizeHtml(value || "");
    }
  }, [value]);

  function emit() {
    const el = ref.current;
    if (!el) return;
    const html = el.innerHTML;
    onChange(isEmptyHtml(html) ? "" : sanitizeHtml(html));
  }

  function exec(cmd: string) {
    dirty.current = true;
    ref.current?.focus();
    document.execCommand(cmd);
    emit();
  }

  // Pasted markup goes through the sanitizer BEFORE it enters the editable
  // DOM — otherwise handlers on pasted elements would live (and fire) there.
  function onPaste(e: React.ClipboardEvent<HTMLDivElement>) {
    e.preventDefault();
    dirty.current = true;
    const html = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (html) document.execCommand("insertHTML", false, sanitizeHtml(html));
    else if (text) document.execCommand("insertText", false, text);
    emit();
  }

  return (
    <div className="bg-[var(--section-darker)] border border-[rgba(255,255,255,0.12)] rounded-[var(--radius-md)] focus-within:border-[var(--mint)] focus-within:ring-2 focus-within:ring-[var(--mint-glow)] transition-all duration-300 overflow-hidden">
      <div className="flex items-center gap-0.5 px-1.5 py-1 border-b border-[rgba(255,255,255,0.08)]">
        {TOOLS.map((t) => (
          <button
            key={t.cmd}
            type="button"
            title={t.title}
            aria-label={t.title}
            // preventDefault keeps the text selection while clicking the tool
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => exec(t.cmd)}
            className="p-1.5 rounded-[var(--radius-sm)] text-[var(--text-dim)] hover:text-[var(--mint)] hover:bg-[var(--navy-surface)] cursor-pointer transition-colors"
          >
            <t.icon size={14} strokeWidth={1.5} />
          </button>
        ))}
      </div>
      <div
        ref={ref}
        contentEditable
        role="textbox"
        aria-multiline="true"
        onInput={() => {
          dirty.current = true;
          emit();
        }}
        onBlur={emit}
        onPaste={onPaste}
        // Dropped content bypasses onPaste sanitization — block it
        onDrop={(e) => e.preventDefault()}
        className="rich-text-content min-h-[110px] max-h-72 overflow-y-auto px-3.5 py-2.5 text-sm text-[var(--foreground)] focus:outline-none"
      />
    </div>
  );
}
