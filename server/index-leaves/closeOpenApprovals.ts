// @ts-nocheck
/** closeOpenApprovals (#1388). Pure move from server/index.ts. */
import { cancelPeerApprovalsForThread } from "../peers/peer-approval.ts";
import { openTurnRequestCard, stopClosesCard } from "../safe-point-preempt.ts";
export type Host = Record<string, any>;

export function createCloseOpenApprovals(getHost: () => Host): any {
function closeOpenApprovals(threadId: string, options?: { keepPermissions?: boolean }) {
  const host = getHost();

  for (const key of host.pendingCommandRules.keys()) if (key.startsWith(`${threadId}:`)) host.pendingCommandRules.delete(key);
  // Peer approvals also hold an in-memory promise. Resolve those first; merely
  // patching their cards would leave the delegation queue waiting 15 minutes.
  cancelPeerApprovalsForThread(threadId);
  for (const message of host.store.messagesFor(threadId)) {
    const card = message.card;
    if (!openTurnRequestCard(card)) continue;
    // #4528: a safe-point cut (the person's next message) keeps the permission
    // card. Stop, reload and the other callers omit the option and still
    // dismiss it. The in-flight mapping cannot survive the cut; the answer
    // reads the card from the transcript.
    if (!stopClosesCard(card) || (options?.keepPermissions && card?.requestType === "permission")) {
      host.askMessageByRequest.delete(`${threadId}:${card.requestId}`);
      continue;
    }
    host.store.patchMessage(threadId, message.id, { card: { ...card, answered: "unavailable", dismissed: true } });
    host.askMessageByRequest.delete(`${threadId}:${card.requestId}`);
  }

}
  return closeOpenApprovals;
}
