// @ts-nocheck
/** openedThreadOwner (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOpenedThreadOwner(getHost: () => Host): any {
function openedThreadOwner(from: BotRecord, fromThreadId: string, target: BotRecord) {
  const host = getHost();
  const { canOnBot, isPrincipalId, privateThreadOwner } = host;

  if (!host.privateThreads()) return undefined;
  const person = host.store.groupByThread(fromThreadId)
    ? host.threadPersonKey(fromThreadId)
    : privateThreadOwner(host.store.taskByThread(from.id, fromThreadId), host.effectiveBotOwner(from));
  if (!person || !isPrincipalId(person)) return undefined;
  const viewer = host.authzViewerFromId(person);
  return viewer && canOnBot(viewer, "bot.use", host.botFacts(target)) ? person : undefined;

}
  return openedThreadOwner;
}
