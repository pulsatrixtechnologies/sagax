// Connect apps installs a marketplace plugin in one of two scopes, from the
// one marketplace list (server/plugin-marketplaces.ts):
//   - "workspace": for everyone, its MCP servers and skills
//     (/api/marketplaces/:name/plugins/:plugin, the workspace's managers);
//   - "bot": for one bot, the whole plugin with its agents and commands
//     (/api/bots/:id/plugins, the bot's owner or a person who manages it).
// The bot scope is offered when a bot is in reach: the one a bot panel sent
// the person here with, else the conversation open behind the panel.
import type { BotPluginsView, InstalledPlugin, PluginContents } from "./my-connections";

export type PluginScope = "workspace" | "bot";

/** The bot the "For this bot" scope is about, if any. */
export function pluginScopeBot<B extends { id: string }>(input: { pluginsBotId: string | null; selectedId: string; bots: readonly B[] }): B | null {
  const wanted = input.pluginsBotId ?? input.selectedId;
  return input.bots.find((bot) => bot.id === wanted) ?? null;
}

/** Opened from a bot (its panel): that bot's scope first. */
export function initialPluginScope(pluginsBotId: string | null, bot: { id: string } | null): PluginScope {
  return pluginsBotId && bot?.id === pluginsBotId ? "bot" : "workspace";
}

/** The panel's marketplace rows for the bot scope: installed means on this
 * bot, and an update is this bot's (Install again updates it in place).
 * No servers nor skills: a bot install links nothing of the workspace's.
 * `hasToken`: this bot keeps a token for the marketplace. */
export function botScopeMarketplaces(view: BotPluginsView): Array<{
  name: string; source: string; description?: string; hasToken?: boolean;
  visibility?: "private" | "org"; mine?: boolean;
  plugins: Array<{
    name: string; description?: string; version?: string; category?: string; installed: boolean; servers: string[]; skills: string[];
    installedVersion?: string; updateAvailable?: boolean;
  }>;
}> {
  return view.marketplaces.map((market) => ({
    name: market.name,
    source: market.source,
    ...(market.description ? { description: market.description } : {}),
    ...(market.hasToken ? { hasToken: true } : {}),
    ...(market.visibility ? { visibility: market.visibility } : {}),
    ...(market.mine ? { mine: true } : {}),
    plugins: market.plugins.map((plugin) => ({
      name: plugin.name,
      ...(plugin.description ? { description: plugin.description } : {}),
      ...(plugin.version ? { version: plugin.version } : {}),
      ...(plugin.category ? { category: plugin.category } : {}),
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
export function marketplaceRoute(input: { workspaceManager: boolean; scope: PluginScope; botView: BotPluginsView | null }): "workspace" | "bot" | null {
  if (input.scope === "bot" && input.botView?.canChange) return "bot";
  if (input.workspaceManager) return "workspace";
  return input.botView?.canChange ? "bot" : null;
}

/** The installation's token per marketplace (Connect apps, "Everyone",
 * an admin only; server/routes/marketplaces.ts): saved, then the
 * marketplace is fetched again with it; or removed. The token goes to the
 * server once and never comes back (`hasToken` only). */
export function workspaceMarketplaceTokens<L>(deps: {
  api: (path: string, init: { method: string; body?: string }) => Promise<{ marketplaces?: L[] }>;
  /** the panel's busy and error handling (`marketAction`) */
  run: (busy: string, work: () => Promise<unknown>) => Promise<boolean>;
  loaded: (marketplaces: L[]) => void;
}): { scope: "workspace"; onSave: (name: string, token: string) => Promise<boolean>; onRemove: (name: string) => Promise<boolean> } {
  const at = (name: string) => `/api/marketplaces/${encodeURIComponent(name)}`;
  return {
    scope: "workspace",
    onSave: (name, token) => deps.run(`refresh:${name}`, async () => {
      await deps.api(`${at(name)}/token`, { method: "PUT", body: JSON.stringify({ token }) });
      const result = await deps.api(`${at(name)}/refresh`, { method: "POST", body: "{}" });
      deps.loaded(result.marketplaces ?? []);
    }),
    onRemove: (name) => deps.run(`token:${name}`, async () => {
      const result = await deps.api(`${at(name)}/token`, { method: "DELETE" });
      deps.loaded(result.marketplaces ?? []);
    }),
  };
}
