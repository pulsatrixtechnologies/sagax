// skills_find (#2613): the best skills and plugins for a task, across every
// marketplace the bot's person can see (official catalogs included) and the
// ClawHub registry. Ranking is plain token matching on name, category and
// description; installs go through act plugins (install / addMarketplace).
import { CLAWHUB_SEARCH, CLAWHUB_SITE, OFFICIAL_CATALOGS } from "../../shared/skill-catalogs.ts";

export interface FindListing {
  name: string;
  source: string;
  description?: string;
  plugins: Array<{ name: string; description?: string; category?: string; installed: boolean }>;
}

export interface FindHit {
  kind: "plugin" | "catalog" | "clawhub";
  name: string;
  score: number;
  description?: string;
  category?: string;
  /** the marketplace it installs from (kind plugin) */
  marketplace?: string;
  installed?: boolean;
  /** owner/repo to add (kind catalog) or the ClawHub page */
  source?: string;
  url?: string;
}

const STOP = new Set(["a", "an", "and", "the", "for", "to", "of", "in", "on", "with", "my", "me", "i", "de", "la", "le", "les", "des", "du", "un", "une", "et", "pour", "avec", "en", "au", "aux", "skill", "skills", "plugin", "plugins"]);

export function queryTokens(query: string): string[] {
  return [...new Set(query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !STOP.has(token)))];
}

/** Score of one entry: name hits weigh most, then category, then description. */
export function scoreEntry(tokens: readonly string[], entry: { name: string; description?: string; category?: string }): number {
  if (!tokens.length) return 0;
  const name = entry.name.toLowerCase();
  const nameParts = new Set(name.split(/[^a-z0-9]+/));
  const category = (entry.category ?? "").toLowerCase();
  const description = (entry.description ?? "").toLowerCase();
  let score = 0;
  let matched = 0;
  for (const token of tokens) {
    let hit = 0;
    if (nameParts.has(token)) hit = 6;
    else if (name.includes(token)) hit = 4;
    if (category && category.includes(token)) hit = Math.max(hit, 2);
    if (description.includes(token)) hit += 1.5;
    if (hit) matched += 1;
    score += hit;
  }
  // an entry that covers more of the task ranks above one that repeats a word
  return matched ? score * (matched / tokens.length) : 0;
}

/** The local hits: plugins of the listed marketplaces, and the official
 * catalogs not yet added (to add in one call). */
export function rankLocal(query: string, listings: readonly FindListing[], limit: number): FindHit[] {
  const tokens = queryTokens(query);
  const hits: FindHit[] = [];
  for (const market of listings) {
    for (const plugin of market.plugins) {
      const score = scoreEntry(tokens, plugin);
      if (score > 0) {
        hits.push({
          kind: "plugin", name: plugin.name, score, marketplace: market.name, installed: plugin.installed,
          ...(plugin.description ? { description: plugin.description } : {}),
          ...(plugin.category ? { category: plugin.category } : {}),
        });
      }
    }
  }
  hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}

/** The official catalogs this person has not added yet. */
export function missingCatalogs(listings: readonly FindListing[]): FindHit[] {
  const added = new Set(listings.map((market) => market.source.toLowerCase()));
  return OFFICIAL_CATALOGS.filter((catalog) => !added.has(catalog.source.toLowerCase())).map((catalog) => ({
    kind: "catalog" as const, name: catalog.id, score: 0, description: catalog.description, source: catalog.source, url: catalog.site,
  }));
}

/** ClawHub search, cached a few minutes per query (its terms ask clients to
 * cache and to back off on 429). Never throws: an empty list on failure. */
const clawCache = new Map<string, { at: number; hits: FindHit[] }>();
let clawBackoffUntil = 0;
const CLAW_TTL_MS = 10 * 60_000;

