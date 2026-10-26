// The Plugins panel's one list: the xAI cloud connectors, MCP servers the
// person added, the reviewed plugin catalog and local skills, read as rows
// of one kind. Pure functions only, so the three views and their tests share
// the same sorting, search and sections.

export type PluginKind = "app" | "mcp" | "featured" | "skill" | "plugin";
/** The chips in the row, in the reference order, then the ones under More. */
export const MAIN_CATEGORIES = ["passwords", "productivity", "communication", "design", "code"] as const;
export const MORE_CATEGORIES = ["data", "sales", "finance", "marketing", "research", "support", "other"] as const;
export type PluginCategory = (typeof MAIN_CATEGORIES)[number] | (typeof MORE_CATEGORIES)[number];
/** A category chip of the main view: everything or one category. */
export type PluginFilter = "all" | PluginCategory;
/** The small type filter at the end of the chip row: a kind or a source. */
export type PluginTypeFilter = "any" | "apps" | "mcp" | "skills" | `source:${string}`;
export type PluginStatus = "connected" | "needs_auth" | "pending" | "off" | "available";

export interface PluginItem {
  /** `${kind}:${id}`, unique across the list */
  key: string;
  kind: PluginKind;
  id: string;
  name: string;
  description: string;
  logo?: string | null;
  domain?: string | null;
  category: PluginCategory;
  /** added or connected on this installation */
  installed: boolean;
  status: PluginStatus;
  /** what the row's button does: Add (nothing to sign in to), Connect (an
   * account), or nothing (installed: the row opens the detail page) */
  action: "add" | "connect" | null;
  /** where it came from: "manual", "catalog", "grok", "local" or a
   * marketplace name */
  source: string;
  /** the item this one is shown under: the marketplace plugin that
   * brought this server or skill, or Whop for its server */
  parent?: string;
  /** a marketplace plugin's version */
  version?: string;
  /** an installed marketplace plugin the marketplace has a newer version of */
  updateAvailable?: boolean;
  /** the version installed, when the marketplace offers another */
  installedVersion?: string;
  /** in the reviewed catalog: shown under Recommended for you */
  recommended?: boolean;
  /** the rows of other sources folded into this one (same app) */
  merged?: string[];
}

/** Tag words to a category, first rule first. A tag is a marketplace
 * plugin's category or a catalog category; a tag no rule knows says
 * nothing. */
const TAG_RULES: Array<[PluginCategory, RegExp]> = [
  ["passwords", /\bpassword/],
  ["support", /\b(support|help ?desk|ticketing|customer service)\b/],
  ["sales", /\b(crm|sales|e-?commerce|commerce|leads?)\b/],
  ["finance", /\b(finance|financial|accounting|payments?|banking|invoic\w*|billing|tax|crypto\w*)\b/],
  ["marketing", /\b(marketing|advertising|ads|seo)\b/],
  ["communication", /\b(communication|email|e-mail|mail|messaging|chat|social|sms|phone|video conferencing|meetings?)\b/],
  ["design", /\b(design|creative|drawing|whiteboard\w*)\b/],
  ["code", /\b(developer|development|devops|code|coding|engineering|monitoring|deployment|hosting|infrastructure|cloud)\b/],
  ["data", /\b(analytics|data|databases?|business intelligence|bi|spreadsheets?)\b/],
  ["research", /\b(research|search|knowledge|news|education|learning|documentation|science|reference)\b/],
  ["productivity", /\b(productivity|project management|tasks?|documents?|files?|storage|notes?|calendar|scheduling|collaboration|workflows?|automation|forms?)\b/],
];

/** The category of the first tag a rule knows; "other" when none does or
 * there is no tag. Never guessed from the name. */
export function categoryFromTags(tags: ReadonlyArray<string | null | undefined> | null | undefined): PluginCategory {
  for (const tag of tags ?? []) {
    const text = String(tag ?? "").trim().toLowerCase();
    if (!text) continue;
    for (const [category, rule] of TAG_RULES) {
      if (rule.test(text)) return category;
    }
  }
  return "other";
}

/** The sections of the main view, in the chip order. */
export const CATEGORY_ORDER: PluginCategory[] = [...MAIN_CATEGORIES, ...MORE_CATEGORIES];

/** One app's key across sources: "Asana", "asana" and "Asana MCP" match. */
export function appKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\((?:mcp|beta)\)|\bmcp\b|\bserver\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

