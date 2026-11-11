// #3637: what a bot reads back from its plugins routes (act plugins, or the
// same routes called through act). The person's app keeps the routes' whole
// answers (server/routes/bot-plugins.ts); a bot's tool answer is cut at 8000
// characters (bot-act.ts run, agents-tools/core.ts act), so the whole listing
// (every marketplace with its full catalog) was cut in the middle of the
// first marketplace. Shaped here, at the tool boundary:
//
// - list: the bot's installed plugins (version, enabled, update waiting and
//   the offered version), then one line of facts per marketplace;
// - list with `marketplace` (and an optional `filter`): that marketplace's
//   catalog, paged with `offset`;
// - a write: its own object (the installed plugin, the marketplace) without
//   the listing.
//
// Whatever does not fit says what was left out and how to get it.

import type { ActTarget } from "../../shared/bot-act.ts";

/** Under every cut on the way to the model (8000 characters). */
export const BOT_PLUGIN_ANSWER_MAX = 7_000;
/** What performRoute may read for a plugin answer before it is shaped. */
export const BOT_PLUGIN_READ_MAX = 16_000_000;
const DESCRIPTION_MAX = 160;

const ROUTE = /^\/api\/(?:bots\/[\w-]+|me)\/plugins(\/.*)?$/;

type Json = Record<string, unknown>;
type CatalogEntry = Json & { name?: unknown; version?: unknown; installed?: unknown; installedVersion?: unknown; updateAvailable?: unknown };
type Market = Json & { name?: unknown; plugins?: unknown };

/** "list", "write", or null when the target is not a plugin route. */
export function pluginAnswerKind(target: ActTarget): "list" | "write" | null {
  if (target.kind !== "route") return null;
  const match = ROUTE.exec(target.path);
  if (!match) return null;
  const method = target.method.toUpperCase();
  if (method === "GET") return match[1] ? null : "list";
  return method === "HEAD" ? null : "write";
}

const object = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const size = (value: unknown) => JSON.stringify(value).length;

function marketLine(market: Market, pulledAt?: (name: string) => number | undefined): string {
  const name = text(market.name) ?? "?";
  const plugins = Array.isArray(market.plugins) ? market.plugins.length : 0;
  let pulled: number | undefined;
  try { pulled = pulledAt?.(name); } catch { pulled = undefined; }
  const facts = [
    `source ${text(market.source) ?? "?"}`,
    text(market.visibility) ?? "private",
    `token ${market.hasToken === true ? "yes" : "no"}`,
    ...(pulled !== undefined && Number.isFinite(pulled) ? [`pulled ${new Date(pulled).toISOString()}`] : []),
    `${plugins} plugins`,
  ];
  return `${name}: ${facts.join(", ")}`;
}

function installedOf(listing: Json): Json[] {
  const markets = Array.isArray(listing.marketplaces) ? listing.marketplaces.filter(object) as Market[] : [];
  const offered = new Map<string, CatalogEntry>();
  for (const market of markets) {
    if (!Array.isArray(market.plugins)) continue;
    for (const entry of market.plugins.filter(object) as CatalogEntry[]) {
      if (entry.installed === true && text(entry.name)) offered.set(`${entry.name as string}@${text(market.name) ?? ""}`, entry);
    }
  }
  const plugins = Array.isArray(listing.plugins) ? listing.plugins.filter(object) : [];
  return plugins.map((plugin) => {
    const key = text(plugin.key) ?? `${text(plugin.name) ?? "?"}@${text(plugin.marketplace) ?? "?"}`;
    const entry = offered.get(key);
    return {
      key,
      name: plugin.name,
      marketplace: plugin.marketplace,
      ...(text(plugin.version) ? { version: plugin.version } : {}),
      enabled: plugin.enabled === true,
      ...(entry?.updateAvailable === true ? { updateAvailable: true, ...(text(entry.version) ? { offeredVersion: entry.version } : {}) } : {}),
      ...(object(plugin.marketplacePull) ? { marketplacePull: plugin.marketplacePull } : {}),
    };
  });
}

