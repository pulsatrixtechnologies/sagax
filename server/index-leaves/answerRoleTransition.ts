// @ts-nocheck
/** answerRoleTransition (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnswerRoleTransition(getHost: () => Host): any {
function answerRoleTransition(input: { botId: string; threadId: string; messageId: string; choice: "continue" | "stay" | "always"; actor: string }): { status: number; body: Record<string, unknown> } {
  const host = getHost();

  const bot = host.store.bot(input.botId);
  if (!bot) return { status: 404, body: { error: "no such card" } };
  let threadId: string;
  try { threadId = host.routeThreadId(bot, input.threadId); } catch { return { status: 404, body: { error: "no such card" } }; }
  const message = host.store.messagesFor(threadId).find((row) => row.id === input.messageId);
  const card = message?.card;
  const transition = card?.roleTransition;
  if (!message || !card || !transition || transition.botId !== bot.id) return { status: 404, body: { error: "no such card" } };
  if (card.answered) return { status: 409, body: { error: "this card was already answered" } };
  if (input.choice === "always") {
    const owner = host.effectiveBotOwner(bot);
    if (!owner || owner !== input.actor) return { status: 403, body: { error: "Only the bot's owner can save a rule for this bot." } };
    host.roleJournal.addRule(bot.id, { from: transition.from, to: transition.to, path: transition.reason === "fallback" ? transition.path ?? "" : "", ownerId: owner });
  }
  if (input.choice === "stay") {
    host.roleJournal.stay(threadId, transition.from.slug);
    host.perspicaxMcp?.stayInRole(threadId, transition.from.slug);
  }
  const index = input.choice === "continue" ? 0 : input.choice === "stay" ? 1 : 2;
  const picked = card.options[index] ?? input.choice;
  host.store.patchMessage(threadId, message.id, { card: { ...card, answered: picked, answeredText: picked, roleTransition: { ...transition, choice: input.choice } } });
  return { status: 200, body: { ok: true, choice: input.choice } };

}
  return answerRoleTransition;
}
