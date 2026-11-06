// @ts-nocheck
/** privateRecallFilter (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrivateRecallFilter(getHost: () => Host): any {
function privateRecallFilter(bot: BotRecord, threadId: string): ((candidate: string) => boolean) | null{
  const host = getHost();
  const { privateThreadOwner } = host;

  // A confidential thread (server/threads/confidential-threads.ts) feeds no other
  // thread, on any server and for anyone, its owner included: only itself.
  const notConfidential = (candidate: string) => candidate === threadId || !host.store.isConfidentialThread(candidate);
  if (!host.privateThreads()) return (bot.tasks ?? []).some((task) => task.confidential === true) ? notConfidential : null;
  const room = host.store.groupByThread(threadId);
  if (room) return (candidate) => host.store.groupByThread(candidate)?.id === room.id;
  const botOwner = host.effectiveBotOwner(bot);
  const person = privateThreadOwner(host.store.taskByThread(bot.id, threadId), botOwner);
  const operator = person === host.localPrincipalId().trim().toLowerCase();
  return (candidate) => {
    if (!notConfidential(candidate)) return false;
    const group = host.store.groupByThread(candidate);
    if (group) return operator || host.groupVisible(group, person);
    if (host.store.botByThread(candidate)?.id !== bot.id) return false;
    return privateThreadOwner(host.store.taskByThread(bot.id, candidate), botOwner) === person;
  };

}
  return privateRecallFilter;
}
