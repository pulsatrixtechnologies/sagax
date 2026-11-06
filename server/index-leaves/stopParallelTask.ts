// @ts-nocheck
/** stopParallelTask (#1388). Pure move from server/index.ts. */
import { cancelThreadQueue } from "../turns/steer-queue.ts";
export type Host = Record<string, any>;

export function createStopParallelTask(getHost: () => Host): any {
async function stopParallelTask(botId: string, threadId: string) {
  const host = getHost();

  const pending = host.pendingParallelTask(threadId);
  if (!pending || pending.bot.id !== botId) return "not_pending";
  host.parallelStops.add(threadId);
  if (host.threadBusy(botId, threadId)) {
    await host.interruptDirectThread(botId, threadId);
    return "stopped";
  }
  cancelThreadQueue(botId, threadId);
  host.settleParallelTask(threadId, { ok: false, reply: "" });
  return "stopped";

}
  return stopParallelTask;
}
