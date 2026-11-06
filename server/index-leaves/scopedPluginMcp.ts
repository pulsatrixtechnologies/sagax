// @ts-nocheck
/** scopedPluginMcp (#1388). Pure move from server/index.ts. */
import { ORG_CAPABILITY_KEY_PREFIX } from "../org/org-capabilities.ts";
export type Host = Record<string, any>;

export function createScopedPluginMcp(getHost: () => Host): any {
function scopedPluginMcp(bot: { id: string; ownerUserId?: unknown }, principal: string) {
  const host = getHost();
  const { installationPlugins, personalPlugins } = host;
  const selected = host.scopedPluginFolders(bot, principal);
  const orgMounts = host.orgCapabilityMounts(principal);
  const candidates = [
    // lot 4: a declared plugin's servers, by its exact installed folder
    ...orgMounts.flatMap((mount) => mount.dir && mount.view.form === "plugin"
      ? Object.entries(mount.mcpServers).map(([name, spec]) => ({ key: `${ORG_CAPABILITY_KEY_PREFIX}${mount.view.id}`, plugin: mount.view.mount, name, spec, dir: mount.dir!, scope: "organization" as const }))
      : []),
    ...installationPlugins.mcpServers().map((server) => ({ ...server, scope: "organization" as const })),
    ...personalPlugins.mcpServers(principal).map((server) => ({ ...server, scope: "person" as const })),
    ...(host.IDENTITY.kind !== "perspicax" || host.samePerson(host.effectiveBotOwner(bot), principal) ? host.botPlugins.mcpServers(bot.id).map((server) => ({ ...server, scope: "bot" as const })) : []),
  ];
  // lot 4: a declared MCP server (stdio or http) has no folder: it is
  // mounted for the person while the declaration is on for them.
  const declared = orgMounts.filter((mount) => mount.view.form === "mcp").flatMap((mount) => Object.entries(mount.mcpServers)
    .map(([name, spec]) => ({ key: `${ORG_CAPABILITY_KEY_PREFIX}${mount.view.id}`, plugin: mount.view.mount, name, spec, dir: "", scope: "organization" as const })));
  return [...declared, ...candidates.flatMap<ScopedPluginMcp>((server) => {
    const folder = selected.find((plugin) => plugin.scope === server.scope && plugin.name === server.plugin);
    if (!folder) return [];
    if (server.scope === "organization") return server.dir === folder.dir ? [{ ...server, dir: folder.dir }] : [];
    // Two marketplaces may use the same plugin name. Only the install
    // whose exact current folder was selected owns its declared servers.
    const source = server.scope === "person" ? host.personalPlugins : host.botPlugins;
    const install = source.listPlugins(server.scope === "person" ? principal : bot.id).find((plugin) => plugin.key === server.key);
    if (!install || source.installedFolder(server.scope === "person" ? principal : bot.id, install).dir !== folder.dir) return [];
    return [{ ...server, dir: folder.dir }];
  })];

}
  return scopedPluginMcp;
}
