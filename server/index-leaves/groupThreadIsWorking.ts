// @ts-nocheck
/** groupThreadIsWorking (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createGroupThreadIsWorking(getHost: () => Host): any {
function groupThreadIsWorking(groupId: string, threadId: string) {
  const host = getHost();

  if (host.groupSpeakers.has(threadId)) return true;
  const activeOps = host.groupTurnOperations.get(groupId);
  if (activeOps) {
    for (const op of activeOps) {
      // A goal lead waiting on its runtime worker is not itself working the
      // room: the worker's own short-lived operation (host.run) owns that.
      if (!op.cancelled && op.threadId === threadId && !op.awaitingRuntimeWorker) return true;
    }
  }
  return false;

}
  return groupThreadIsWorking;
}
