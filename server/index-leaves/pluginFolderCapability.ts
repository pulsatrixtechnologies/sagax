// @ts-nocheck
/** pluginFolderCapability (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPluginFolderCapability(getHost: () => Host): any {
function pluginFolderCapability(bot: { id: string }, person: string, folder: { name: string; dir: string; scope: PluginScope }): { key: string; name: string } | undefined {
  const host = getHost();

  if (folder.scope === "organization" && host.orgFlowPlugins.dirsFor(person, []).includes(folder.dir)) return { key: "flow:organization:pulsatrix-flow", name: "Pulsatrix Flow" };
  if (folder.scope === "organization") {
    const declared = host.orgCapabilityMounts(person).find((mount) => mount.dir === folder.dir);
    if (declared) return { key: `${declared.view.form}:organization:${declared.view.mount}`, name: declared.view.name };
  }
  if (folder.scope === "organization") {
    const install = host.pluginMarketplaces.installed().find((entry) => host.installationPlugins.folder(entry.key)?.dir === folder.dir);
    return install ? { key: `plugin:installation:${install.key}`, name: folder.name } : undefined;
  }
  const store = folder.scope === "person" ? host.personalPlugins : host.botPlugins;
  const owner = folder.scope === "person" ? person : bot.id;
  const install = store.listPlugins(owner).find((entry) => store.installedFolder(owner, entry).dir === folder.dir);
  return install ? { key: `plugin:${folder.scope === "person" ? "me" : "bot"}:${install.key}`, name: folder.name } : undefined;

}
  return pluginFolderCapability;
}
