// @ts-nocheck
/** beginGroupTurnOperation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createBeginGroupTurnOperation(getHost: () => Host): any {
function beginGroupTurnOperation(   groupId: string,   threadId: string,   botIds: Iterable<string> = [], ) {
  const host = getHost();
  const { randomUUID } = host;

  const operation = {
    id: randomUUID(),
    threadId,
    botIds: new Set(botIds),
    cancelled: false,
    cancellation: new AbortController(),
    providerHandshakePending: false
  };
  const operations = host.groupTurnOperations.get(groupId) ?? new Set<GroupTurnOperation>();
  operations.add(operation);
  host.groupTurnOperations.set(groupId, operations);
  const group = host.store.group(groupId);
  if (group) host.broadcast({ kind: "group", group: host.publicGroupState(group) });
  return operation;

}
  return beginGroupTurnOperation;
}
