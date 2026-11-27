// What a page version declares it uses (shared/page-capabilities.ts), as one
// short line on the publication card and in the app's open page (#3413 lot
// 1b): nothing the page may read is invisible, and a version that adds a
// capability says so before it is published. The declaration is the
// server's own reading of that version.
import { t } from "@/lib/i18n";
import { pageCapabilitiesAct, pageCapabilitiesAny, parsePageCapabilities, type PageCapabilities, type PageCapFile, type PageDataSource } from "../../shared/page-capabilities";

const SOURCE_WORDS: Record<PageDataSource, () => string> = {
  bot: () => t("pages.caps.source.bot"),
  "team-board": () => t("pages.caps.source.team-board"),
};

const FILE_WORDS: Record<PageCapFile, () => string> = {
  download: () => t("pages.caps.files.download"),
  add: () => t("pages.caps.files.add"),
};

/** The parts of a declaration, in words: each data source, the reader's
 * name and role, opening links and chats, files, what it keeps (#3413 lot
 * 3), a model question (lot 4), its own new versions (lot 6) and each of the
 * reader's connectors it calls, with its tools (lot 7). Pure. */
export function capabilityParts(caps: PageCapabilities | null | undefined): string[] {
  if (!pageCapabilitiesAny(caps)) return [];
  const scopes = new Set(Object.values(caps.store ?? {}).map((rule) => rule.scope));
  return [
    ...caps.data.map((name) => SOURCE_WORDS[name]?.() ?? name),
    ...(caps.viewer ? [t("pages.caps.viewer")] : []),
    ...(caps.open ? [t("pages.caps.open")] : []),
    ...(caps.files ?? []).map((name) => FILE_WORDS[name]?.() ?? name),
    ...(scopes.has("shared") ? [t("pages.caps.store.shared")] : []),
    ...(scopes.has("reader") ? [t("pages.caps.store.reader")] : []),
    ...(caps.model ? [t("pages.caps.model")] : []),
    ...(caps.propose ? [t("pages.caps.propose")] : []),
    ...Object.entries(caps.connectors ?? {}).map(([connector, tools]) => t("pages.caps.connector", { connector, tools: tools.join(", ") })),
  ];
}

/** What `next` declares that `before` did not. Pure. */
export function capabilitiesAdded(next: PageCapabilities | null | undefined, before: PageCapabilities | null | undefined): PageCapabilities | null {
  if (!pageCapabilitiesAny(next)) return null;
  const known = new Set<string>(before?.data ?? []);
  const knownFiles = new Set<string>(before?.files ?? []);
  const added: PageCapabilities = {
    data: next.data.filter((name) => !known.has(name)),
    viewer: next.viewer && !before?.viewer,
    open: next.open && !before?.open,
    files: (next.files ?? []).filter((name) => !knownFiles.has(name)),
  };
  const store = Object.fromEntries(Object.entries(next.store ?? {}).filter(([name, rule]) => before?.store?.[name]?.scope !== rule.scope));
  if (Object.keys(store).length) added.store = store;
  if (next.model && !before?.model) added.model = true;
  if (next.propose && !before?.propose) added.propose = true;
  const connectors = Object.fromEntries(Object.entries(next.connectors ?? {})
    .map(([connector, tools]) => [connector, tools.filter((tool) => !(before?.connectors?.[connector] ?? []).includes(tool))] as const)
    .filter(([, tools]) => tools.length));
  if (Object.keys(connectors).length) added.connectors = connectors;
  return pageCapabilitiesAny(added) ? added : null;
}

/** The card's line: what the version reads, or what it adds to the
 * published one, else null (a page with no declaration shows nothing). */
export function capabilityLine(next: PageCapabilities | null | undefined, published?: PageCapabilities | null): string | null {
  if (!pageCapabilitiesAny(next)) return null;
  const added = published !== undefined ? capabilitiesAdded(next, published) : null;
  if (published !== undefined && added) return t("pages.caps.adds", { what: capabilityParts(added).join(", ") });
  // a page that also keeps, adds, asks or acts says what it may do, not only read
  return t(pageCapabilitiesAct(next) ? "pages.caps.does" : "pages.caps.reads", { what: capabilityParts(next).join(", ") });
}

const declared = new Map<string, Promise<PageCapabilities | null>>();

/** A version's declaration, as the server read it from that version
 * (GET /api/pages/:id/capabilities?version=n, the page's own person); a
 * version never changes, so it is asked once. Null when it declares nothing
 * or cannot be read. */
export function versionCapabilities(pageId: string, version: number, read: (path: string) => Promise<{ capabilities?: unknown }>): Promise<PageCapabilities | null> {
  const key = `${pageId}:${version}`;
  let found = declared.get(key);
  if (!found) {
    found = read(`/api/pages/${encodeURIComponent(pageId)}/capabilities?version=${version}`)
      .then((answer) => parsePageCapabilities(answer.capabilities))
      .catch(() => { declared.delete(key); return null; });
    declared.set(key, found);
  }
  return found;
}

/** For tests: forget what was read. */
export function forgetVersionCapabilities(): void {
  declared.clear();
}
