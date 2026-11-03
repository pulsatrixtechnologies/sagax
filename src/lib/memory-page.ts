// Tools > Memory, the Perspicax console's shape (2026-11-02): the pure part
// of the page. Every source (a bot's memory, a team section, the Perspicax
// tiers) becomes rows of one list, each with its tier, its folder and what
// the console shows on a row; the views (Notes, Map, Tags, Quality) count
// from these rows only, so a number on the page is always one Sagax holds.
import type { MemoryJournalRow } from "./memory";
import type { MemoryManagerSource, MemoryNoteRow, MemoryVocabulary } from "./memory-manager";
import { extractWikiLinks } from "./memory-map";

/** Days without a change after which a note is old (the console's policy default). */
export const STALE_DAYS = 180;
/** "Recent": changed in the last seven days. */
export const RECENT_MS = 7 * 86_400_000;
const DAY = 86_400_000;
const WEEK = 7 * DAY;

export type TierKind = "mine" | "org" | "team";

export interface PageTier {
  /** "mine", a team source id, or "perspicax:<scope>". Never shown. */
  key: string;
  name: string;
  kind: TierKind;
  /** A CSS colour: the swatch of the explorer, the rows and the map. */
  color: string;
}

/** One note of the page, wherever it lives. */
export interface PageRow {
  /** `<source id>|<note id>`: stable, never shown. */
  key: string;
  /** The source the note opens, saves and deletes in. */
  source: MemoryManagerSource;
  row: MemoryNoteRow;
  /** The tier it is listed under (PageTier.key). */
  tier: string;
  /** The explorer folder it sits in (a key, never shown). */
  folderKey: string;
  /** The folder as the row shows it: "notes", "Atlas / Topics". */
  folderPath: string;
}

const TEAM_COLORS = [
  "var(--color-warning)",
  "color-mix(in srgb, var(--color-unread) 55%, var(--color-danger))",
  "var(--color-primary-badge)",
  "color-mix(in srgb, var(--color-success) 50%, var(--color-unread))",
  "var(--color-danger)",
];

/** The console's swatches: one's own memory green, the organization blue, each team a stable colour. */
export function tierColor(kind: TierKind, index = 0): string {
  if (kind === "mine") return "var(--color-success)";
  if (kind === "org") return "var(--color-unread)";
  return TEAM_COLORS[index % TEAM_COLORS.length]!;
}

export function rowKey(source: MemoryManagerSource, row: Pick<MemoryNoteRow, "id">): string {
  return `${source.id}|${row.id}`;
}

// ---- excerpts -----------------------------------------------------------------------

export interface JsonSummary {
  array: boolean;
  /** Items or keys; null when the excerpt was cut before the end. */
  count: number | null;
  keys: string[];
}

