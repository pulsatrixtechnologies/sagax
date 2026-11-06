// @ts-nocheck
/** queuedBehindPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createQueuedBehindPerson(getHost: () => Host): any {
function queuedBehindPerson(node: HandoffView): { threadId?: string; kind: "approval" | "question" | "review"; title?: string } | undefined {
  const host = getHost();

  if (node.groupId || node.status !== "queued" || host.threadBusy(node.botId, node.threadId) || !host.botAtThreadCapacity(node.botId)) return undefined;
  const parent = node.parentId ? host.coordinator.node(node.parentId) : undefined;
  const from = parent ? host.store.bot(parent.botId) : undefined;
  const bot = host.store.bot(node.botId);
  if (!parent || !from || !bot || host.roomHandoffProblem(node, parent)) return undefined;
  // A private card's title and link belong only to the source thread's
  // actual person, with current read access. A room shares its transcript;
  // it cannot carry someone else's private conversation into that room.
  const sourceTask = !parent.groupId ? host.store.taskByThread(from.id, parent.threadId) : undefined;
  const viewer = sourceTask ? privateThreadOwner(sourceTask, host.effectiveBotOwner(from)) : undefined;
  for (const task of host.store.tasks(node.botId)) {
    if (task.threadId === node.threadId || task.activity !== "waiting-on-you") continue;
    const card = host.openPersonCard(task.threadId);
    if (!card) continue;
    const visible = !host.roomHandoffProblem({ botId: bot.id, threadId: task.threadId }, parent) &&
      (!host.privateThreads() || Boolean(viewer && host.botThreadReadable(bot, task.threadId, viewer, "thread.read")));
    return visible ? { threadId: task.threadId, kind: card.kind, title: task.title } : { kind: card.kind };
  }
  return undefined;

}
  return queuedBehindPerson;
}
