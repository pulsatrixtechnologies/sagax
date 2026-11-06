// @ts-nocheck
/** showWaitingOnPersonChip (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createShowWaitingOnPersonChip(getHost: () => Host): any {
function showWaitingOnPersonChip(threadId: string, requestId: string, asker: BotRecord, kind: "approval" | "answer") {
  const host = getHost();

  const delegator = host.delegatorOf(threadId);
  if (!delegator || delegator.threadId === threadId) return;
  // The reviewer may have awaited a verdict: only the current route and
  // teammate record may contribute names or a link to the waiting thread.
  const child = { botId: asker.id, threadId };
  const current = host.store.bot(asker.id);
  if (!current || host.roomHandoffProblem(child, delegator)) return;
  const name = host.teammateNameFor(child, delegator);
  const key = `${threadId}:${requestId}`;
  const tracked = host.waitingOnPersonChips.get(key);
  const messages = host.store.messagesFor(delegator.threadId);
  // Runtime handoffs already have a linked dispatch chip (84841aeed).
  // Evolve that link in place instead of leaving "Sent to" before a second
  // waiting chip. Repeated events for this card update the same message.
  const existing = tracked ? messages.find(message => message.id === tracked.messageId)
    : messages.findLast(message => message.kind === "activity" && message.threadRef?.threadId === threadId
      && message.threadRef.botId === current.id && message.tool?.name.startsWith("Sent to "));
  const update = {
    from: { botId: current.id, name, color: current.color },
    tool: { name: `Waiting on your ${kind} in @${name}` },
    threadRef: { botId: current.id, threadId, title: host.store.taskByThread(current.id, threadId)?.title ?? name }
  };
  const chip = existing ? host.store.patchMessage(delegator.threadId, existing.id, update)
    : host.store.appendMessage(delegator.threadId, { role: "bot", kind: "activity", ...update });
  if (chip) host.waitingOnPersonChips.set(key, { threadId: delegator.threadId, messageId: chip.id, botId: current.id, kind, parent: delegator });

}
  return showWaitingOnPersonChip;
}
