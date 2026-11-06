// @ts-nocheck
/** sweepBackgroundThreads (#1388). Pure move from server/index.ts. */
import { planBackgroundSweep, backgroundIdleMs, sweepSummary } from "../threads/background-sweep.ts";
export type Host = Record<string, any>;

export function createSweepBackgroundThreads(getHost: () => Host): any {
function sweepBackgroundThreads(): number {
  const host = getHost();
  try {
    const onScreen = new Set(host.viewerSelections.values());
    const plan = planBackgroundSweep(host.store.bots.map((bot) => ({ id: bot.id, threadId: bot.threadId, tasks: host.store.tasks(bot.id) })), {
      now: Date.now(),
      idleMs: backgroundIdleMs(),
      held: (botId, threadId) => onScreen.has(threadId) || host.threadBusy(botId, threadId) || host.coordinator.activeDirect(threadId)
        || host.coordinator.outstandingDirect(threadId).length > 0 || host.coordinator.awaitsTeammates(threadId)
        || Boolean(host.activeRoutineRunForThread(threadId)) || host.pendingComputerResumes.has(threadId) || host.delegationWatch.has(threadId)
        || host.reservedWorkThreads.has(threadId) || host.continuationHolds.has(threadId),
      personWroteIn: host.personWroteIn,
    });
    const archived = plan.length ? host.store.autoArchiveTasks(plan) : 0;
    if (archived) console.log(`[background-threads] archived ${archived} finished background thread(s): ${sweepSummary(plan)}`);
    return archived;
  } catch (error) {
    console.warn(`[background-threads] sweep skipped: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}
  return sweepBackgroundThreads;
}
