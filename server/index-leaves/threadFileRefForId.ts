// @ts-nocheck
/** threadFileRefForId (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadFileRefForId(getHost: () => Host): any {
function threadFileRefForId(threadId: string, id: string) {
  const host = getHost();
  const { activePath, threadFileRefs } = host;

  const listed = host.threadFileRefsFor(threadId).find((candidate) => candidate.id === id);
  if (listed) return listed;
  const directBot = host.store.botByThread(threadId);
  const messages = activePath(host.store.messagesFor(threadId), host.store.activeLeaf(threadId));
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const found = threadFileRefs([messages[index]!], directBot?.id).find((candidate) => candidate.id === id);
    if (found) return found;
  }
  return undefined;

}
  return threadFileRefForId;
}
