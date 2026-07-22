/**
 * Allowlist HTML sanitizer for rich text custom fields. DOM-based: parses in
 * an inert document, unwraps unknown elements, removes dangerous ones, and
 * strips every attribute except safe link hrefs. Runs on both save and
 * render so stored values are never trusted.
 */

const ALLOWED = new Set([
  "P",
  "DIV",
  "BR",
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "UL",
  "OL",
  "LI",
  "A",
  "SPAN",
  "BLOCKQUOTE",
]);

// Never keep these or their content
const DROP = new Set([
  "SCRIPT",
  "STYLE",
  "IFRAME",
  "OBJECT",
  "EMBED",
  "FORM",
  "INPUT",
  "TEXTAREA",
  "SELECT",
  "BUTTON",
  "LINK",
  "META",
  "svg",
  "SVG",
  "MATH",
]);

function safeHref(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  return null;
}

function clean(el: Element): void {
  // Snapshot children — the list mutates as we unwrap/remove
  for (const child of Array.from(el.children)) {
    clean(child);
  }

  const tag = el.tagName;
  if (DROP.has(tag)) {
    el.remove();
    return;
  }
  if (!ALLOWED.has(tag)) {
    // Unwrap: keep the content, lose the element
    el.replaceWith(...Array.from(el.childNodes));
    return;
  }

  const href = tag === "A" ? safeHref(el.getAttribute("href")) : null;
  for (const attr of Array.from(el.attributes)) {
    el.removeAttribute(attr.name);
  }
  if (tag === "A") {
    if (href) {
      el.setAttribute("href", href);
      el.setAttribute("target", "_blank");
      el.setAttribute("rel", "noreferrer noopener");
    } else {
      el.replaceWith(...Array.from(el.childNodes));
    }
  }
}

export function sanitizeHtml(html: string): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const child of Array.from(doc.body.children)) {
    clean(child);
  }
  return doc.body.innerHTML;
}

/** True when the markup contains no visible content. */
export function isEmptyHtml(html: string): boolean {
  if (!html) return true;
  const doc = new DOMParser().parseFromString(html, "text/html");
  return !doc.body.textContent?.trim();
}
