// @ts-nocheck
/** finishGroupTurnOperation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createFinishGroupTurnOperation(getHost: () => Host): any {
function finishGroupTurnOperation(groupId: string, operation: GroupTurnOperation) {
  const host = getHost();

  if (operation.goalRun && !operation.goalRun.finished) {
    host.finishGroupGoalRun(groupId, operation, "failed", "The team run ended before the lead reported an outcome.");
  }
  host.clearCancelledProviderHandshake(operation.threadId, `group:${operation.id}`);
  const operations = host.groupTurnOperations.get(groupId);
  operations?.delete(operation);
  if (operations?.size === 0) host.groupTurnOperations.delete(groupId);
  const group = host.store.group(groupId);
  if (group) host.broadcast({ kind: "group", group: host.publicGroupState(group) });
  // The operation can outlive the last member's turn.completed: the fold
  // releases the speaker, but this map entry is what holds a 1:1 message
  // queued behind the room (reason "group-turn"), and no later event fires
  // once the run settles. Drain here, at the true end — the drain's own
  // block check re-reads activeGroupTurnForBot, so a replacement operation
  // begun in the interim still keeps its ground.
  host.drainQueuedSends();
  // A follow-up sent while this operation was running belongs to the
  // harness, not whichever composer happened to be mounted. Hand the next
  // one to the ordinary channel runner as soon as the channel is truly idle.
  host.drainQueuedChannelSends();

}
  return finishGroupTurnOperation;
}
