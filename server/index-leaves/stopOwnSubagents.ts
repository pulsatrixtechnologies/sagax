// @ts-nocheck
/** stopOwnSubagents (#1388). Pure move from server/index.ts. */
import { cancelThreadQueue } from "../turns/steer-queue.ts";
import { openedThreadRefs, ownSubagentThreads } from "../threads/subagent-cleanup.ts";
export type Host = Record<string, any>;

export function createStopOwnSubagents(getHost: () => Host): any {
async function stopOwnSubagents(botId: string, threadId: string) {
  const host = getHost();
  const { hasQueuedSteeredMessages } = host;

  const { parallel, threads } = ownSubagentThreads({
    botId, threadId, tasks: host.store.tasks(botId),
    opened: openedThreadRefs(host.store.messagesFor(threadId), botId),
    active: (child) => host.threadBusy(botId, child) || hasQueuedSteeredMessages(botId, child)
  });
  for (const child of parallel) await host.stopParallelTask(botId, child).catch(() => "not_pending");
  for (const child of threads) {
    cancelThreadQueue(botId, child);
    if (host.threadBusy(botId, child)) {
      await host.stopDirectThread(botId, child).catch(host.reportBackgroundError);
      host.closeCutToolRows(child);
    }
  }
  return parallel.length + threads.length;

}
  return stopOwnSubagents;
}