interface McpListing {
  name: string;
  enabled: boolean;
  url?: string;
  command?: string;
  auth?: string;
  managedBy?: string;
  source?: string;
}
interface FeaturedListing {
  id: string; name: string; description: string; url: string; domain: string; auth: string; installed?: boolean;
  /** the provider's own site, for its icon (domain is the MCP host) */
  site?: string;
  category?: string;
  iconUrl?: string;
}
interface SkillListing { name: string; description: string; source: string; enabled: boolean }
interface MarketplaceListing {
  name: string;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; installed: boolean; servers: string[]; skills: string[];
    installedVersion?: string; updateAvailable?: boolean;
  }>;
}

export interface PluginSources {
  servers?: readonly McpListing[] | null;
  featured?: readonly FeaturedListing[] | null;
  skills?: readonly SkillListing[] | null;
  marketplaces?: readonly MarketplaceListing[] | null;
  /** Whop, an MCP server connected like an app (#2411): its server's name
   * once added, and whether it is signed in and on. */
  whop?: { description: string; server?: string; connected: boolean } | null;
  /** Cloud connectors of the xAI account (shared/grok-cloud-connectors.ts),
   * only when a Grok provider is set up. A catalog of names managed on
   * grok.com: never connected, never merged with an MCP server. */
  grok?: { connectors: readonly { id: string; name: string; tag: string }[]; description: string } | null;
}

/** Grok connector rows live in their own namespace: their key and id start
 * with this, so they never merge with an MCP server row. */
export const GROK_CONNECTOR_PREFIX = "grok:";

/** A row of the xAI connector catalog (managed on grok.com, not here). */
export const isGrokConnector = (item: Pick<PluginItem, "source" | "key">) =>
  item.source === "grok" && item.key.startsWith(GROK_CONNECTOR_PREFIX);

export const WHOP_KEY = "whop:whop";

/** The key of a marketplace plugin row. */
export const marketplacePluginKey = (marketplace: string, plugin: string) => `plugin:${plugin}@${marketplace}`;

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Every row, deduplicated: a featured plugin already added shows once, as
 * the MCP server it became. */
export function buildPluginItems(sources: PluginSources): PluginItem[] {
  const items: PluginItem[] = [];
  for (const connector of sources.grok?.connectors ?? []) {
    const id = connector.id.trim();
    const name = connector.name.trim();
    if (!id || !name) continue;
    items.push({
      key: `${GROK_CONNECTOR_PREFIX}${id}`,
      kind: "app",
      id: `${GROK_CONNECTOR_PREFIX}${id}`,
      name,
      description: sources.grok!.description,
      domain: "grok.com",
      category: categoryFromTags([connector.tag]),
      installed: false,
      status: "available",
      action: null,
      source: "grok",
    });
  }
  if (sources.whop) {
    items.push({
      key: WHOP_KEY,
      kind: "featured",
      id: "whop",
      name: "Whop",
      description: sources.whop.description,
      domain: "whop.com",
      category: "sales",
      recommended: true,
      installed: sources.whop.connected,
      status: sources.whop.connected ? "connected" : "available",
      action: sources.whop.connected ? null : "connect",
      source: "catalog",
    });
  }
  // What each installed marketplace plugin brought, so its servers and
  // skills show under it rather than twice.
  const serverParent = new Map<string, string>();
  const skillParent = new Map<string, string>();
  for (const market of sources.marketplaces ?? []) {
    for (const plugin of market.plugins) {
      if (!plugin.installed) continue;
      const key = marketplacePluginKey(market.name, plugin.name);
      for (const server of plugin.servers) serverParent.set(server, key);
      for (const skill of plugin.skills) skillParent.set(skill, key);
    }
  }
  const serverUrls = new Set<string>();
  for (const server of sources.servers ?? []) {
    if (server.url) serverUrls.add(server.url);
    const domain = hostOf(server.url);
    const needsAuth = server.auth === "required" || server.auth === "expired" || server.auth === "error";
    items.push({
      key: `mcp:${server.name}`,
      kind: "mcp",
      id: server.name,
      name: server.name,
      description: server.url ?? server.command ?? "",
      domain,
      category: "other",
      installed: true,
      status: !server.enabled || server.managedBy ? "off" : needsAuth ? "needs_auth" : "connected",
      action: null,
      source: server.source ?? "manual",
      ...(server.source && serverParent.has(server.name) ? { parent: serverParent.get(server.name) } : {}),
      ...(sources.whop?.server === server.name ? { parent: WHOP_KEY } : {}),
    });
  }
  for (const listing of sources.featured ?? []) {
    if (listing.installed || serverUrls.has(listing.url)) continue;
    items.push({
      key: `featured:${listing.id}`,
      kind: "featured",
      id: listing.id,
      name: listing.name,
      description: listing.description,
      domain: listing.site ?? listing.domain,
      logo: listing.iconUrl ?? null,
      category: categoryFromTags([listing.category]),
      recommended: true,
      installed: false,
      status: "available",
      action: listing.auth === "oauth" ? "connect" : "add",
      source: "catalog",
    });
  }
  for (const skill of sources.skills ?? []) {
    items.push({
      key: `skill:${skill.name}`,
      kind: "skill",
      id: skill.name,
      name: skill.name,
      description: skill.description,
      category: "other",
      installed: true,
      status: skill.enabled ? "connected" : "off",
      action: null,
      source: skill.source === "local-import" ? "local" : skill.source,
      ...(skillParent.has(skill.name) && skill.source !== "local-import" ? { parent: skillParent.get(skill.name) } : {}),
    });
  }
  for (const market of sources.marketplaces ?? []) {
    for (const plugin of market.plugins) {
      items.push({
        key: marketplacePluginKey(market.name, plugin.name),
        kind: "plugin",
        id: `${plugin.name}@${market.name}`,
        name: plugin.name,
        description: plugin.description ?? "",
        category: categoryFromTags([plugin.category]),
        installed: plugin.installed,
        status: plugin.installed ? "connected" : "available",
        action: plugin.installed ? null : "add",
        source: market.name,
        ...(plugin.version ? { version: plugin.version } : {}),
        ...(plugin.installed && plugin.updateAvailable ? { updateAvailable: true } : {}),
        ...(plugin.installed && plugin.installedVersion ? { installedVersion: plugin.installedVersion } : {}),
      });
    }
  }
  return mergeSameApps(items);
}

