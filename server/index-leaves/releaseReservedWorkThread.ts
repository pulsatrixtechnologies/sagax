// @ts-nocheck
/** releaseReservedWorkThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReleaseReservedWorkThread(getHost: () => Host): any {
function releaseReservedWorkThread(threadId: string) {
  const host = getHost();

  const reserved = host.reservedWorkThreads.get(threadId);
  if (!reserved) return;
  host.reservedWorkThreads.delete(threadId);
  clearTimeout(reserved.timer);
  const task = host.store.taskByThread(reserved.botId, threadId);
  if (!task || task.hidden !== true || !host.reservedThreadUnused(threadId) || host.threadBusy(reserved.botId, threadId)) return;
  host.threadPrewarm.cancel(threadId);
  host.releaseWarmEngine(threadId);
  host.store.deleteTask(reserved.botId, threadId);

}
  return releaseReservedWorkThread;
}
