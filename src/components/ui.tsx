import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { badgeTone } from "../lib/objects";
import { titleCase } from "../lib/format";

/* ---------- Buttons ---------- */

type ButtonVariant = "primary" | "ghost" | "destructive" | "subtle";

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
}) {
  const base =
    "inline-flex items-center gap-2 font-medium text-sm px-4 py-2 rounded-[var(--radius-md)] cursor-pointer transition-all duration-300 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2 focus:ring-offset-[var(--background)] disabled:opacity-50 disabled:cursor-not-allowed";
  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-[var(--mint)] text-[var(--primary-foreground)] hover:scale-[1.02] hover:shadow-[0_0_30px_rgba(60,201,152,0.3)]",
    ghost:
      "bg-transparent text-[var(--mint)] border border-[rgba(60,201,152,0.25)] hover:bg-[rgba(60,201,152,0.08)] hover:border-[rgba(60,201,152,0.4)]",
    destructive:
      "bg-[var(--destructive)] text-[var(--destructive-foreground)] hover:opacity-90",
    subtle:
      "bg-[var(--navy-surface)] text-[var(--text-light)] border border-[rgba(255,255,255,0.06)] hover:border-[rgba(60,201,152,0.25)] hover:text-[var(--foreground)]",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

/* ---------- Form controls ---------- */

const inputClasses =
  "w-full bg-[var(--section-darker)] text-[var(--foreground)] border border-[rgba(255,255,255,0.12)] rounded-[var(--radius-md)] px-3.5 py-2.5 text-sm placeholder:text-[var(--text-faint)] transition-all duration-300 focus:outline-none focus:border-[var(--mint)] focus:ring-2 focus:ring-[var(--mint-glow)]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClasses} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={3}
      {...props}
      className={`${inputClasses} resize-y ${props.className ?? ""}`}
    />
  );
}

export function Select({
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`${inputClasses} cursor-pointer appearance-none ${props.className ?? ""}`}
    >
      {children}
    </select>
  );
}

export function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="label-mono block mb-1.5">
      {children}
      {required && <span className="text-[var(--mint)] ml-1">*</span>}
    </label>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-3 cursor-pointer group"
    >
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-300 ${
          checked ? "bg-[var(--mint)]" : "bg-[var(--navy-surface)]"
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-[var(--foreground)] transition-transform duration-300 ${
            checked ? "translate-x-[18px]" : "translate-x-[3px]"
          }`}
        />
      </span>
      {label && (
        <span className="text-sm text-[var(--text-mid)] group-hover:text-[var(--foreground)] transition-colors">
          {label}
        </span>
      )}
    </button>
  );
}

/* ---------- Badge ---------- */

export function Badge({ value }: { value: string }) {
  const tone = badgeTone(value);
  const tones = {
    mint: "bg-[rgba(60,201,152,0.1)] text-[var(--mint)] border-[rgba(60,201,152,0.2)]",
    neutral:
      "bg-[rgba(255,255,255,0.04)] text-[var(--text-mid)] border-[rgba(255,255,255,0.08)]",
    warn: "bg-[rgba(220,180,80,0.08)] text-[#D9B96A] border-[rgba(220,180,80,0.2)]",
    danger:
      "bg-[rgba(228,0,22,0.08)] text-[#F2697A] border-[rgba(228,0,22,0.25)]",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1.5 border font-[var(--font-mono)] text-[0.62rem] uppercase tracking-[0.13em] px-2 py-0.5 rounded-[var(--radius-sm)] whitespace-nowrap ${tones[tone]}`}
    >
      {tone === "mint" && (
        <span className="w-1.5 h-1.5 rounded-full bg-[var(--mint)] animate-pulse" />
      )}
      {titleCase(value)}
    </span>
  );
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  // Render to document.body so the fixed overlay isn't trapped by an ancestor
  // that establishes a containing block for fixed elements (e.g. the header's
  // backdrop-filter) — which would otherwise clip/mis-position the modal.
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-[var(--card)] border border-[rgba(255,255,255,0.08)] rounded-[var(--radius-xl)] p-7 mx-auto my-[8vh] shadow-[0_0_60px_rgba(60,201,152,0.05)] ${
          wide ? "max-w-3xl" : "max-w-xl"
        }`}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-[var(--font-heading)] font-bold text-lg text-[var(--foreground)]">
            {title}
          </h2>
          <button
            onClick={onClose}
            className="text-[var(--text-dim)] hover:text-[var(--foreground)] cursor-pointer transition-colors p-1"
            aria-label="Close"
          >
            <X size={16} strokeWidth={1.5} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Misc ---------- */

export function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="w-7 h-7 border-2 border-[var(--navy-surface)] border-t-[var(--mint)] rounded-full animate-spin" />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <div className="flex items-center justify-center gap-4 mb-4">
        <div className="h-px w-16 bg-gradient-to-r from-transparent to-[rgba(60,201,152,0.2)]" />
        <div className="w-2.5 h-2.5 rotate-45 border border-[var(--mint)]" />
        <div className="h-px w-16 bg-gradient-to-l from-transparent to-[rgba(60,201,152,0.2)]" />
      </div>
      <p className="text-[var(--text-dim)] text-sm">{message}</p>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="bg-[rgba(228,0,22,0.08)] border border-[rgba(228,0,22,0.25)] rounded-[var(--radius-md)] px-4 py-3 text-sm text-[#F2697A]">
      {message}
    </div>
  );
}
