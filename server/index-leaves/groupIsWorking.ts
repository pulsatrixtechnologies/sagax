// @ts-nocheck
/** groupIsWorking (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createGroupIsWorking(getHost: () => Host): any {
function groupIsWorking(group: GroupRecord) {
  const host = getHost();

  if (group.busyBotId) return true;
  const ops = host.groupTurnOperations.get(group.id);
  if (!ops?.size) return false;
  // A goal lead waiting on its runtime worker is not working the room.
  for (const op of ops) {
    if (!op.cancelled && !op.awaitingRuntimeWorker) return true;
  }
  return false;

}
  return groupIsWorking;
}
