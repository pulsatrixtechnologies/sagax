// @ts-nocheck
/** primaryTurnGate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPrimaryTurnGate(getHost: () => Host): any {
function primaryTurnGate(botId: string, threadId: string, generation: string, purpose: "cards" | "settings" = "cards"): PrimaryTurn & { actor: PerformActor } | { status: number; code: string; error: string } {
  const host = getHost();

  const bot = host.store.bot(botId);
  if (!bot) return { status: 404, code: "no_bot", error: "No such bot." };
  if (bot.temporary) return { status: 403, code: "not_primary", error: "A temporary agent does not answer the person's cards." };
  if (purpose === "settings" && !bot.chiefOfStaff) return { status: 403, code: "not_primary", error: "Only the person's Primary Bot changes their settings from their words. Tell them a card is waiting for them." };
  const facts = host.actTurnFacts(threadId, generation);
  const actor = actorForTurn(facts);
  const person = actor.kind === "person" ? actor.personKey : actor.kind === "operator" ? host.localPrincipalId() : null;
  const owner = host.effectiveBotOwner(bot) || (host.IDENTITY.kind === "perspicax" ? "" : host.localPrincipalId());
  if (!person || !owner || person !== owner) {
    const whose = purpose === "settings"
      ? "Only the person who owns this Primary Bot, in their own message, can have it change their settings."
      : "Only the person who owns this bot, in their own message, can have it answer their cards.";
    return { status: 403, code: "not_owner_turn", error: whose };
  }
  if (host.ownEnvironmentOrigin(bot, threadId) !== "owner") return { status: 403, code: "not_owner_turn", error: "This turn is not the person's own message (a routine, a webhook, another bot or someone else): it answers no card." };
  const request = host.directRequestOwners.get(threadId);
  const message = request?.messageId ? host.store.messagesFor(threadId).find((row) => row.id === request.messageId) : undefined;
  if (!message || message.role !== "user" || message.peerAsk || typeof message.text !== "string") return { status: 403, code: "no_request", error: "No message of the person started this turn." };
  let performActor: PerformActor = { kind: "operator" };
  if (actor.kind === "person") {
    const live = host.sessions.liveWhere((session) => host.personKey(session) === actor.personKey);
    const picked = live.find((session) => session.scopes.includes("admin")) ?? live[0];
    if (!picked) return { status: 403, code: "no_session", error: "The person's session is no longer valid." };
    performActor = { kind: "person", sessionId: picked.id, personKey: actor.personKey, scopes: picked.scopes.filter((scope): scope is "admin" | "client" => scope === "admin" || scope === "client") };
  }
  // #1643 (2026-10-29): the option the person chose on the bot's question
  // card is their decision, as if typed: it counts with their message
  const text = host.personWordsForTurn(host.store.messagesFor(threadId), message.id, message.text, (by) => host.questionAnsweredBy(by, person));
  return { botId: bot.id, botName: bot.name, person, message: { id: message.id, text, at: message.at }, actor: performActor };

}
  return primaryTurnGate;
}
