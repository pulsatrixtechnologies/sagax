// @ts-nocheck
/** scopedPluginFolders (#1388). Pure move from server/index.ts. */
import { selectPluginScopes } from "../capabilities/capability-plugin-mounts.ts";
import { basename } from "node:path";
export type Host = Record<string, any>;

export function createScopedPluginFolders(getHost: () => Host): any {
function scopedPluginFolders(bot: { id: string; ownerUserId?: unknown }, principal = getHost().effectiveBotOwner(bot)): Array<{ name: string; dir: string; scope: PluginScope }> {
  const host = getHost();
  const person = host.IDENTITY.kind === "perspicax" ? principal.trim().toLowerCase() : host.localPrincipalId();
  const aliases = host.flowAliasFolders(bot, person);
  return selectPluginScopes({
    organization: [
      ...host.orgFlowPlugins.dirsFor(person, []).map((dir) => ({ name: basename(dir), dir })),
      // lot 4: the organization's declared plugins and skills on for this person
      ...host.orgCapabilityMounts(person).flatMap((mount) => mount.dir ? [{ name: basename(mount.dir), dir: mount.dir }] : []),
      ...host.installationPlugins.enabledPlugins(),
    ],
    person: person ? host.personalPlugins.enabledPlugins(person).filter((plugin) => !aliases.has(plugin.dir)) : [],
    bot: host.IDENTITY.kind !== "perspicax" || host.samePerson(host.effectiveBotOwner(bot), person) ? host.botPlugins.enabledPlugins(bot.id).filter((plugin) => !aliases.has(plugin.dir)) : []
  }).filter((plugin) => !aliases.has(plugin.dir));
}
  return scopedPluginFolders;
}
