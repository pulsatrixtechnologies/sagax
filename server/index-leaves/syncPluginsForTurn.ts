// @ts-nocheck
/** syncPluginsForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSyncPluginsForTurn(getHost: () => Host): any {
async function syncPluginsForTurn(principalId: string, generation: string, botId: string) {
  const host = getHost();

  if (!host.userSandbox) return;
  const key = `${principalId}\n${generation}\n${botId}`;
  const current = host.pluginSyncedGenerations.get(key);
  if (current) return current;
  // one copy at a time per environment: a refreshed plugin changes every
  // bot's digest at once, and parallel copies hit the environment's limit on
  // concurrent commands (2026-11-04, an organization server)
  const previous = host.pluginSyncChains.get(principalId) ?? Promise.resolve();
  const copying = previous.catch(() => undefined).then(() => host.syncPluginFoldersForTurn(principalId, botId));
  host.pluginSyncChains.set(principalId, copying);
  void copying.catch(() => undefined).finally(() => { if (host.pluginSyncChains.get(principalId) === copying) host.pluginSyncChains.delete(principalId); }).catch(host.reportBackgroundError);
  host.pluginSyncedGenerations.set(key, copying);
  if (host.pluginSyncedGenerations.size > 2_000) host.pluginSyncedGenerations.delete(host.pluginSyncedGenerations.keys().next().value!);
  return copying;

}
  return syncPluginsForTurn;
}
