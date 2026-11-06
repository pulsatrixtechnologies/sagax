// @ts-nocheck
/** adoptReservedWorkThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAdoptReservedWorkThread(getHost: () => Host): any {
function adoptReservedWorkThread(botId: string, threadId: string) {
  const host = getHost();

  const reserved = host.reservedWorkThreads.get(threadId);
  if (reserved) {
    host.reservedWorkThreads.delete(threadId);
    clearTimeout(reserved.timer);
  }
  const task = host.store.taskByThread(botId, threadId);
  if (task?.hidden === true && (reserved || (task.openedBy?.kind === "work" && host.reservedThreadUnused(threadId)))) host.store.setTaskHidden(botId, threadId, false);

}
  return adoptReservedWorkThread;
}
