// @ts-nocheck
/** reachMeCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReachMeCard(getHost: () => Host): any {
function reachMeCard(threadId: string, requestId: string) {
  const host = getHost();

  const message = host.store.messagesFor(threadId).find((row) => row.card?.requestId === requestId);
  const card = message?.card;
  if (!message || !card || card.answered || card.dismissed || card.expired || message.kind !== "options") return null;
  const question = host.isPersistentQuestionCard(card) && !host.isApprovalCardMessage(message);
  if (!question && !host.isApprovalCardMessage(message)) return null;
  const bot = host.botForApproval(threadId, message);
  if (!bot) return null;
  const person = host.cardAnswererId(bot, threadId, card);
  return {
    threadId, requestId, botId: bot.id, botName: bot.name,
    kind: question ? "question" : "approval",
    title: String(card.plain?.title ?? card.title ?? "Approval").slice(0, 300),
    line: String(card.plain?.line ?? card.subtitle ?? "").replace(/\s+/g, " ").slice(0, 400),
    confidential: host.store.isConfidentialThread(threadId),
    needsKey: !question && Boolean(host.stepUpGate(person, threadId, requestId, "allow", {}, undefined))
  };

}
  return reachMeCard;
}
