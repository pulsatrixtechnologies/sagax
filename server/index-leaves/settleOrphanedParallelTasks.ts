// @ts-nocheck
/** settleOrphanedParallelTasks (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleOrphanedParallelTasks(getHost: () => Host): any {
function settleOrphanedParallelTasks() {
  const host = getHost();
  const { hasQueuedSteeredMessages, parallelPending } = host;

  for (const bot of host.store.bots) {
    for (const task of host.store.tasks(bot.id)) {
      if (!parallelPending(task) || host.threadBusy(bot.id, task.threadId) || hasQueuedSteeredMessages(bot.id, task.threadId)) continue;
      host.settleParallelTask(task.threadId, { ok: false, reply: "", why: "the server restarted while it ran" });
    }
  }

}
  return settleOrphanedParallelTasks;
}
