// @ts-nocheck
/** settleInputRequests (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleInputRequests(getHost: () => Host): any {
function settleInputRequests(threadId: string, how: "answered" | "expired" | "defaulted" = "answered") {
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
        if (attention && attention.threadId === threadId && !attention.handledAt) host.store.patchMessage(row.threadId, candidate.id, { attention: { ...attention, handledAt: now } });
      }
    }
    const message = path.find((candidate) => candidate.id === row.messageId);
    if (!message?.inputRequest || message.inputRequest.answered || message.inputRequest.expired) continue;
    const settled = how === "answered" ? { answered: true } : { expired: true, ...(how === "defaulted" ? { defaulted: true } : {}) };
    host.store.patchMessage(row.threadId, row.messageId, { inputRequest: { ...message.inputRequest, ...settled } });
  }

}
  return settleInputRequests;
}
