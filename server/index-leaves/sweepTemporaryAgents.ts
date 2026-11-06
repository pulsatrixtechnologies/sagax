// @ts-nocheck
/** sweepTemporaryAgents (#1388). Pure move from server/index.ts. */
import { temporaryExpired, temporaryPurgeDue } from "../temporary-agents.ts";
export type Host = Record<string, any>;

export function createSweepTemporaryAgents(getHost: () => Host): any {
async function sweepTemporaryAgents(now = Date.now()) {
  const host = getHost();
  const { archiveMark } = host;

  // A copy: a purge removes bots from the list while it is walked.
  for (const bot of host.store.bots.slice()) {
    const temporary = bot.temporary;
    if (!temporary) continue;
    if (temporaryPurgeDue(temporary, now)) {
      const result = await host.deleteBotWithLifecycle(bot.id).catch((error) => {
        console.warn(`[temporary-agents] could not delete ${bot.id}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      if (result?.status === 200) host.temporaryAudit("agents.temporary.purged", bot, { archivedAt: temporary.archived?.at ?? null });
      continue;
    }
    if (bot.busy || host.store.tasks(bot.id).some((task) => host.threadBusy(bot.id, task.threadId))) continue;
    if (temporaryExpired(temporary, host.botLastActivity(bot), now)) {
      const archived = archiveMark({ kind: "system" }, "expired", now);
      host.store.setBotTemporary(bot.id, { ...temporary, archived });
      host.temporaryAudit("agents.temporary.expired", bot, { idleHours: temporary.idleHours, purgeAt: archived.purgeAt });
    }
  }

}
  return sweepTemporaryAgents;
}
