// A text that holds web addresses, split so each address can be a link whose
// words are its host and path ("x.com/user/status/123"), never the whole URL
// (the Outcomes tab's Results value, 2026-11-17).
export type TextPart = { text: string; href?: string };

const URL_AT = /https?:\/\/[^\s<>"')\]]+/gi;
const TRAILING = /[.,;:!?]+$/;
const LABEL_MAX = 38;

/** "https://www.x.com/a/b?c=1#d" becomes "x.com/a/b", clipped in the middle of long paths. */
export function shortLinkLabel(href: string): string {
  let label: string;
  try {
    const url = new URL(href);
    label = `${url.host.replace(/^www\./i, "")}${url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "")}`;
  } catch {
    label = href.replace(/^https?:\/\//i, "");
  }
  return label.length > LABEL_MAX ? `${label.slice(0, LABEL_MAX - 1)}…` : label;
}

export function splitLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_AT)) {
    const start = match.index ?? 0;
    const href = match[0].replace(TRAILING, "");
    if (start > last) parts.push({ text: text.slice(last, start) });
    parts.push({ text: shortLinkLabel(href), href });
    last = start + href.length;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}