function offsetOf(target: ActTarget): number {
  const raw = target.kind === "route" ? target.query?.offset : undefined;
  const value = raw === undefined ? 0 : Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Fill `items` from `offset` while `wrap(page)` stays under the limit; at least one. */
function page<T>(items: readonly T[], offset: number, wrap: (page: T[]) => Json, max = BOT_PLUGIN_ANSWER_MAX): { page: T[]; next: number } {
  const taken: T[] = [];
  let index = offset;
  while (index < items.length) {
    taken.push(items[index]!);
    if (taken.length > 1 && size(wrap(taken)) > max) {
      taken.pop();
      break;
    }
    index += 1;
  }
  return { page: taken, next: offset + taken.length };
}

function catalogEntry(entry: CatalogEntry): Json {
  const description = text(entry.description);
  return {
    name: entry.name,
    ...(description ? { description: description.length > DESCRIPTION_MAX ? `${description.slice(0, DESCRIPTION_MAX - 3)}...` : description } : {}),
    ...(text(entry.version) ? { version: entry.version } : {}),
    ...(text(entry.category) ? { category: entry.category } : {}),
    ...(entry.installed === true ? { installed: true } : {}),
    ...(text(entry.installedVersion) ? { installedVersion: entry.installedVersion } : {}),
    ...(entry.updateAvailable === true ? { updateAvailable: true } : {}),
    ...(entry.external === true ? { external: true } : {}),
  };
}

function listAnswer(target: ActTarget, listing: Json, pulledAt?: (name: string) => number | undefined): Json {
  const markets = Array.isArray(listing.marketplaces) ? listing.marketplaces.filter(object) as Market[] : [];
  const query = target.kind === "route" ? target.query ?? {} : {};
  const offset = offsetOf(target);
  const wanted = text(query.marketplace);
  if (wanted) {
    const market = markets.find((item) => item.name === wanted);
    if (!market) {
      return { error: `No marketplace named ${wanted} is visible to this bot.`, marketplaces: markets.map((item) => text(item.name)).filter(Boolean) };
    }
    const filter = text(query.filter)?.toLowerCase();
    const all = Array.isArray(market.plugins) ? market.plugins.filter(object) as CatalogEntry[] : [];
    const matched = filter
      ? all.filter((entry) => [entry.name, entry.description, entry.category].some((field) => typeof field === "string" && field.toLowerCase().includes(filter)))
      : all;
    const head = { marketplace: marketLine(market, pulledAt), ...(filter ? { filter: query.filter } : {}), total: all.length, matched: matched.length, offset };
    const more = (next: number) => next < matched.length
      ? { more: { offset: next, left: matched.length - next, how: `Call act plugins list again with marketplace ${wanted}${filter ? ", the same filter" : ""} and offset ${next}.` } }
      : {};
    const entries = matched.map(catalogEntry);
    const { page: shown, next } = page(entries, offset, (items) => ({ ...head, plugins: items, ...more(offset + items.length) }));
    return { ...head, plugins: shown, ...more(next) };
  }
  // #3637 review: the marketplace lines first (few, short, and their token
  // state is what a bot acts on), then the installed plugins, in one budget.
  // One sequence, one offset: a page never repeats a part already read.
  const lines = markets.map((market) => marketLine(market, pulledAt));
  const installed = installedOf(listing);
  type Item = { line: string } | { plugin: Json };
  const items: Item[] = [...lines.map((line) => ({ line })), ...installed.map((plugin) => ({ plugin }))];
  const head = {
    ...(object(listing.engine) && typeof listing.engine.loadsPlugins === "boolean" ? { engineLoadsPlugins: listing.engine.loadsPlugins } : {}),
    ...(typeof listing.canChange === "boolean" ? { canChange: listing.canChange } : {}),
    catalog: "One marketplace's plugins: act plugins list with marketplace (and optional filter).",
  };
  const more = (next: number) => next < items.length
    ? { more: {
      offset: next,
      left: { marketplaces: Math.max(0, lines.length - next), installed: Math.min(installed.length, items.length - next) },
      how: `The rest: call act plugins list again with offset ${next} (marketplace lines come first, then installed plugins; nothing already shown is repeated).`,
    } }
    : {};
  const shape = (taken: Item[], next: number): Json => ({
    marketplaces: taken.flatMap((item) => ("line" in item ? [item.line] : [])),
    installed: taken.flatMap((item) => ("plugin" in item ? [item.plugin] : [])),
    ...head,
    ...(offset ? { offset } : {}),
    ...more(next),
  });
  const { page: shown, next } = page(items, offset, (taken) => shape(taken, offset + taken.length));
  return shape(shown, next);
}

function writeAnswer(answer: Json, pulledAt?: (name: string) => number | undefined): Json {
  const { marketplaces: _markets, plugins: listed, policy: _policy, engine: _engine, canChange: _canChange, ...own } = answer;
  const shaped: Json = { ...own };
  if (object(own.marketplace)) shaped.marketplace = marketLine(own.marketplace as Market, pulledAt);
  // an answer with no object of its own (uninstall, removeMarketplace): the
  // first page of the listing a plain list gives, paged the same way
  if (!("plugin" in own) && !("marketplace" in own) && Array.isArray(listed)) {
    return { ...listAnswer({ kind: "route", method: "GET", path: "/api/bots/me/plugins" }, answer, pulledAt), ...shaped };
  }
  return shaped;
}

/** Cut a shaped answer that still does not fit, saying what was left out. */
function fit(answer: Json): string {
  const whole = JSON.stringify(answer);
  if (whole.length <= BOT_PLUGIN_ANSWER_MAX) return whole;
  const kept = whole.slice(0, BOT_PLUGIN_ANSWER_MAX - 400);
  return `${kept}\n[Cut by Sagax at ${kept.length} of ${whole.length} characters: the rest of this answer was left out. Ask for one marketplace (act plugins list with marketplace, filter and offset) to read it in parts.]`;
}

/** The answer a bot reads for a plugin route's answer text. A text that is
 * not a JSON object (an error, a cut read) is returned as it came. */
export function shapePluginAnswer(target: ActTarget, raw: string, options: { pulledAt?: (name: string) => number | undefined } = {}): string {
  const kind = pluginAnswerKind(target);
  if (!kind) return raw;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  if (!object(parsed)) return raw;
  if (typeof parsed.error === "string") return raw;
  return fit(kind === "list" ? listAnswer(target, parsed, options.pulledAt) : writeAnswer(parsed, options.pulledAt));
}
