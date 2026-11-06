// @ts-nocheck
/** noteTeammatesLeftRunning (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteTeammatesLeftRunning(getHost: () => Host): any {
function noteTeammatesLeftRunning(threadId: string, running: HandoffView[]) {
  const host = getHost();

  if (!host.store.botByThread(threadId) && !host.store.groupByThread(threadId)) return;
  for (const node of running) {
    const name = host.store.bot(node.botId)?.name ?? "A teammate";
    const task = host.store.taskByThread(node.botId, node.threadId);
    host.store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: `Stopped here — ${name} is still working; open to stop it too`, ok: true },
      ...(task ? { threadRef: { botId: node.botId, threadId: node.threadId, title: task.title } } : {})
    });
  }

}
  return noteTeammatesLeftRunning;
}
