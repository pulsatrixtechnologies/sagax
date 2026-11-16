// @ts-nocheck
/** syncPluginsForTurn (#1388). Pure move from server/index.ts. */
import { settledWithin } from "../auth/idp-session.ts";
import { pluginCopyFailures } from "../sandbox/sandbox-plugins.ts";

export type Host = Record<string, any>;

/** #4394: how long a turn's start waits for the plugin copy into the
 * person's environment. A copy into an environment still starting waited
 * there for minutes (310 s on a hosted server) and the turn with it; past
 * this the turn starts and the copy goes on beside it. A plugin's own tool
 * server and the turn's commands there still wait for their copy. */
export const PLUGIN_COPY_TURN_WAIT_MS = 1_000;

/** #4394: the turn's start waits for its plugin copy at most
 * PLUGIN_COPY_TURN_WAIT_MS; the copy itself is never cut. */
export function pluginCopyForTurnStart(copy: Promise<unknown>): Promise<void> {
  return settledWithin(copy, PLUGIN_COPY_TURN_WAIT_MS);
}

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

/** One running copy per person and bot (#3083): a turn of a bot whose copy
 * is already running joins it. #4394: a copy cut because the person's
 * environment was still starting waits, beside the turn, for that
 * environment to be up and then copies again, without the failed copy's
 * pause (sandbox-plugins.ts PluginCopyFailures). It does not depend on any
 * other call of the person waiting, and an environment that came up while
 * the copy still ran is seen at once. */
function startCopy(host: Host, principalId: string, botId: string): Promise<void> {
  const inFlightKey = `${principalId}\n${botId}`;
  const running = host.pluginSyncInFlight.get(inFlightKey);
  if (running) return running;
  const copyOnce = () => host.syncPluginFoldersForTurn(principalId, botId, (task) => withPluginSyncSlot(host.pluginSyncSlots, principalId, task));
  const startingCuts = (): number => host.userSandbox?.startingCuts?.(principalId) ?? 0;
  const copying: Promise<void> = Promise.resolve().then(async () => {
    const cutsBefore = startingCuts();
    const left = await copyOnce();
    if (left !== true || startingCuts() === cutsBefore) return;
    if (!(await host.userSandbox?.whenUp?.(principalId, botId))) return;
    (host.pluginCopyFailures ?? pluginCopyFailures).forgetPerson(principalId);
    await copyOnce();
  });
  host.pluginSyncInFlight.set(inFlightKey, copying);
  void copying.catch(() => undefined).finally(() => { if (host.pluginSyncInFlight.get(inFlightKey) === copying) host.pluginSyncInFlight.delete(inFlightKey); }).catch(host.reportBackgroundError);
  return copying;
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
  const copying = startCopy(host, principalId, botId);
  host.pluginSyncedGenerations.set(key, copying);
  if (host.pluginSyncedGenerations.size > 2_000) host.pluginSyncedGenerations.delete(host.pluginSyncedGenerations.keys().next().value!);
  return copying;

}
  return syncPluginsForTurn;
}
