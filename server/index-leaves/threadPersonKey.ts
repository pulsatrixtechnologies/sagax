// @ts-nocheck
/** threadPersonKey (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadPersonKey(getHost: () => Host): any {
function threadPersonKey(threadId: string) {
  const host = getHost();

  const thread = host.store.messagesFor(threadId);
  const owner = host.directRequestOwners.get(threadId);
  const request = owner?.messageId
    ? thread.find((message) => message.id === owner.messageId)
    : thread.findLast((message) => message.role === "user");
  return host.linePersonKey(request) ?? host.threadStarters.get(threadId);

}
  return threadPersonKey;
}
