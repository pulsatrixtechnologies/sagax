// @ts-nocheck
/** delegatorOf (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDelegatorOf(getHost: () => Host): any {
function delegatorOf(threadId: string) {
  const host = getHost();

  const watch = host.delegationWatch.get(threadId);
  if (watch?.sourceThreadId) {
    const botId = watch.sourceBotId ?? host.store.botByThread(watch.sourceThreadId)?.id;
    if (botId) return { threadId: watch.sourceThreadId, botId };
  }
  const parent = host.coordinator.assignerOf(threadId);
  return parent ? { threadId: parent.threadId, botId: parent.botId, groupId: parent.groupId } : undefined;

}
  return delegatorOf;
}
