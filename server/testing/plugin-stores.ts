// The bots' plugins on the installation's one marketplace list, wired the way
// server/index.ts wires them, for tests.
import { BotPlugins, type BotPluginsOptions } from "../bot-plugins.ts";
import { PluginMarketplaces } from "../plugins/plugin-marketplaces.ts";

export function botPluginsWithMarketplaces(options: Omit<BotPluginsOptions, "marketplaces"> & { fetchText?: (url: string) => Promise<string> }): BotPlugins {
  const marketplaces = new PluginMarketplaces({
    dataDir: options.dataDir,
    ...(options.git ? { git: options.git } : {}),
    ...(options.fetchText ? { fetchText: options.fetchText } : {}),
    gitEnvironment: options.gitEnvironment,
    policy: options.policy,
    inUse: (name) => plugins.botsUsing(name),
  });
  const plugins: BotPlugins = new BotPlugins({ ...options, marketplaces });
  return plugins;
}
