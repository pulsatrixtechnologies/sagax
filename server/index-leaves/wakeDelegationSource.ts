// @ts-nocheck
/** wakeDelegationSource (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWakeDelegationSource(getHost: () => Host): any {
function wakeDelegationSource(source: BotRecord, threadId: string, targetName: string, failureReason?: string, routineRunId?: string, speaker?: TurnSpeaker) {
  const host = getHost();

  if (!host.store.taskByThread(source.id, threadId)) return;
  if (!host.routineDelegationCanResume(threadId, routineRunId)) return;
  // Busy? Hold the wake until the source settles, then drain it — the
  // delegated reply is already in the thread, so nothing is lost, and the
  // source processes it the moment it is free rather than only on a later
  // user nudge.
  if (host.threadBusy(source.id, threadId) || host.botAtThreadCapacity(source.id) || host.activeGroupTurnForBot(source.id)) {
    host.pendingDelegationWakes.set(threadId, { botId: source.id, targetName, failureReason, routineRunId, ...(speaker ? { speaker } : {}) });
    return;
  }
  host.dispatchDelegationWake(source.id, threadId, targetName, failureReason, routineRunId, false, speaker);

}
  return wakeDelegationSource;
}
