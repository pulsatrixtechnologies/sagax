// @ts-nocheck
/** settleTeamMemoryCards (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleTeamMemoryCards(getHost: () => Host): any {
function settleTeamMemoryCards(auth: RequestAuth, section: string, entryId: string, answer: "allow" | "deny", sourceThreadId?: string) {
  const host = getHost();
  const { DATA_DIR, appendDecision, sectionContextKey } = host;
  const key = sectionContextKey(section);
  const matches = (message: Message, threadId: string) => {
    const request = message.card?.teamMemoryRequest;
    if (!request || request.entryId !== entryId || !message.card?.requestId) return false;
    const cardSection = sectionContextKey(request.section);
    if (cardSection === key) return true;
    // #2045: cards still carry the display name; the page settles by owner/id.
    const proposer = message.from?.botId ? host.store.bot(message.from.botId) : host.store.botByThread(threadId);
    return host.teamStorageKeyFor(cardSection, proposer ? host.effectiveBotOwner(proposer) : undefined) === key;
  };
  const threads = new Set<string>();
  if (sourceThreadId) threads.add(sourceThreadId);
  if (!sourceThreadId || !host.store.messagesFor(sourceThreadId).some((message) => matches(message, sourceThreadId))) {
    for (const bot of host.store.bots) for (const task of host.store.tasks(bot.id)) threads.add(task.threadId);
    for (const group of host.store.groups) {
      threads.add(group.threadId);
      for (const task of host.store.groupTasks(group.id)) threads.add(task.threadId);
    }
  }
  let closed = 0;
  for (const threadId of threads) {
    for (const message of host.store.messagesFor(threadId)) {
      if (!matches(message, threadId) || host.teamMemoryCardSettled(message.card)) continue;
      host.store.patchMessage(threadId, message.id, { card: { ...message.card!, answered: answer, answeredBy: host.cardAnswererFor(auth) } });
      const proposer = message.from?.botId ? host.store.bot(message.from.botId) : host.store.botByThread(threadId);
      appendDecision(DATA_DIR, {
        threadId, requestId: message.card!.requestId!, botId: proposer?.id, botName: proposer?.name,
        tool: "propose_team_memory", summary: message.card!.subtitle,
        decision: answer === "allow" ? "user-approved" : "user-denied", source: "user", actor: host.decisionActorFor(auth)
      });
      closed += 1;
    }
  }
  return closed;

}
  return settleTeamMemoryCards;
}