/** A JSON excerpt in words (the console's "JSON · n keys"), never the raw text. */
export function jsonSummary(excerpt: string | undefined): JsonSummary | null {
  const text = (excerpt ?? "").trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  const array = text.startsWith("[");
  try {
    const value: unknown = JSON.parse(text);
    if (Array.isArray(value)) return { array: true, count: value.length, keys: [] };
    if (value && typeof value === "object") {
      const keys = Object.keys(value);
      return { array: false, count: keys.length, keys: keys.slice(0, 4) };
    }
  } catch {
    // cut: read the top level keys seen
  }
  if (array) return { array: true, count: null, keys: [] };
  if (!/^\{\s*("|\}|$)/.test(text)) return null;
  const keys: string[] = [];
  let depth = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") depth -= 1;
    else if (char === '"' && depth === 1) {
      let end = index + 1;
      let name = "";
      while (end < text.length && text[end] !== '"') {
        if (text[end] === "\\") end += 1;
        name += text[end] ?? "";
        end += 1;
      }
      if (end >= text.length) break;
      if (text.slice(end + 1).trimStart().startsWith(":")) keys.push(name);
      index = end;
      if (keys.length >= 4) break;
    }
  }
  return { array: false, count: null, keys };
}

/** One line of a body's plain text: past the title, without the Markdown marks. */
export function excerptFromBody(body: string): string {
  const text = body.trim();
  if (text.startsWith("{") || text.startsWith("[")) return text.slice(0, 160);
  const lines = text.replace(/^---\n[\s\S]*?\n---\n?/, "").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^#{1,6}\s/.test(line) || line.startsWith("```") || /^[-*_]{3,}$/.test(line)) continue;
    const plain = line
      .replace(/^>\s?(\[![a-z]+\]\s*)?/i, "")
      .replace(/^[-*+]\s+(\[[ xX]\]\s+)?/, "")
      .replace(/^\d+\.\s+/, "")
      .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target: string, alias?: string) => alias ?? target)
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/[*_`~]+/g, "")
      .trim();
    if (plain) return plain.slice(0, 160);
  }
  return "";
}

// ---- time ----------------------------------------------------------------------------

export type RelKey = "now" | "min" | "hour" | "yesterday" | "days" | "date";

/** "9 h ago" and its kin, the console's steps; a date past a week. */
export function relTime(at: number | undefined, now: number, intl = "en"): { key: RelKey; n: number; date: string } | null {
  if (at == null || Number.isNaN(at)) return null;
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return { key: "now", n: 0, date: "" };
  if (seconds < 3600) return { key: "min", n: Math.round(seconds / 60), date: "" };
  if (seconds < 86_400) return { key: "hour", n: Math.round(seconds / 3600), date: "" };
  const days = Math.floor(seconds / 86_400);
  if (days === 1) return { key: "yesterday", n: 1, date: "" };
  if (days < 7) return { key: "days", n: days, date: "" };
  const sameYear = new Date(at).getFullYear() === new Date(now).getFullYear();
  const date = new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", year: sameYear ? undefined : "numeric" }).format(new Date(at));
  return { key: "date", n: 0, date };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

// ---- search, views, filters, order ----------------------------------------------------

function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export interface MemoryQuery {
  words: string[];
  tier: string[];
  folder: string[];
  tag: string[];
  author: string[];
  has: string[];
}

const OPERATORS: Record<string, keyof Omit<MemoryQuery, "words">> = {
  tier: "tier", scope: "tier", palier: "tier",
  folder: "folder", topic: "folder", dossier: "folder",
  tag: "tag", label: "tag", etiquette: "tag",
  author: "author", by: "author", auteur: "author",
  has: "has", avec: "has",
};

/** The console's search: words, and `tag:`, `folder:`, `author:`, `tier:`, `has:json` (quotes keep spaces). */
export function parseMemoryQuery(input: string): MemoryQuery {
  const query: MemoryQuery = { words: [], tier: [], folder: [], tag: [], author: [], has: [] };
  const re = /(\w+):(?:"([^"]*)"|(\S+))|"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    const operator = match[1] ? OPERATORS[fold(match[1])] : undefined;
    if (operator) {
      const value = fold((match[2] ?? match[3] ?? "").trim());
      if (value) query[operator].push(value);
    } else {
      const word = fold((match[1] ? match[0] : match[4] ?? match[5] ?? "").trim());
      if (word) query.words.push(word);
    }
  }
  return query;
}

export function hasOperators(query: MemoryQuery): boolean {
  return query.tier.length + query.folder.length + query.tag.length + query.author.length + query.has.length > 0;
}

/** Every word in the title, the excerpt, the folder or a tag; every operator holds. */
export function matchesQuery(entry: PageRow, query: MemoryQuery, tierName: string, body?: string): boolean {
  const row = entry.row;
  const hay = fold([row.title, row.excerpt ?? "", entry.folderPath, ...(row.tags ?? [])].join(" "));
  if (!query.words.every((word) => hay.includes(word))) return false;
  if (query.tier.length && !query.tier.some((value) => fold(tierName).includes(value) || (value === "me" && entry.tier === "mine"))) return false;
  if (query.folder.length && !query.folder.some((value) => fold(entry.folderPath).includes(value))) return false;
  if (query.tag.length && !query.tag.every((value) => (row.tags ?? []).some((tag) => fold(tag) === value || fold(tag).startsWith(`${value}:`)))) return false;
  if (query.author.length && !query.author.some((value) => fold(row.author ?? "").includes(value))) return false;
  for (const value of query.has) {
    if (value === "json") {
      const text = (body ?? row.excerpt ?? "").trim();
      if (!(text.startsWith("{") || text.startsWith("[") || /```json/i.test(text))) return false;
    } else if (value === "image" || value === "img") {
      if (!/!\[[^\]]*\]\([^)]+\)/.test(body ?? "")) return false;
    } else if (value === "links" || value === "link") {
      if (!row.links && !(body && extractWikiLinks(body).length)) return false;
    } else if (value === "tags" || value === "tag") {
      if (!(row.tags ?? []).length) return false;
    }
  }
  return true;
}

