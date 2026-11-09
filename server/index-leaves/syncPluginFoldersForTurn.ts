// @ts-nocheck
/** syncPluginFoldersForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSyncPluginFoldersForTurn(getHost: () => Host): any {
async function syncPluginFoldersForTurn(principalId: string, botId: string, limit: <T>(task: () => Promise<T>) => Promise<T> = (task) => task()) {
  const host = getHost();
  const { skillsLibraryEnabled } = host;

  const bot = host.store.bot(botId);
  if (!bot || !host.userSandbox) return;
  // A private bot install stays with its owner. Organization and personal
  // installs are selected for the person whose environment receives them.
  const plugins = host.scopedPluginFolders(bot, principalId).filter((plugin) => plugin.scope !== "bot" || host.samePerson(host.effectiveBotOwner(bot), principalId));
  const skills = skillsLibraryEnabled(host.cfg) && host.personalSkills.enabled(principalId).length ? [{ name: "me", dir: host.personalSkills.root(principalId) }] : [];
  if (!plugins.length && !skills.length) return;
  const target = { exec: (input) => limit(() => host.userSandbox!.exec(principalId, input, botId)) };
  try {
    if (skills.length) await host.syncPluginsToSandbox(skills, target, "/workspace/sagax-capability-skills");
    const result = await host.syncPluginsToSandbox(plugins, target);
    if (result.skipped.length) console.warn(`[plugins] not copied to the server environment: ${result.skipped.map((row) => `${row.name} (${row.reason})`).join(", ")}`);
  } catch (error) {
    console.warn(`[plugins] server environment not updated: ${error instanceof Error ? error.message : String(error)}`);
  }

}
  return syncPluginFoldersForTurn;
}
