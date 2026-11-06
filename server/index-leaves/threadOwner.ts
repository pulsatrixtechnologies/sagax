// @ts-nocheck
/** threadOwner (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadOwner(getHost: () => Host): any {
function threadOwner(threadId: string) {
  const host = getHost();

  let owner = host.threadOwners.get(threadId);
  if (owner === undefined) {
    const bot = host.store.botByThread(threadId);
    const group = bot ? undefined : host.store.groupByThread(threadId);
    owner = bot ? { bot: bot.id } : group ? { group: group.id } : null;
    if (host.threadOwners.size >= 20_000) host.threadOwners.clear();
    host.threadOwners.set(threadId, owner);
  }
  return owner ?? undefined;

}
  return threadOwner;
}
