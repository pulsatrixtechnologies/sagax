// @ts-nocheck
/** newestPeerActivityAt (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNewestPeerActivityAt(getHost: () => Host): any {
function newestPeerActivityAt(botId: string) {
  const host = getHost();

  let newest = 0;
  for (const task of host.store.tasks(botId)) {
    const at = host.store.messagesTail(task.threadId, 1).messages.at(-1)?.at ?? task.createdAt;
    if (at > newest) newest = at;
  }
  return newest;

}
  return newestPeerActivityAt;
}
