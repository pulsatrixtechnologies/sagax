// @ts-nocheck
/** markThreadStopping (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMarkThreadStopping(getHost: () => Host): any {
function markThreadStopping(threadId: string, utteranceId?: string) {
  const host = getHost();

  const previous = host.stoppingThreads.get(threadId);
  if (previous) clearTimeout(previous);
  host.threadStoppedAt.set(threadId, Date.now());
  if (utteranceId) host.threadStoppedUtterance.set(threadId, utteranceId);
  else host.threadStoppedUtterance.delete(threadId);
  // a turn that never reports settling must not hold its words forever
  const timer = setTimeout(() => {
    if (host.stoppingThreads.get(threadId) !== timer) return;
    host.stoppingThreads.delete(threadId);
    host.drainQueuedSends();
  }, 30_000);
  timer.unref?.();
  host.stoppingThreads.set(threadId, timer);

}
  return markThreadStopping;
}
