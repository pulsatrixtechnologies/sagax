// What a page version declares it uses (shared/page-capabilities.ts), as one
// short line on the publication card and in the app's open page (#3413 lot
// 1b): nothing the page may read is invisible, and a version that adds a
// capability says so before it is published. The declaration is read from
// the version's own HTML with the same parser the server uses.
import { t } from "@/lib/i18n";
import { pageIsHtml, type PageKind } from "../../shared/published-pages";
import { pageCapabilitiesAny, pageCapabilitiesOf, type PageCapabilities, type PageDataSource } from "../../shared/page-capabilities";

const SOURCE_WORDS: Record<PageDataSource, () => string> = {
  "team-board": () => t("pages.caps.source.team-board"),
};

/** The parts of a declaration, in words: each data source, the reader's
 * name and role, opening links and chats. Pure. */
export function capabilityParts(caps: PageCapabilities | null | undefined): string[] {
  if (!pageCapabilitiesAny(caps)) return [];
  return [
    ...caps.data.map((name) => SOURCE_WORDS[name]?.() ?? name),
    ...(caps.viewer ? [t("pages.caps.viewer")] : []),
    ...(caps.open ? [t("pages.caps.open")] : []),
  ];
}

/** What `next` declares that `before` did not. Pure. */
export function capabilitiesAdded(next: PageCapabilities | null | undefined, before: PageCapabilities | null | undefined): PageCapabilities | null {
  if (!pageCapabilitiesAny(next)) return null;
  const known = new Set<string>(before?.data ?? []);
  const added: PageCapabilities = {
    data: next.data.filter((name) => !known.has(name)),
    viewer: next.viewer && !before?.viewer,
    open: next.open && !before?.open,
  };
  return pageCapabilitiesAny(added) ? added : null;
}

/** The card's line: what the version reads, or what it adds to the
 * published one, else null (a page with no declaration shows nothing). */
export function capabilityLine(next: PageCapabilities | null | undefined, published?: PageCapabilities | null): string | null {
  if (!pageCapabilitiesAny(next)) return null;
  const added = published !== undefined ? capabilitiesAdded(next, published) : null;
  if (published !== undefined && added) return t("pages.caps.adds", { what: capabilityParts(added).join(", ") });
  return t("pages.caps.reads", { what: capabilityParts(next).join(", ") });
}

const declared = new Map<string, Promise<PageCapabilities | null>>();

/** A version's declaration, from its source (the person's own route; a
 * version never changes, so it is asked once). Null when it has none or
 * cannot be read. */
export function versionCapabilities(pageId: string, version: number, kind: PageKind | undefined, read: (path: string) => Promise<{ content?: unknown }>): Promise<PageCapabilities | null> {
  // only an HTML page can declare (the server reads it the same way)
  if (!kind || !pageIsHtml(kind)) return Promise.resolve(null);
  const key = `${pageId}:${version}`;
  let found = declared.get(key);
  if (!found) {
    found = read(`/api/pages/${encodeURIComponent(pageId)}/versions/${version}/source`)
      .then((answer) => (typeof answer.content === "string" ? pageCapabilitiesOf(answer.content) : null))
      .catch(() => { declared.delete(key); return null; });
    declared.set(key, found);
  }
  return found;
}

/** For tests: forget what was read. */
export function forgetVersionCapabilities(): void {
  declared.clear();
}
