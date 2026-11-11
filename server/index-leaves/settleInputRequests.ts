// @ts-nocheck
/** settleInputRequests (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleInputRequests(getHost: () => Host): any {
function settleInputRequests(threadId: string, how: "answered" | "handled" | "expired" | "defaulted" | "skipped" = "answered") {
  const host = getHost();

  const rows = host.openInputRequests.get(threadId);
  if (!rows) return;
  host.openInputRequests.delete(threadId);
  const now = Date.now();
  const swept = new Set<string>();
  for (const row of rows) {
    const path = host.store.activePath(row.threadId);
    // #3438: the hand-off's card that asks the same thing in that
    // conversation settles with it, so the chat, the pinned card over the
    // composer and Today never keep asking a question already answered.
    if (!swept.has(row.threadId)) {
      swept.add(row.threadId);
      for (const candidate of path) {
        const attention = candidate.attention;
        // #3471: one closed without the person says how
        if (attention && attention.threadId === threadId && !attention.handledAt) host.store.patchMessage(row.threadId, candidate.id, { attention: { ...attention, handledAt: now, ...(how === "skipped" || how === "expired" ? { closed: how } : {}) } });
      }
    }
    const message = path.find((candidate) => candidate.id === row.messageId);
    if (!message?.inputRequest || message.inputRequest.answered || message.inputRequest.expired) continue;
    // #3543: one the person marked handled reads settled, as answered
    const settled = how === "answered" || how === "handled" ? { answered: true } : { expired: true, ...(how === "defaulted" ? { defaulted: true } : how === "skipped" ? { skipped: true } : {}) };
    host.store.patchMessage(row.threadId, row.messageId, { inputRequest: { ...message.inputRequest, ...settled } });
  }

}
  return settleInputRequests;
}
