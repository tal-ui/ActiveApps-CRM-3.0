import { Check, ExternalLink, X } from "lucide-react";
import { Link } from "react-router-dom";
import type { FieldDef } from "../lib/objects";
import { DEFAULT_CURRENCY, fmtCurrency, fmtDate, fmtNumber, titleCase } from "../lib/format";
import { Badge } from "./ui";

export default function FieldValue({
  field,
  record,
  lookupMaps,
  linkLookups = true,
}: {
  field: FieldDef;
  record: Record<string, unknown>;
  lookupMaps: Record<string, Record<string, string>>;
  linkLookups?: boolean;
}) {
  const raw = record[field.name];
  if (raw === null || raw === undefined || raw === "") {
    return <span className="text-[var(--text-muted)]">—</span>;
  }

  switch (field.type) {
    case "picklist":
      return <Badge value={String(raw)} />;
    case "currency":
      return (
        <span className="text-[var(--foreground)] font-[var(--font-mono)] text-[0.82rem]">
          {fmtCurrency(raw as number, (record.currency as string) || DEFAULT_CURRENCY)}
        </span>
      );
    case "number":
      return (
        <span className="font-[var(--font-mono)] text-[0.82rem]">
          {fmtNumber(raw as number)}
        </span>
      );
    case "date":
      return <span>{fmtDate(raw as number)}</span>;
    case "boolean":
      return raw ? (
        <Check size={16} strokeWidth={2} className="text-[var(--mint)]" />
      ) : (
        <X size={16} strokeWidth={1.5} className="text-[var(--text-faint)]" />
      );
    case "url": {
      const href = String(raw).startsWith("http") ? String(raw) : `https://${raw}`;
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[var(--mint)] hover:underline cursor-pointer"
        >
          {String(raw).replace(/^https?:\/\//, "").slice(0, 30)}
          <ExternalLink size={12} strokeWidth={1.5} />
        </a>
      );
    }
    case "email":
      return (
        <a
          href={`mailto:${raw}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--mint)] hover:underline cursor-pointer"
        >
          {String(raw)}
        </a>
      );
    case "phone":
      return (
        <a
          href={`tel:${raw}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--text-light)] hover:text-[var(--mint)] cursor-pointer transition-colors"
        >
          {String(raw)}
        </a>
      );
    case "lookup": {
      const label = field.lookup
        ? lookupMaps[field.lookup]?.[String(raw)]
        : undefined;
      if (!label) return <span className="text-[var(--text-faint)]">{titleCase(field.label)}</span>;
      if (!linkLookups || !field.lookup) return <span>{label}</span>;
      return (
        <Link
          to={`/${field.lookup}/${raw}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[var(--mint)] hover:underline cursor-pointer"
        >
          {label}
        </Link>
      );
    }
    case "textarea":
      return (
        <span className="whitespace-pre-wrap text-[var(--text-mid)]">
          {String(raw)}
        </span>
      );
    default:
      return <span>{String(raw)}</span>;
  }
}
