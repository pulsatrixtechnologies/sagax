// Connect Apps' one search (2026-10-29, the owner: one option, one place).
// A single field under the title and the scope looks everywhere: plugins,
// apps, skills, MCP servers (installed or not), bots (the person's own, the
// ones shared with them, the organization's), templates (the xAI Bot
// Marketplace's too), published pages and sources. The matches come grouped
// by kind, in this order; each opens its page or its tab
// (src/components/plugins/ConnectAppsSearch.tsx). Empty: no groups, every tab
// shows its own list. Pure, for tests.
import { matchesQuery, type PluginItem } from "@/lib/plugins-model";
import { matchesCatalogQuery, type CatalogItem } from "@/lib/bot-catalog";

export type SearchGroupId = "plugins" | "apps" | "skills" | "mcp" | "bots" | "templates" | "pages" | "sources";

export const SEARCH_GROUP_ORDER: readonly SearchGroupId[] = ["plugins", "apps", "skills", "mcp", "bots", "templates", "pages", "sources"];

/** A published page, as Connect Apps > Pages lists it. */
export interface SearchPage {
  id: string;
  title: string;
  status?: string;
}

/** A source: a marketplace, or the person's GitHub connection. */
export interface SearchSource {
  /** "github", or "market:<name>" */
  id: string;
  name: string;
  /** where it comes from (a marketplace's repository) */
  detail?: string;
}

export type SearchResult =
  | { kind: "item"; key: string; group: SearchGroupId; item: PluginItem }
  | { kind: "catalog"; key: string; group: SearchGroupId; item: CatalogItem }
  | { kind: "page"; key: string; group: SearchGroupId; page: SearchPage }
  | { kind: "source"; key: string; group: SearchGroupId; source: SearchSource }
  | { kind: "account"; key: string; group: SearchGroupId; account: SearchAccount };

/** An engine account's connector (Claude, Grok, ChatGPT; #2306): a row of
 * Discover's "From <provider>" and of Installed */
export interface SearchAccount {
  key: string;
  name: string;
  /** its sub-line: "connector (Claude account)" */
  detail: string;
}

export interface SearchGroup {
  id: SearchGroupId;
  results: SearchResult[];
}

export interface SearchInput {
  query: string;
  /** every plugin, app, skill and server of the scope (installed or not) */
  items: readonly PluginItem[];
  /** Browse Bots' rows: bots and templates */
  catalog: readonly CatalogItem[];
  pages: readonly SearchPage[];
  sources: readonly SearchSource[];
  /** the engine accounts' connectors */
  accounts?: readonly SearchAccount[];
}

/** Case and accents ignored, every word somewhere. */
export function foldedMatch(text: string, query: string): boolean {
  const fold = (value: string) => value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const words = fold(query).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  const haystack = fold(text);
  return words.every((word) => haystack.includes(word));
}

/** The group a plugin row belongs to. */
export function itemGroup(item: Pick<PluginItem, "kind">): SearchGroupId {
  if (item.kind === "plugin") return "plugins";
  if (item.kind === "skill") return "skills";
  if (item.kind === "mcp") return "mcp";
  return "apps";
}

/** The matches of a search, grouped by kind in SEARCH_GROUP_ORDER; groups
 * without a match are left out. Blank: nothing. */
export function searchConnectApps(input: SearchInput): SearchGroup[] {
  const query = input.query.trim();
  if (!query) return [];
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const add = (result: SearchResult) => {
    if (seen.has(result.key)) return;
    seen.add(result.key);
    results.push(result);
  };
  const items = input.items
    .filter((item) => matchesQuery(item, query) || foldedMatch(`${item.name} ${item.description}`, query))
    .sort((a, b) => Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name));
  for (const item of items) add({ kind: "item", key: `item:${item.key}`, group: itemGroup(item), item });
  for (const account of input.accounts ?? []) {
    if (foldedMatch(account.name, query)) add({ kind: "account", key: `account:${account.key}`, group: "apps", account });
  }
  for (const item of input.catalog) {
    if (!matchesCatalogQuery(item, query) && !foldedMatch(catalogText(item), query)) continue;
    add({ kind: "catalog", key: `catalog:${item.key}`, group: item.kind === "bot" ? "bots" : "templates", item });
  }
  for (const page of input.pages) {
    if (foldedMatch(page.title, query)) add({ kind: "page", key: `page:${page.id}`, group: "pages", page });
  }
  for (const source of input.sources) {
    if (foldedMatch(`${source.name} ${source.detail ?? ""}`, query)) add({ kind: "source", key: `source:${source.id}`, group: "sources", source });
  }
  return SEARCH_GROUP_ORDER
    .map((id) => ({ id, results: results.filter((result) => result.group === id) }))
    .filter((group) => group.results.length > 0);
}

function catalogText(item: CatalogItem): string {
  return item.kind === "bot"
    ? `${item.entry.name} ${item.entry.title} ${item.entry.description} ${item.entry.owner.name}`
    : `${item.template.name} ${item.template.title} ${item.template.description}`;
}

/** Rows a group shows before "Show more". */
export const GROUP_PREVIEW = 5;

/** The rows on screen, in order (the keyboard walks them): each group's
 * first GROUP_PREVIEW, or all of an opened group. */
export function visibleResults(groups: readonly SearchGroup[], opened: ReadonlySet<SearchGroupId>): SearchResult[] {
  return groups.flatMap((group) => opened.has(group.id) ? group.results : group.results.slice(0, GROUP_PREVIEW));
}

/** The next row for an arrow key, wrapping; -1: none. */
export function moveActive(current: number, count: number, step: 1 | -1): number {
  if (count === 0) return -1;
  if (current < 0) return step === 1 ? 0 : count - 1;
  return (current + step + count) % count;
}
