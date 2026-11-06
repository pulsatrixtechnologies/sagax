// @ts-nocheck
/** cancelGroupTurnOperations (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCancelGroupTurnOperations(getHost: () => Host): any {
function cancelGroupTurnOperations(
  groupId: string,
  threadId: string,
  outcome: { status: "stopped" | "limit-reached"; detail: string; byHarness?: boolean } = {
    status: "stopped",
    detail: "Stopped by you."
  },
) {
  const host = getHost();
  if (outcome.byHarness) host.coordinator.cancelRoom(groupId, threadId, outcome.detail, "failed");
  else {
    // The person's Stop, as in a bot's thread (contract §2, decision 4): the
    // cards the room's nodes parked on offer no action any more (a card
    // completed afterwards saves its facts and starts nothing), nothing
    // resumes into the stopped thread, work that never started is dropped,
    // and a teammate already mid-turn elsewhere keeps its process and still
    // reports, said once here. The room's remaining rows are then cancelled.
    host.stopParkedCards(threadId);
    host.noteTeammatesLeftRunning(threadId, host.coordinator.stopAwaitingDirect(threadId));
    host.coordinator.cancelRoom(groupId, threadId);
  }
  host.roomMemberLock.releaseThread(threadId);
  for (const operation of host.groupTurnOperations.get(groupId) ?? []) {
    if (operation.threadId !== threadId) continue;
    operation.cancelled = true;
    operation.cancellation.abort();
    host.finishGroupGoalRun(groupId, operation, outcome.status, outcome.detail);
    if (operation.providerHandshakePending) {
      host.markCancelledProviderHandshake(operation.threadId, `group:${operation.id}`);
    }
  }
}
  return cancelGroupTurnOperations;
}