export type ListView = "active" | "all" | "archived" | "stale";
export const LIST_VIEWS: ListView[] = ["active", "all", "archived", "stale"];

/** The rows a named view keeps (the console's Vue): active, with the archived ones, the archived ones, the old ones. */
export function applyListView(rows: PageRow[], view: ListView, archived: PageRow[], now: number): PageRow[] {
  if (view === "all") return [...rows, ...archived];
  if (view === "archived") return archived;
  if (view === "stale") return rows.filter((entry) => entry.row.updatedAt != null && now - entry.row.updatedAt > STALE_DAYS * DAY);
  return rows;
}

export type AgeFilter = "" | "week" | "month" | "old";

export interface ListFilters {
  tiers: string[];
  tags: string[];
  authors: string[];
  age: AgeFilter;
}

export const NO_FILTERS: ListFilters = { tiers: [], tags: [], authors: [], age: "" };

export function filterCount(filters: ListFilters): number {
  return filters.tiers.length + filters.tags.length + filters.authors.length + (filters.age ? 1 : 0);
}

export function applyFilters(rows: PageRow[], filters: ListFilters, now: number): PageRow[] {
  return rows.filter((entry) => {
    if (filters.tiers.length && !filters.tiers.includes(entry.tier)) return false;
    if (filters.tags.length && !filters.tags.every((tag) => (entry.row.tags ?? []).includes(tag))) return false;
    if (filters.authors.length && !filters.authors.includes(entry.row.author ?? "")) return false;
    if (filters.age) {
      const at = entry.row.updatedAt;
      if (at == null) return false;
      const days = (now - at) / DAY;
      if (filters.age === "week" && days > 7) return false;
      if (filters.age === "month" && days > 30) return false;
      if (filters.age === "old" && days <= STALE_DAYS) return false;
    }
    return true;
  });
}

