// @ts-nocheck
/** expireDueApprovalsInThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createExpireDueApprovalsInThread(getHost: () => Host): any {
function expireDueApprovalsInThread(threadId: string) {
  const host = getHost();

  const deps = host.pendingExpiryDeps();
  for (const message of host.store.messagesFor(threadId)) {
    if (!message.card?.requestId || message.card.answered || message.card.dismissed || message.card.expired) continue;
    try {
      expirePendingApprovalIfDue(deps, { threadId, message });
    } catch { /* leave the card; the next sweep retries */ }
  }

}
  return expireDueApprovalsInThread;
}
