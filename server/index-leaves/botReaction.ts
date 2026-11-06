// @ts-nocheck
/** botReaction (#1388). Pure move from server/index.ts. */
import { botReactionActorId, botReactionEmoji, normalizeReactions, reactionEmoji, reactionsBy, BOT_REACTIONS } from "../../shared/reactions.ts";
export type Host = Record<string, any>;

export function createBotReaction(getHost: () => Host): any {
function botReaction(input: { bot: { id: string; name: string }; threadId: string; messageId: string; emoji: unknown; remove: boolean; spent: number }) {
  const host = getHost();

  const messages = host.store.messagesFor(input.threadId);
  const soloBot = host.store.groupByThread(input.threadId) ? null : host.store.botByThread(input.threadId)?.id ?? null;
  const authorBot = (message: Message) => message.role === "user" ? null : message.from?.botId ?? soloBot;
  const target = input.messageId
    ? messages.find((message) => message.id === input.messageId)
    : messages.findLast((message) => message.kind === "text" && authorBot(message) !== input.bot.id && !message.id.startsWith("optimistic-"));
  if (!target) {
    return { ok: false, status: 404, code: "reaction_message", error: input.messageId
      ? "No message with that id in this conversation. Omit message_id to react to the message you are answering."
      : "There is no message here to react to." };
  }
  if (target.kind !== "text") return { ok: false, status: 400, code: "reaction_kind", error: "Only a chat message takes a reaction." };
  if (authorBot(target) === input.bot.id) return { ok: false, status: 400, code: "reaction_own", error: "Never react to your own message." };
  const actor: ReactionActor = { id: botReactionActorId(input.bot.id), kind: "bot", name: input.bot.name };
  const current = normalizeReactions(target.reactions, host.legacyReactionUser());
  const mine = reactionsBy(current, actor.id);
  if (input.remove) {
    const emoji = input.emoji === undefined || input.emoji === "" ? null : reactionEmoji(input.emoji);
    if (input.emoji !== undefined && input.emoji !== "" && !emoji) return { ok: false, status: 400, code: "reaction_emoji", error: "emoji must be one emoji, or omitted to remove yours." };
    const removing = emoji ? mine.filter((held) => held === emoji) : mine;
    for (const held of removing) host.store.reactToMessage(input.threadId, target.id, held, actor, { mode: "remove", legacyUser: host.legacyReactionUser() });
    return { ok: true, messageId: target.id, emoji: emoji ?? removing[0] ?? "", changed: removing.length > 0, removed: removing };
  }
  const emoji = botReactionEmoji(input.emoji);
  if (!emoji) return { ok: false, status: 400, code: "reaction_emoji", error: `emoji must be one of ${BOT_REACTIONS.join(" ")}.` };
  if (mine.includes(emoji)) return { ok: true, messageId: target.id, emoji, changed: false };
  if (mine.length) {
    return { ok: false, status: 409, code: "reaction_one", error: `You already reacted ${mine.join(" ")} to this message: one reaction per message. Use remove_reaction first only if it no longer fits.` };
  }
  if (input.spent >= host.MAX_BOT_REACTIONS_PER_TURN) {
    return { ok: false, status: 429, code: "reaction_budget", error: `You already added ${host.MAX_BOT_REACTIONS_PER_TURN} reactions this turn. Reply in words instead.` };
  }
  const result = host.store.reactToMessage(input.threadId, target.id, emoji, actor, { mode: "add", legacyUser: host.legacyReactionUser() });
  if (!result) return { ok: false, status: 404, code: "reaction_message", error: "That message is gone." };
  if (result.full) return { ok: false, status: 409, code: "reaction_full", error: "This message has too many different reactions." };
  return { ok: true, messageId: target.id, emoji, changed: result.changed };

}
  return botReaction;
}
