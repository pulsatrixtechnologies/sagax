// @ts-nocheck
/** messageWindow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMessageWindow(getHost: () => Host): any {
function messageWindow(threadId: string, messageId: string, limit: number, viewer: ApprovalViewer) {
  const host = getHost();

  const all = host.store.messagesFor(threadId);
  const index = all.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  const before = Math.floor((limit - 1) / 2);
  const start = Math.max(0, Math.min(index - before, all.length - limit));
  const stop = Math.min(all.length, start + limit);
  return { messages: host.projectMessages(threadId, all.slice(start, stop).map(host.slimMessage), viewer), hasMore: start > 0 };

}
  return messageWindow;
}
