// @ts-nocheck
/** failWorkerTurns (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createFailWorkerTurns(getHost: () => Host): any {
function failWorkerTurns(messageIds: readonly string[], detail = "The turn failed because the worker dropped.") {
  const host = getHost();

  for (const messageId of messageIds) {
    const located = host.locateChannelMessage(messageId);
    const partial = located ? host.partialAlreadyWritten(located.messages, messageId) : "";
    const queued = host.queuedWorkerTurns.map((item) => item.messageId);
    const result = failTurnOnWorkerClose({
      midTurn: true,
      queued,
      messageId,
      partial,
      messages: (located?.messages ?? []).map(host.openTurnMessage)
    });
    host.commitFailedTurn({
      messageId,
      threadId: located?.threadId ?? null,
      result,
      detail
    });
  }

}
  return failWorkerTurns;
}
