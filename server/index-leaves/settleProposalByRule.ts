// @ts-nocheck
/** settleProposalByRule (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleProposalByRule(getHost: () => Host): any {
function settleProposalByRule<T extends { claimed: boolean }>(
  bot: BotRecord,
  threadId: string,
  proposed: { requestId: string; messageId: string },
  resolve: (args: { botId: string; threadId: string; requestId: string; behavior: "allow" }) => T,
):{ rule: OwnerRule; result: T } | undefined {
  const host = getHost();

  const message = host.store.messagesFor(threadId).find((row) => row.id === proposed.messageId);
  const card = message?.card;
  if (!message || !card || card.answered || card.dismissed) return undefined;
  const candidate = host.proposalRuleCandidate(card);
  if (!candidate) return undefined;
  host.store.patchMessage(threadId, message.id, { card: { ...card, ownerRule: { tool: candidate.tool, scope: candidate.scope, description: candidate.description } } });
  const kept = host.keptCardRule(bot, threadId, candidate, candidate.classes);
  if (!kept) return undefined;
  const result = resolve({ botId: bot.id, threadId, requestId: proposed.requestId, behavior: "allow" });
  if (!result.claimed) return undefined;
  const settled = host.store.messagesFor(threadId).find((row) => row.id === message.id);
  if (settled?.card) host.store.patchMessage(threadId, message.id, { card: { ...settled.card, ruleSaved: { id: kept.id, behavior: kept.behavior, description: kept.description } } });
  host.appendDecision(host.DATA_DIR, {
    threadId, requestId: proposed.requestId, botId: bot.id, botName: bot.name, tool: card.tool, summary: card.subtitle,
    decision: "auto-approved", source: "owner-rule", rule: kept.id
  });
  return { rule: kept, result };

}
  return settleProposalByRule;
}
