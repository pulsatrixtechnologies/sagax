// @ts-nocheck
/** transcriptPage (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTranscriptPage(getHost: () => Host): any {
function transcriptPage(threadId: string, limit: number | undefined, before?: string | null) {
  const host = getHost();

  if (limit === undefined) {
    return { messages: host.store.messagesFor(threadId), activeLeafId: host.store.activeLeaf(threadId) };
  }
  if (!before) {
    const tail = host.store.messagesTail(threadId, limit);
    return { messages: tail.messages.map(host.slimMessage), hasMore: tail.hasMore, activeLeafId: tail.activeLeafId };
  }
  const all = host.store.messagesFor(threadId);
  const end = all.findIndex((msg) => msg.id === before);
  const stop = end === -1 ? all.length : end;
  const start = Math.max(0, stop - limit);
  return {
    messages: all.slice(start, stop).map(host.slimMessage),
    hasMore: start > 0,
    activeLeafId: host.store.activeLeaf(threadId)
  };

}
  return transcriptPage;
}