/** Each value with the rows that carry it, most used first. */
export function facetCounts(rows: PageRow[], of: (entry: PageRow) => string[]): Array<{ value: string; count: number }> {
  const counts = new Map<string, number>();
  for (const entry of rows) for (const value of new Set(of(entry))) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export type ListSort = "updated" | "title" | "manual";

export function sortPageRows(rows: PageRow[], sort: ListSort): PageRow[] {
  const out = [...rows];
  const title = (entry: PageRow) => entry.row.title || entry.row.id;
  if (sort === "title") out.sort((a, b) => title(a).localeCompare(title(b), undefined, { sensitivity: "base" }) || a.key.localeCompare(b.key));
  else if (sort === "manual") {
    // The folder's own order (a Perspicax rank, else the order the source lists).
    const index = new Map(rows.map((entry, i) => [entry.key, i]));
    out.sort((a, b) => (a.row.rank ?? Number.MAX_SAFE_INTEGER) - (b.row.rank ?? Number.MAX_SAFE_INTEGER) || (index.get(a.key)! - index.get(b.key)!));
  } else out.sort((a, b) => (b.row.updatedAt ?? 0) - (a.row.updatedAt ?? 0) || title(a).localeCompare(title(b)));
  return out;
}

// ---- bot journals ---------------------------------------------------------------------

export interface JournalFacts {
  createdAt?: number;
  lastActor?: MemoryJournalRow["actor"];
  lastAt?: number;
  versions: number;
  rows: MemoryJournalRow[];
}

/** What a bot's journal says of each of its files: created, last writer, versions. */
export function journalFacts(rows: MemoryJournalRow[]): Map<string, JournalFacts> {
  const out = new Map<string, JournalFacts>();
  const sorted = [...rows].sort((a, b) => a.at - b.at);
  for (const row of sorted) {
    const facts = out.get(row.path) ?? { versions: 0, rows: [] };
    if (row.kind === "created" && facts.createdAt == null) facts.createdAt = row.at;
    if (row.kind !== "deleted") facts.versions += 1;
    facts.lastActor = row.actor;
    facts.lastAt = row.at;
    facts.rows.push(row);
    out.set(row.path, facts);
  }
  return out;
}

// ---- links ------------------------------------------------------------------------------

export interface PageLink {
  key: string;
  title: string;
  /** The citing line around the link (backlinks only). */
  context?: string;
}

/** The notes a body links to by [[title]], among the rows given. */
export function linksOut(body: string, rows: PageRow[], self: string): PageLink[] {
  const byTitle = new Map<string, PageRow>();
  for (const entry of rows) byTitle.set(entry.row.title.trim().toLowerCase(), entry);
  const out: PageLink[] = [];
  for (const target of extractWikiLinks(body)) {
    const hit = byTitle.get(target);
    if (hit && hit.key !== self && !out.some((link) => link.key === hit.key)) out.push({ key: hit.key, title: hit.row.title });
  }
  return out;
}

/** The notes whose body links to `title` by [[title]], with the line that cites it. */
export function backlinksTo(title: string, rows: PageRow[], bodies: Record<string, string>, self: string): PageLink[] {
  const wanted = title.trim().toLowerCase();
  if (!wanted) return [];
  const out: PageLink[] = [];
  for (const entry of rows) {
    if (entry.key === self) continue;
    const body = bodies[entry.key];
    if (!body || !extractWikiLinks(body).includes(wanted)) continue;
    const line = body.split("\n").find((text) => text.toLowerCase().includes(`[[${wanted}`));
    out.push({ key: entry.key, title: entry.row.title, context: line?.trim() });
  }
  return out;
}

// ---- tags -------------------------------------------------------------------------------

export interface TagStats {
  /** The organization's namespaces and values: null without a vocabulary to read. */
  namespaces: number | null;
  controlled: number | null;
  required: number | null;
  values: number | null;
  free: Array<{ tag: string; count: number }>;
  /** Tags of a namespace whose value it does not hold: null without a vocabulary. */
  orphans: Array<{ tag: string; count: number; closest: string | null }> | null;
  top: Array<{ tag: string; count: number; share: number }>;
  used: number;
}

function namespaceOf(tag: string): string | null {
  const cut = tag.indexOf(":");
  return cut > 0 ? tag.slice(0, cut) : null;
}

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length]!;
}

