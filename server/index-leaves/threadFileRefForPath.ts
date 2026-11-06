// @ts-nocheck
/** threadFileRefForPath (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadFileRefForPath(getHost: () => Host): any {
function threadFileRefForPath(threadId: string, path: string, messageId?: string) {
  const host = getHost();
  const { activePath, threadFileRefs } = host;

  const directBot = host.store.botByThread(threadId);
  const messages = activePath(host.store.messagesFor(threadId), host.store.activeLeaf(threadId));
  const candidates = messageId
    ? messages.filter((message) => message.id === messageId)
    : [...messages].reverse();
  for (const message of candidates) {
    const found = threadFileRefs([message], directBot?.id).find((candidate) => candidate.path === path);
    if (found) return found;
  }
  return undefined;

}
  return threadFileRefForPath;
}
