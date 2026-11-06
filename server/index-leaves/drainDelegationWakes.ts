// @ts-nocheck
/** drainDelegationWakes (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDrainDelegationWakes(getHost: () => Host): any {
function drainDelegationWakes() {
  const host = getHost();

  for (const [threadId, entry] of host.pendingDelegationWakes) {
    if (!host.store.taskByThread(entry.botId, threadId) || !host.routineDelegationCanResume(threadId, entry.routineRunId)) {
      host.pendingDelegationWakes.delete(threadId);
      continue;
    }
    // Completion can precede asynchronous digest/resource settlement. Keep
    // the wake parked until a slot is actually free; a rejected async start
    // could otherwise requeue after the last idle-release drain has run.
    if (host.threadBusy(entry.botId, threadId) || host.botAtThreadCapacity(entry.botId) || host.activeGroupTurnForBot(entry.botId)) continue;
    host.pendingDelegationWakes.delete(threadId);
    host.dispatchDelegationWake(entry.botId, threadId, entry.targetName, entry.failureReason, entry.routineRunId, entry.budgetAcquired, entry.speaker);
  }

}
  return drainDelegationWakes;
}
