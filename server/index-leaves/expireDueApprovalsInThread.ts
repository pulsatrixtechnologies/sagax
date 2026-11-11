// @ts-nocheck
/** expireDueApprovalsInThread (#1388). Pure move from server/index.ts. */
import { ExpiryNotes, expirePendingApprovalIfDue } from "../approvals/pending-approval-expiry.ts";
export type Host = Record<string, any>;

export function createExpireDueApprovalsInThread(getHost: () => Host): any {
function expireDueApprovalsInThread(threadId: string) {
  const host = getHost();

  const deps = host.pendingExpiryDeps();
  // #3522: one line for the cards of this conversation that expire now
  const notes = new ExpiryNotes();
  for (const message of host.store.messagesFor(threadId)) {
    if (!message.card?.requestId || message.card.answered || message.card.dismissed || message.card.expired) continue;
    try {
      expirePendingApprovalIfDue(deps, { threadId, message }, notes);
    } catch { /* leave the card; the next sweep retries */ }
  }
  notes.flush(deps.note);

}
  return expireDueApprovalsInThread;
}
