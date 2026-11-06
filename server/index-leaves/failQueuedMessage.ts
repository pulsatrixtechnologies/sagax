// @ts-nocheck
/** failQueuedMessage (#1388). Pure move from server/index.ts. */
import { failTurnOnMembershipRemoval, failTurnOnWorkerClose } from "../workers.ts";
export type Host = Record<string, any>;

export function createFailQueuedMessage(getHost: () => Host): any {
function failQueuedMessage(messageId: string, partial: string, detail: string, removed: {   beforeHumanIds: string[];   afterHumanIds: string[];   beforeMemberIds: string[];   afterMemberIds: string[]; } | null) {
  const host = getHost();

  const located = host.locateChannelMessage(messageId);
  const messages = (located?.messages ?? []).map(host.openTurnMessage);
  const queued = host.queuedWorkerTurns.map((item) => item.messageId);
  const result = removed
    ? failTurnOnMembershipRemoval({
      ...removed,
      inTurn: true,
      queued,
      messageId,
      partial,
      messages
    })
    : failTurnOnWorkerClose({ midTurn: true, queued, messageId, partial, messages });
  host.commitFailedTurn({
    messageId,
    threadId: located?.threadId ?? null,
    result,
    detail
  });

}
  return failQueuedMessage;
}
