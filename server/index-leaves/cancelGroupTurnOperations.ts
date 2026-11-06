// @ts-nocheck
/** cancelGroupTurnOperations (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCancelGroupTurnOperations(getHost: () => Host): any {
function cancelGroupTurnOperations(   groupId: string,   threadId: string,   outcome: { status: "stopped" | "limit-reached"; detail: string; byHarness?: boolean } = {     status: "stopped",     detail: "Stopped by you."   }, ) {
  const host = getHost();

  host.pendingComputerResumes.delete(threadId);
  host.cancelTeamSetupResumesForThread(threadId);
  if (outcome.byHarness) host.coordinator.cancelRoom(groupId, threadId, outcome.detail, "failed");
  else host.coordinator.cancelRoom(groupId, threadId);
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
