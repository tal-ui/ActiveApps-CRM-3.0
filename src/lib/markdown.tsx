import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * A deliberately small markdown subset, rendered to React elements.
 *
 * Not a library and not trying to be one: the input is help copy this repo
 * writes for itself, so it only needs the constructs that make a page of
 * instructions scannable. Rendering to elements rather than an HTML string
 * means there is nothing to sanitise — the app's one dangerouslySetInnerHTML
 * stays the rich-text custom field and does not gain a sibling.
 *
 * Supported: ## / ### headings · - and 1. lists · **bold** · *italic* ·
 * `code` · [text](/path) · --- rules · paragraphs.
 */

const HEADING = /^(#{2,3})\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d+[.)]\s+(.*)$/;
const RULE = /^---+$/;

/* One pass, because the alternation order is the precedence: code first so a
   backticked `**x**` is not bolded, links before emphasis so a [**bold**](…)
   label still works. */
const INLINE = /(`[^`]+`)|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+\*\*)|(\*[^*]+\*)/g;

function renderInline(text: string, key: string, onNavigate?: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const token = m[0];
    const k = `${key}-i${i++}`;
    if (token.startsWith("`")) {
      out.push(
        <code
          key={k}
          className="font-[var(--font-mono)] text-[0.85em] bg-[var(--section-darker)] rounded-[var(--radius-sm)] px-1 py-0.5"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else if (token.startsWith("[")) {
      const split = token.indexOf("](");
      const label = token.slice(1, split);
      const href = token.slice(split + 2, -1);
      out.push(
        href.startsWith("/") ? (
          // Internal links navigate in-app and dismiss the popup, so "see Tax
          // Invoicing" is a click rather than an instruction to go hunting.
          <Link key={k} to={href} onClick={onNavigate}>
            {label}
          </Link>
        ) : (
          <a key={k} href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ),
      );
    } else if (token.startsWith("**")) {
      out.push(
        <strong key={k} className="text-[var(--foreground)] font-semibold">
          {token.slice(2, -2)}
        </strong>,
      );
    } else {
      out.push(<em key={k}>{token.slice(1, -1)}</em>);
    }
    last = at + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function renderMarkdown(md: string, onNavigate?: () => void): ReactNode[] {
  // Written as indented template literals at the call sites, so the common
  // leading whitespace has to come off before anything can be parsed.
  const raw = md.replace(/\t/g, "  ").split("\n");
  const indents = raw
    .filter((l) => l.trim())
    .map((l) => l.length - l.trimStart().length);
  const strip = indents.length ? Math.min(...indents) : 0;
  const lines = raw.map((l) => l.slice(strip));

  const out: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let n = 0;

  const flushPara = () => {
    if (!para.length) return;
    const key = `p${n++}`;
    out.push(
      <p key={key} className="text-[var(--text-mid)]">
        {renderInline(para.join(" "), key, onNavigate)}
      </p>,
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const key = `l${n++}`;
    const items = list.items.map((t, i) => (
      <li key={`${key}-${i}`} className="text-[var(--text-mid)]">
        {renderInline(t, `${key}-${i}`, onNavigate)}
      </li>
    ));
    out.push(
      list.ordered ? (
        <ol key={key}>{items}</ol>
      ) : (
        <ul key={key}>{items}</ul>
      ),
    );
    list = null;
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  for (const line of lines) {
    const t = line.trim();

    if (!t) {
      flush();
      continue;
    }

    const heading = HEADING.exec(t);
    if (heading) {
      flush();
      const key = `h${n++}`;
      const big = heading[1].length === 2;
      out.push(
        big ? (
          <h3
            key={key}
            className="font-[var(--font-heading)] font-semibold text-sm text-[var(--foreground)] mt-5 first:mt-0 mb-1.5"
          >
            {renderInline(heading[2], key, onNavigate)}
          </h3>
        ) : (
          <h4 key={key} className="label-mono mt-4 mb-1">
            {renderInline(heading[2], key, onNavigate)}
          </h4>
        ),
      );
      continue;
    }

    if (RULE.test(t)) {
      flush();
      out.push(
        <hr key={`r${n++}`} className="border-t border-[var(--border)] my-4" />,
      );
      continue;
    }

    const bullet = BULLET.exec(t);
    const numbered = NUMBERED.exec(t);
    if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      // A change of list type ends the previous list rather than mixing them.
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }

    // A plain line while a list is open continues its last item rather than
    // ending the list — without this, a wrapped item silently starts a new
    // list and every entry renders as "1.".
    if (list) {
      list.items[list.items.length - 1] += " " + t;
      continue;
    }
    para.push(t);
  }
  flush();

  // Every node above was created with its own key, so the array is returnable
  // as-is — no Fragment wrapper needed.
  return out;
}
