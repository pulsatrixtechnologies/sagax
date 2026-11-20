// @ts-nocheck
/** scopedPluginFolders (#1388). Pure move from server/index.ts.
 * D-20261119-087 (#5105): the one place a bot's plugin skills meet the
 * products its Perspicax connection serves it (server/plugins/product-skills.ts):
 * every engine reads its plugin skills from this selection. */
import { selectPluginScopes } from "../capabilities/capability-plugin-mounts.ts";
import { botServedProducts, servedSkillsCopiesDir, withServedProductSkills } from "../plugins/product-skills.ts";
import { basename } from "node:path";
export type Host = Record<string, any>;

export function createScopedPluginFolders(getHost: () => Host): any {
function scopedPluginFolders(bot: { id: string; ownerUserId?: unknown }, principal = getHost().effectiveBotOwner(bot)): Array<{ name: string; dir: string; scope: PluginScope; installed?: string }> {
  const host = getHost();
  const person = host.IDENTITY.kind === "perspicax" ? principal.trim().toLowerCase() : host.localPrincipalId();
  const aliases = host.flowAliasFolders(bot, person);
  const selected = selectPluginScopes({
    organization: [
      ...host.orgFlowPlugins.dirsFor(person, []).map((dir) => ({ name: basename(dir), dir })),
      // lot 4: the organization's declared plugins and skills on for this person
      ...host.orgCapabilityMounts(person).flatMap((mount) => mount.dir ? [{ name: basename(mount.dir), dir: mount.dir }] : []),
      ...host.installationPlugins.enabledPlugins(),
    ],
    person: person ? host.personalPlugins.enabledPlugins(person).filter((plugin) => !aliases.has(plugin.dir)) : [],
    bot: host.IDENTITY.kind !== "perspicax" || host.samePerson(host.effectiveBotOwner(bot), person) ? host.botPlugins.enabledPlugins(bot.id).filter((plugin) => !aliases.has(plugin.dir)) : []
  }).filter((plugin) => !aliases.has(plugin.dir));
  // What this bot is served: the api_list Sagax read for it, less the
  // products turned off for it. Unknown (no Perspicax connection, or no
  // read yet): the folders stay as installed.
  const served = host.IDENTITY.kind === "perspicax" ? botServedProducts(host.perspicaxMcp?.servedApis(bot.id), host.store.bot(bot.id) ?? bot) : null;
  return withServedProductSkills(selected, served, servedSkillsCopiesDir(host.DATA_DIR));
}
  return scopedPluginFolders;
}
