// @ts-nocheck
/** settleInputRequests (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleInputRequests(getHost: () => Host): any {
function settleInputRequests(threadId: string, how: "answered" | "expired" | "defaulted" = "answered") {
  const host = getHost();

  const rows = host.openInputRequests.get(threadId);
  if (!rows) return;
  host.openInputRequests.delete(threadId);
  for (const row of rows) {
    const message = host.store.activePath(row.threadId).find((candidate) => candidate.id === row.messageId);
    if (!message?.inputRequest || message.inputRequest.answered || message.inputRequest.expired) continue;
    const settled = how === "answered" ? { answered: true } : { expired: true, ...(how === "defaulted" ? { defaulted: true } : {}) };
    host.store.patchMessage(row.threadId, row.messageId, { inputRequest: { ...message.inputRequest, ...settled } });
  }

}
  return settleInputRequests;
}
