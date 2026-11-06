// @ts-nocheck
/** noteQueuedBehindPerson (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteQueuedBehindPerson(getHost: () => Host): any {
function noteQueuedBehindPerson(node: HandoffView) {
  const host = getHost();

  if (host.queuedBehindPersonNoted.has(node.id)) return;
  const card = host.queuedBehindPerson(node);
  const parent = node.parentId ? host.coordinator.node(node.parentId) : undefined;
  const bot = host.store.bot(node.botId);
  if (!card || !parent || !bot) return;
  for (const id of host.queuedBehindPersonNoted) if (host.coordinator.node(id)?.status !== "queued") host.queuedBehindPersonNoted.delete(id);
  host.queuedBehindPersonNoted.add(node.id);
  host.store.appendMessage(parent.threadId, { role: "bot", kind: "activity",
    from: { botId: bot.id, name: bot.name, color: bot.color },
    // A notice, not a step: nothing settles it, so it must not read as
    // running (a spinner in chat, "running" in the run log) forever.
    tool: { name: card.threadId && card.title !== undefined ? host.queuedBehindPersonText(bot.name, card.kind, card.title)
      : `Queued for @${bot.name}, who's waiting on a person`, ok: true },
    ...(card.threadId && card.title !== undefined ? { threadRef: { botId: bot.id, threadId: card.threadId, title: card.title } } : {})
  });

}
  return noteQueuedBehindPerson;
}
