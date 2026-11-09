// @ts-nocheck
/** syncPluginsForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

/** Commands the plugin copy may run at once in one person's environment. The
 * environment refuses past 4 concurrent commands (sandboxd-core), and the
 * turns' own tools need the rest. */
export const PLUGIN_SYNC_EXEC_SLOTS = 2;

type Slots = { active: number; waiting: Array<() => void> };

/** Runs `task` once one of the person's plugin-copy slots is free. Only the
 * commands queue, never a whole turn's copy (#3083). */
export async function withPluginSyncSlot<T>(slots: Map<string, Slots>, principalId: string, task: () => Promise<T>): Promise<T> {
  let entry = slots.get(principalId);
  if (!entry) { entry = { active: 0, waiting: [] }; slots.set(principalId, entry); }
  if (entry.active >= PLUGIN_SYNC_EXEC_SLOTS) await new Promise<void>((resolve) => entry!.waiting.push(resolve));
  else entry.active += 1;
  try {
    return await task();
  } finally {
    const next = entry.waiting.shift();
    if (next) next();
    else {
      entry.active -= 1;
      if (entry.active === 0 && slots.get(principalId) === entry) slots.delete(principalId);
    }
  }
}

export function createSyncPluginsForTurn(getHost: () => Host): any {
async function syncPluginsForTurn(principalId: string, generation: string, botId: string) {
  const host = getHost();

  if (!host.userSandbox) return;
  const key = `${principalId}\n${generation}\n${botId}`;
  const current = host.pluginSyncedGenerations.get(key);
  if (current) return current;
  // #3083: turns of different bots or conversations of one person copy at
  // the same time. A turn of a bot whose copy is already running joins it;
  // only the copy's commands share a small per-person limit, so a refreshed
  // plugin (every bot's digest changes at once) still stays under the
  // environment's limit on concurrent commands (2026-11-04).
  const inFlightKey = `${principalId}\n${botId}`;
  let copying = host.pluginSyncInFlight.get(inFlightKey);
  if (!copying) {
    copying = Promise.resolve().then(() => host.syncPluginFoldersForTurn(principalId, botId, (task) => withPluginSyncSlot(host.pluginSyncSlots, principalId, task)));
    host.pluginSyncInFlight.set(inFlightKey, copying);
    const started = copying;
    void started.catch(() => undefined).finally(() => { if (host.pluginSyncInFlight.get(inFlightKey) === started) host.pluginSyncInFlight.delete(inFlightKey); }).catch(host.reportBackgroundError);
  }
  host.pluginSyncedGenerations.set(key, copying);
  if (host.pluginSyncedGenerations.size > 2_000) host.pluginSyncedGenerations.delete(host.pluginSyncedGenerations.keys().next().value!);
  return copying;

}
  return syncPluginsForTurn;
}
