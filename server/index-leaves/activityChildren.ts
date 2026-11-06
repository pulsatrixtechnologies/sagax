// @ts-nocheck
/** activityChildren (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createActivityChildren(getHost: () => Host): any {
function activityChildren(botId: string, threadId: string) {
  const host = getHost();
  const { hasQueuedSteeredMessages } = host;

  const out: ActivityChildRef[] = [];
  const seen = new Set<string>();
  for (const node of host.coordinator.directChildrenOf(botId, threadId)) {
    seen.add(node.threadId);
    out.push({
      botId: node.botId,
      threadId: node.threadId,
      title: host.store.taskByThread(node.botId, node.threadId)?.title || node.text.slice(0, 120),
      // "waiting" is the person's turn only when the teammate is parked on
      // their answer; a teammate waiting on its own teammates still works.
      status: node.status === "source" || node.status === "resume" ? "running"
        : node.status === "waiting" && !host.coordinator.awaitingAnswer(node.threadId) ? "running" : node.status,
      startedAt: node.startedAt ?? node.createdAt
    });
  }
  // its parallel tasks (shared/parallel-tasks.ts)
  for (const task of host.store.tasks(botId)) {
    if (task.parallelOf?.threadId !== threadId || seen.has(task.threadId)) continue;
    seen.add(task.threadId);
    const outcome = task.parallelOf.outcome;
    out.push({
      botId,
      threadId: task.threadId,
      title: task.title,
      status: host.threadBusy(botId, task.threadId)
        ? task.activity === "waiting-on-you" ? "waiting" : "running"
        : outcome === "done" ? "completed" : outcome === "failed" ? "failed" : outcome === "stopped" ? "cancelled"
        : hasQueuedSteeredMessages(botId, task.threadId) ? "queued" : "running",
      startedAt: task.parallelOf.at,
      parallel: true
    });
  }
  for (const watch of host.delegationWatch.values()) {
    if (watch.sourceBotId !== botId || watch.sourceThreadId !== threadId || !watch.taskId || seen.has(watch.taskId)) continue;
    out.push({
      botId: watch.toBotId,
      threadId: watch.taskId,
      title: host.store.taskByThread(watch.toBotId, watch.taskId)?.title || watch.toBotName || "",
      status: "running",
      startedAt: watch.startedAtMs ?? Date.now()
    });
  }
  return out;

}
  return activityChildren;
}
