// @ts-nocheck
/** scopedPluginFolders (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScopedPluginFolders(getHost: () => Host): any {
function scopedPluginFolders(bot: { id: string; ownerUserId?: unknown }, principal?: string): Array<{ name: string; dir: string; scope: PluginScope }> {
  const host = getHost();
  const { basename, installationPlugins, orgCapabilityMounts, orgFlowPlugins } = host;
  const resolvedPrincipal = principal ?? host.effectiveBotOwner(bot);
  const person = host.IDENTITY.kind === "perspicax" ? resolvedPrincipal.trim().toLowerCase() : host.localPrincipalId();
  const aliases = host.flowAliasFolders(bot, person);
  return selectPluginScopes({
    organization: [
      ...orgFlowPlugins.dirsFor(person, []).map((dir) => ({ name: basename(dir), dir })),
      // lot 4: the organization's declared plugins and skills on for this person
      ...orgCapabilityMounts(person).flatMap((mount) => mount.dir ? [{ name: basename(mount.dir), dir: mount.dir }] : []),
      ...installationPlugins.enabledPlugins(),
    ],
    person: person ? host.personalPlugins.enabledPlugins(person).filter((plugin) => !aliases.has(plugin.dir)) : [],
    bot: host.IDENTITY.kind !== "perspicax" || host.samePerson(host.effectiveBotOwner(bot), person) ? host.botPlugins.enabledPlugins(bot.id).filter((plugin) => !aliases.has(plugin.dir)) : []
  }).filter((plugin) => !aliases.has(plugin.dir));

}
  return scopedPluginFolders;
}