export function tagStats(rows: PageRow[], vocabulary: MemoryVocabulary | null): TagStats {
  const counts = new Map<string, number>();
  for (const entry of rows) for (const tag of new Set(entry.row.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  const known = new Map<string, Set<string>>();
  for (const ns of vocabulary?.namespaces ?? []) known.set(ns.id, new Set(ns.tags.map((value) => value.tag)));
  const free: TagStats["free"] = [];
  const orphans: NonNullable<TagStats["orphans"]> = [];
  for (const [tag, count] of counts) {
    const ns = namespaceOf(tag);
    const values = ns ? known.get(ns) : undefined;
    if (!values) free.push({ tag, count });
    else if (!values.has(tag)) {
      let closest: string | null = null;
      let best = Infinity;
      for (const value of values) {
        const d = distance(tag, value);
        if (d < best) { best = d; closest = value; }
      }
      orphans.push({ tag, count, closest: best <= Math.max(2, Math.floor(tag.length / 3)) ? closest : null });
    }
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8);
  const max = Math.max(1, ...sorted.map(([, count]) => count));
  const namespaces = vocabulary?.namespaces ?? null;
  return {
    namespaces: namespaces ? namespaces.length : null,
    controlled: namespaces ? namespaces.filter((ns) => ns.controlled).length : null,
    required: namespaces ? namespaces.filter((ns) => ns.required).length : null,
    values: namespaces ? namespaces.reduce((sum, ns) => sum + ns.tags.length, 0) : null,
    free: free.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    orphans: vocabulary ? orphans.sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)) : null,
    top: sorted.map(([tag, count]) => ({ tag, count, share: Math.round((100 * count) / max) })),
    used: counts.size,
  };
}

// ---- quality ----------------------------------------------------------------------------

export interface QualityStats {
  active: number;
  archived: number | null;
  inReview: number;
  aging: number;
  /** Notes that share their exact title with another note of the same tier. */
  duplicates: number;
  orphans: number | null;
}

export function qualityStats(rows: PageRow[], archived: number | null, inReview: number, now: number, tags: TagStats): QualityStats {
  const titles = new Map<string, number>();
  for (const entry of rows) {
    // a bot's memory is its own place: two bots each with a MEMORY.md are no doubles
    const place = entry.source.kind === "bot" ? entry.source.id : entry.tier;
    const key = `${place}\n${entry.row.title.trim().toLowerCase()}`;
    titles.set(key, (titles.get(key) ?? 0) + 1);
  }
  let duplicates = 0;
  for (const count of titles.values()) if (count > 1) duplicates += count;
  return {
    active: rows.length,
    archived,
    inReview,
    aging: rows.filter((entry) => entry.row.updatedAt != null && now - entry.row.updatedAt > STALE_DAYS * DAY).length,
    duplicates,
    orphans: tags.orphans ? tags.orphans.reduce((sum, orphan) => sum + orphan.count, 0) : null,
  };
}

/** The start of the week holding `at` (Sunday, local time). */
export function weekStart(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - date.getDay());
  return date.getTime();
}

export interface WeekPoint {
  start: number;
  values: Record<string, number>;
}

/** The active notes of each tier at the end of each of the last `weeks` weeks,
 * by the creation date of the notes the page holds today. Null when no note
 * carries a creation date. */
export function activeSeries(rows: PageRow[], tiers: string[], now: number, weeks = 26): WeekPoint[] | null {
  const dated = rows.filter((entry) => entry.row.createdAt != null);
  if (dated.length === 0) return null;
  const last = weekStart(now);
  const out: WeekPoint[] = [];
  for (let index = weeks - 1; index >= 0; index -= 1) {
    const start = last - index * WEEK;
    const end = start + WEEK;
    const values: Record<string, number> = {};
    for (const tier of tiers) values[tier] = 0;
    for (const entry of dated) if (entry.row.createdAt! < end && entry.tier in values) values[entry.tier]! += 1;
    out.push({ start, values });
  }
  return out;
}

/** The writes of each week (the bots' journals): by a bot, by the person. Null without a journal row. */
export function writeSeries(journal: MemoryJournalRow[], now: number, weeks = 12): WeekPoint[] | null {
  if (journal.length === 0) return null;
  const last = weekStart(now);
  const first = last - (weeks - 1) * WEEK;
  const out: WeekPoint[] = Array.from({ length: weeks }, (_, index) => ({ start: first + index * WEEK, values: { bot: 0, person: 0 } }));
  for (const row of journal) {
    const index = Math.floor((weekStart(row.at) - first) / WEEK);
    if (index < 0 || index >= weeks) continue;
    const series = row.actor === "person" ? "person" : "bot";
    out[index]!.values[series]! += 1;
  }
  return out;
}
