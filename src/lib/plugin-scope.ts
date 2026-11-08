// One marketplace catalog, three independent capability scopes:
// workspace (Organization), me (the person's encrypted references), and
// bot (one bot). Every scope installs the whole sanitized plugin.
import type { BotPluginsView, InstalledPlugin, PluginContents } from "./my-connections";
import type { MarketplaceCredentialView } from "../../shared/github-credentials";

export type PluginScope = "workspace" | "me" | "bot";

/** The bot the "For this bot" scope is about, if any. */
export function pluginScopeBot<B extends { id: string }>(input: { pluginsBotId: string | null; selectedId: string; bots: readonly B[] }): B | null {
  const wanted = input.pluginsBotId ?? input.selectedId;
  return input.bots.find((bot) => bot.id === wanted) ?? null;
}

/** Opened from a bot (its panel): that bot's scope first. */
export function initialPluginScope(pluginsBotId: string | null, bot: { id: string } | null): PluginScope {
  return pluginsBotId && bot?.id === pluginsBotId ? "bot" : "me";
}

/** The panel's marketplace rows for the bot scope: installed means on this
 * bot, and an update is this bot's (Install again updates it in place).
 * No servers nor skills: a bot install links nothing of the workspace's.
 * `hasToken`: this bot keeps a token for the marketplace. */
export function botScopeMarketplaces(view: BotPluginsView): Array<{
  name: string; source: string; description?: string; hasToken?: boolean; credential?: MarketplaceCredentialView;
  visibility?: "private" | "org"; mine?: boolean;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; homepage?: string; icon?: string; installed: boolean; servers: string[]; skills: string[];
    convertedFrom?: string; notConverted?: string[];
    installedVersion?: string; updateAvailable?: boolean;
  }>;
}> {
  return view.marketplaces.map((market) => ({
    name: market.name,
    source: market.source,
    ...(market.description ? { description: market.description } : {}),
    ...(market.hasToken ? { hasToken: true } : {}),
    ...(market.credential ? { credential: market.credential } : {}),
    ...(market.visibility ? { visibility: market.visibility } : {}),
    ...(market.mine ? { mine: true } : {}),
    plugins: market.plugins.map((plugin) => ({
      name: plugin.name,
      ...(plugin.description ? { description: plugin.description } : {}),
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.category ? { category: plugin.category } : {}),
      ...(plugin.homepage ? { homepage: plugin.homepage } : {}),
      ...(plugin.icon ? { icon: plugin.icon } : {}),
      ...(plugin.convertedFrom ? { convertedFrom: plugin.convertedFrom } : {}),
      ...(plugin.notConverted?.length ? { notConverted: plugin.notConverted } : {}),
      installed: plugin.installed,
      ...(plugin.installed && plugin.installedVersion ? { installedVersion: plugin.installedVersion } : {}),
      ...(plugin.installed && plugin.updateAvailable ? { updateAvailable: true } : {}),
      servers: [],
      skills: [],
    })),
  }));
}

/** One plugin as the bot scope sees it: in a marketplace, and on the bot. */
export interface BotPluginState {
  key: string;
  marketplace: string;
  plugin: string;
  contents?: PluginContents;
  external: boolean;
  installed: InstalledPlugin | null;
}

/** `name@marketplace` (a plugin row's id) in this bot's view. */
export function botPluginState(view: BotPluginsView | null, id: string): BotPluginState | null {
  const at = id.lastIndexOf("@");
  if (!view || at <= 0) return null;
  const plugin = id.slice(0, at);
  const marketplace = id.slice(at + 1);
  const entry = view.marketplaces.find((market) => market.name === marketplace)?.plugins.find((candidate) => candidate.name === plugin);
  const installed = view.plugins.find((candidate) => candidate.key === id) ?? null;
  if (!entry && !installed) return null;
  return { key: id, marketplace, plugin, ...(entry?.contents ? { contents: entry.contents } : {}), external: entry?.external ?? false, installed };
}

/** Who may add, refresh or remove a marketplace, and through which route:
 * the workspace's routes for its managers, else the bot's own for a person
 * who may change that bot's plugins (a member's marketplace joins the one
 * list; removing it from a bot takes only that bot's plugins). */
export function marketplaceRoute(input: { workspaceManager: boolean; scope: PluginScope; botView: BotPluginsView | null; personalView?: BotPluginsView | null }): PluginScope | null {
  if (input.scope === "me") return input.personalView?.canChange ? "me" : null;
  if (input.scope === "bot" && input.botView?.canChange) return "bot";
  if (input.workspaceManager) return "workspace";
  return input.botView?.canChange ? "bot" : null;
}

/** Each marketplace's pick of a credential of the one list (Connect apps >
 * the GitHub plugin's page, 2026-10-28), in place of a token field: the bot's
 * (`/api/bots/:id/plugins/.../credential`, its owner or a manager) or the
 * installation's (`/api/marketplaces/:name/credential`, the workspace's
 * managers). After a pick the marketplace is fetched again with it. */
export function marketplaceCredentialControls<L>(deps: {
  route: PluginScope;
  botId?: string;
  api: (path: string, init: { method: string; body?: string; timeoutMs?: number }) => Promise<{ marketplaces?: L[] }>;
  run: (busy: string, work: () => Promise<unknown>) => Promise<boolean>;
  /** the bot scope's listing after the pick */
  botLoaded?: (view: BotPluginsView) => void | Promise<void>;
  /** the workspace's listing after the pick */
  loaded?: (marketplaces: L[]) => void;
}): { scope: PluginScope; onChoose: (name: string, credential: string | null) => Promise<boolean> } {
  const name = (value: string) => encodeURIComponent(value);
  if (deps.route === "me" || (deps.route === "bot" && deps.botId)) {
    const base = deps.route === "me" ? "/api/me/plugins/marketplaces" : `/api/bots/${encodeURIComponent(deps.botId!)}/plugins/marketplaces`;
    return {
      scope: deps.route,
      onChoose: (market, credential) => deps.run(`refresh:${market}`, async () => {
        await deps.api(`${base}/${name(market)}/credential`, { method: "PUT", body: JSON.stringify({ credential }) });
        const view = await deps.api(`${base}/${name(market)}/update`, { method: "POST", timeoutMs: 180_000 }) as unknown as BotPluginsView;
        await deps.botLoaded?.(view);
      }),
    };
  }
  return {
    scope: "workspace",
    onChoose: (market, credential) => deps.run(`refresh:${market}`, async () => {
      await deps.api(`/api/marketplaces/${name(market)}/credential`, { method: "PUT", body: JSON.stringify({ credential }) });
      const result = await deps.api(`/api/marketplaces/${name(market)}/refresh`, { method: "POST", body: "{}", timeoutMs: 180_000 });
      deps.loaded?.(result.marketplaces ?? []);
    }),
  };
}
