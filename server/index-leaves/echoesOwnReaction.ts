// @ts-nocheck
/** echoesOwnReaction (#1388). Pure move from server/index.ts. */
import { botReactionActorId, normalizeReactions, reactionsBy } from "../../shared/reactions.ts";
export type Host = Record<string, any>;

export function createEchoesOwnReaction(getHost: () => Host): any {
function echoesOwnReaction(threadId: string, botId: string, text: string) {
  const host = getHost();

  const reply = text.trim();
  if (!reply || reply.length > 80) return false;
  const placed = host.placedBotReactions.get(`${threadId}:${botId}`);
  if (!placed || placed.at < (host.turnStartedAt.get(threadId) ?? Number.POSITIVE_INFINITY)) return false;
  const soloBot = host.store.groupByThread(threadId) ? null : host.store.botByThread(threadId)?.id ?? null;
  // the message the bot is answering: the newest chat line it did not write
  const answered = host.store.activePath(threadId).findLast((message) => message.kind === "text" && (message.role === "user" ? null : message.from?.botId ?? soloBot) !== botId);
  if (!answered || answered.id !== placed.messageId) return false;
  const mine = reactionsBy(normalizeReactions(answered.reactions, host.legacyReactionUser()), botReactionActorId(botId));
  if (!mine.includes(placed.emoji)) return false;
  if (/^[*_]*\([^()]{0,70}\)[*_]*$/u.test(reply) && host.NOTHING_TO_ADD.test(reply)) return true;
  const bare = (value: string) => value.replace(/\uFE0F/g, "");
  const said = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(reply)]
    .map((part) => part.segment).filter((part) => part.trim());
  return said.length > 0 && said.every((part) => bare(part) === bare(placed.emoji));

}
  return echoesOwnReaction;
}
