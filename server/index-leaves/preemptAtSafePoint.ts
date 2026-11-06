// @ts-nocheck
/** preemptAtSafePoint (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPreemptAtSafePoint(getHost: () => Host): any {
function preemptAtSafePoint(botId: string, threadId: string) {
  const host = getHost();
  const { hasQueuedSteeredMessages } = host;

  host.safePoints.request(threadId, host.toolsRunning(threadId), () => {
    if (!host.threadBusy(botId, threadId) || !hasQueuedSteeredMessages(botId, threadId)) return;
    console.log(`[safe-point] ${botId}/${threadId} interrupted to read a waiting message`);
    host.markThreadStopping(threadId);
    void host.interruptDirectThread(botId, threadId, { cause: "safe-point" }).then(() => host.closeCutToolRows(threadId)).catch(host.reportBackgroundError);
  });

}
  return preemptAtSafePoint;
}