/** Kinds that stand for an app someone connects: the same app from a
 * featured listing and a catalog MCP server is one row. */
const mergeable = (item: PluginItem) => !item.parent && !isGrokConnector(item) && (item.kind === "app" || item.kind === "featured" || item.kind === "mcp");

/** One row per app. What is installed always shows; otherwise the row
 * offers the best way to connect it, preferring a featured listing over its
 * MCP server. The row keeps the best logo, site and category any of its
 * sources has, and stays recommended when one of them was. */
export function mergeSameApps(items: readonly PluginItem[]): PluginItem[] {
  const groups = new Map<string, PluginItem[]>();
  for (const item of items) {
    if (!mergeable(item)) continue;
    const key = appKey(item.name);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const replaced = new Map<string, PluginItem | null>();
  for (const group of groups.values()) {
    const logo = group.find((item) => item.logo)?.logo ?? null;
    const domain = group.find((item) => item.kind !== "mcp" && item.domain)?.domain ?? group.find((item) => item.domain)?.domain ?? null;
    const category = group.find((item) => item.category !== "other")?.category ?? "other";
    const recommended = group.some((item) => item.recommended);
    const installed = group.filter((item) => item.installed);
    const rank = (item: PluginItem) => item.kind === "app" ? 0 : item.kind === "featured" ? 1 : 3;
    const keep = installed.length ? installed : [[...group].sort((a, b) => rank(a) - rank(b))[0]!];
    for (const item of group) {
      if (!keep.includes(item)) {
        replaced.set(item.key, null);
        continue;
      }
      const merged = group.filter((other) => other !== item).map((other) => other.key);
      replaced.set(item.key, {
        ...item,
        logo: item.logo ?? logo,
        domain: domain ?? item.domain,
        category: item.category !== "other" ? item.category : category,
        ...(recommended ? { recommended: true } : {}),
        ...(merged.length ? { merged } : {}),
      });
    }
  }
  const out: PluginItem[] = [];
  for (const item of items) {
    if (!replaced.has(item.key)) out.push(item);
    else if (replaced.get(item.key)) out.push(replaced.get(item.key)!);
  }
  return out;
}

export function matchesQuery(item: PluginItem, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = `${item.name} ${item.id} ${item.description} ${item.domain ?? ""} ${item.source}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

export function matchesFilter(item: PluginItem, filter: PluginFilter): boolean {
  if (filter === "all") return true;
  return item.kind !== "skill" && item.category === filter;
}

export function matchesType(item: PluginItem, type: PluginTypeFilter): boolean {
  if (type === "any") return true;
  if (type === "apps") return item.kind === "app" || item.key === WHOP_KEY;
  if (type === "mcp") return item.kind === "mcp" || (item.kind === "featured" && item.key !== WHOP_KEY);
  if (type === "skills") return item.kind === "skill";
  return item.source === type.slice("source:".length) && !item.parent;
}

/** Installed first, then by name: what the person has is what they look for. */
function byInstalledThenName(a: PluginItem, b: PluginItem): number {
  return Number(b.installed) - Number(a.installed) || a.name.localeCompare(b.name);
}

export interface PluginSection {
  /** "recommended", a category, "mcp", "skills", "results", a filter */
  id: string;
  /** what View all selects: a category chip or a type */
  filter: { filter: PluginFilter } | { type: PluginTypeFilter } | null;
  items: PluginItem[];
  total: number;
}

export const SECTION_PREVIEW = 6;

/** Apps and catalog plugins fill the category sections (and a server the
 * person added that is one of them); the person's own servers and skills
 * have theirs. */
const catalogued = (item: PluginItem) => item.kind === "app" || item.kind === "featured" || (item.kind === "mcp" && Boolean(item.merged));

/** The main view's sections. With a search, a chip or a type, one list of
 * matches; otherwise a short preview per category, each with View all. */
export function mainSections(items: readonly PluginItem[], query: string, filter: PluginFilter, type: PluginTypeFilter = "any", extraSources: readonly string[] = [], focus: readonly string[] = []): PluginSection[] {
  const visible = items.filter((item) => matchesQuery(item, query) && matchesFilter(item, filter) && matchesType(item, type));
  if (query.trim()) {
    const sorted = [...visible].sort(byInstalledThenName);
    return [{ id: "results", filter: null, items: sorted, total: sorted.length }];
  }
  if (filter !== "all" || type !== "any") {
    const sorted = [...visible].sort(byInstalledThenName);
    return [{ id: filter !== "all" ? filter : type, filter: null, items: sorted, total: sorted.length }];
  }
  const sections: PluginSection[] = [];
  const preview = (id: string, sectionFilter: PluginSection["filter"], list: PluginItem[]) => {
    if (list.length) sections.push({ id, filter: sectionFilter, items: list.slice(0, SECTION_PREVIEW), total: list.length });
  };
  // 2026-10-15: the apps a conversation needs (its Connect apps pill), in
  // the order it named them, ahead of everything else.
  if (focus.length) {
    const wanted = focus.map((slug) => slug.toLowerCase());
    const needed = wanted.flatMap((slug) => visible.filter((item) => item.kind === "app" && item.id.toLowerCase() === slug));
    if (needed.length) sections.push({ id: "needed", filter: null, items: needed, total: needed.length });
  }
  preview("recommended", null, visible.filter((item) => item.recommended && !item.installed));
  for (const source of extraSources) {
    preview(`source:${source}`, { type: `source:${source}` }, visible.filter((item) => item.source === source && !item.parent).sort(byInstalledThenName));
  }
  for (const category of CATEGORY_ORDER) {
    if (category === "other") continue;
    preview(category, { filter: category }, visible.filter((item) => catalogued(item) && item.category === category).sort(byInstalledThenName));
  }
  preview("mcp", { type: "mcp" }, visible.filter((item) => item.kind === "mcp").sort(byInstalledThenName));
  preview("skills", { type: "skills" }, visible.filter((item) => item.kind === "skill").sort(byInstalledThenName));
  preview("other", { filter: "other" }, visible.filter((item) => catalogued(item) && item.category === "other").sort(byInstalledThenName));
  return sections;
}

/** Installed plugins for the Manage page (skills have their own list; an item
 * that stands for servers, a marketplace plugin or Whop, shows instead). */
export function installedPlugins(items: readonly PluginItem[]): PluginItem[] {
  return items.filter((item) => item.installed && item.kind !== "skill" && !item.parent).sort((a, b) => a.name.localeCompare(b.name));
}

/** The header's "N connected": what reaches bots, with up to four icons.
 * Every source counts: connected apps, MCP servers, Whop, marketplace
 * plugins and the connectors a Claude account brings (`extra`). */
export function connectedSummary(items: readonly PluginItem[], extra = 0): { count: number; icons: PluginItem[] } {
  const connected = installedPlugins(items).filter((item) => item.status === "connected");
  return { count: connected.length + Math.max(0, extra), icons: connected.slice(0, 4) };
}
