// @ts-nocheck
/** closeOpenApprovals (#1388). Pure move from server/index.ts. */
import { cancelPeerApprovalsForThread } from "../peers/peer-approval.ts";
import { openTurnRequestCard, stopClosesCard } from "../safe-point-preempt.ts";
export type Host = Record<string, any>;

export function createCloseOpenApprovals(getHost: () => Host): any {
function closeOpenApprovals(threadId: string) {
  const host = getHost();

  for (const key of host.pendingCommandRules.keys()) if (key.startsWith(`${threadId}:`)) host.pendingCommandRules.delete(key);
  // Peer approvals also hold an in-memory promise. Resolve those first; merely
  // patching their cards would leave the delegation queue waiting 15 minutes.
  cancelPeerApprovalsForThread(threadId);
  for (const message of host.store.messagesFor(threadId)) {
    const card = message.card;
    if (!openTurnRequestCard(card)) continue;
    if (!stopClosesCard(card)) {
      // Keep the durable card; its in-flight adapter mapping cannot survive
      // turn cleanup, and the response route can resume it from the transcript.
      host.askMessageByRequest.delete(`${threadId}:${card.requestId}`);
      continue;
    }
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "unavailable", dismissed: true } });
    host.askMessageByRequest.delete(`${threadId}:${card.requestId}`);
  }

}
  return closeOpenApprovals;
}