export async function searchClawHub(query: string, limit: number, fetcher: typeof fetch, now = Date.now()): Promise<{ hits: FindHit[]; note?: string }> {
  const key = `${query.trim().toLowerCase()}\0${limit}`;
  const cached = clawCache.get(key);
  if (cached && now - cached.at < CLAW_TTL_MS) return { hits: cached.hits };
  if (now < clawBackoffUntil) return { hits: [], note: "ClawHub asked to slow down: try again in a minute." };
  const url = new URL(CLAWHUB_SEARCH);
  url.searchParams.set("q", query.trim().slice(0, 200));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("nonSuspiciousOnly", "true");
  try {
    const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(8_000) });
    if (response.status === 429) {
      const retry = Number(response.headers.get("retry-after"));
      clawBackoffUntil = now + (Number.isFinite(retry) && retry > 0 ? Math.min(retry, 600) * 1000 : 60_000);
      return { hits: [], note: "ClawHub asked to slow down: try again in a minute." };
    }
    if (!response.ok) return { hits: [], note: `ClawHub answered ${response.status}.` };
    const body = await response.json() as { results?: unknown };
    const results = Array.isArray(body.results) ? body.results : [];
    const hits: FindHit[] = [];
    for (const item of results.slice(0, limit)) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const slug = typeof row.slug === "string" ? row.slug : "";
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(slug)) continue;
      const owner = typeof row.ownerHandle === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(row.ownerHandle) ? row.ownerHandle : undefined;
      const summary = typeof row.summary === "string" ? row.summary.slice(0, 300) : undefined;
      hits.push({
        kind: "clawhub",
        name: typeof row.displayName === "string" && row.displayName.trim() ? row.displayName.trim().slice(0, 80) : slug,
        score: typeof row.score === "number" ? row.score : 0,
        ...(summary ? { description: summary } : {}),
        source: slug,
        url: typeof row.canonicalUrl === "string" && /^\/[A-Za-z0-9._/-]{1,200}$/.test(row.canonicalUrl) ? `${CLAWHUB_SITE}${row.canonicalUrl}`
          : owner ? `${CLAWHUB_SITE}/${owner}/skills/${slug}` : `${CLAWHUB_SITE}/skills/${slug}`,
      });
    }
    if (clawCache.size > 200) clawCache.clear();
    clawCache.set(key, { at: now, hits });
    return { hits };
  } catch {
    return { hits: [], note: "ClawHub could not be reached." };
  }
}

/** The answer the bot reads: ranked hits, each with how to install it. */
export function findReport(query: string, local: readonly FindHit[], missing: readonly FindHit[], claw: { hits: readonly FindHit[]; note?: string }): string {
  const lines: string[] = [`Skills and plugins for: ${query}`];
  if (local.length) {
    lines.push("", "In your marketplaces (install with act plugins action install, marketplace and plugin; it waits for Allow unless this bot is auto or full):");
    for (const hit of local) {
      lines.push(`- ${hit.name} @ ${hit.marketplace}${hit.installed ? " (installed on this bot)" : ""}${hit.category ? ` [${hit.category}]` : ""}${hit.description ? `: ${hit.description}` : ""}`);
    }
  } else {
    lines.push("", "Nothing in your marketplaces matches.");
  }
  if (missing.length) {
    lines.push("", "Official catalogs not added yet (add with act plugins action addMarketplace, source; then search again):");
    for (const hit of missing) lines.push(`- ${hit.name}: source ${hit.source}. ${hit.description ?? ""}`.trimEnd());
  }
  if (claw.hits.length) {
    lines.push("", "On ClawHub (OpenClaw registry; review the page, then install it on this bot with skill_manage action create and its full SKILL.md as skill_md):");
    for (const hit of claw.hits) lines.push(`- ${hit.name} (${hit.source})${hit.description ? `: ${hit.description}` : ""} ${hit.url}`);
  }
  if (claw.note) lines.push("", claw.note);
  lines.push("", "Offer the best matches to the person and install the ones they pick.");
  return lines.join("\n");
}
