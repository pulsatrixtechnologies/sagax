// @ts-nocheck
/** interruptParkedTurn (#1388). Pure move from server/index.ts, restored:
 * the split dropped it. */
export type Host = Record<string, any>;

export function createInterruptParkedTurn(getHost: () => Host): any {
/** End the engine's turn after the computer wait ceiling parked it at a
 * lazy claim (#1651): the turn settles and its root continues in place
 * when the seat frees. Not a Stop: the request stays the person's, nothing
 * the conversation awaits is cancelled, and the root is not. */
async function interruptParkedTurn(botId: string, threadId: string): Promise<void> {
  const host = getHost();
  const owner = host.botForThread(botId, threadId);
  const generation = host.directTurnGenerationByThread.get(threadId);
  host.cancelDirectTurnDispatch(botId, threadId);
  host.revokeInternalCapabilitiesForThread(threadId);
  await (owner ? host.runningTurnInstance(owner, threadId) : null)?.adapter.interruptTurn(threadId);
  if (host.directTurnGenerationByThread.get(threadId) === generation) host.closeOpenApprovals(threadId);
}
  return interruptParkedTurn;
}
