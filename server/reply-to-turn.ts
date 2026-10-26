// The quote chip above a bot's reply (2026-10-21, JC: "pour que je sache à
// quoi tu me réponds quand tu parles dans Sagax"). A plain single-message turn
// needs none: the answer sits right under the one message it follows. But when
// the person explicitly replied to a message, or sent several messages before
// the bot answered, the reply quotes the message it is addressing so the
// person sees which one it is. The client already renders the quote from
// `replyToId` (src/components/ReplyQuote.tsx); this only decides what the bot's
// answer points at.

import type { WireMessage } from "../shared/wire.ts";

/** A line the person typed as part of a turn: their own text, not another
 * bot's relayed line (peerAsk) and not an event row. */
function isPersonTurnLine(message: WireMessage): boolean {
  return message.role === "user" && message.kind === "text" && !message.peerAsk;
}

/**
 * The message a bot's reply should quote, or undefined for none. `triggerId`
 * is the turn's triggering person message (directRequestOwners.messageId);
 * `path` is the transcript up to, and not including, the reply being written.
 *
 * - The message the person explicitly replied to, when the trigger carries a
 *   reply reference that still resolves in the thread.
 * - Else the triggering message itself, when the turn gathered more than one
 *   of the person's messages (a burst answered as one).
 * - Else undefined: a lone message needs no chip.
 */
export function botReplyQuoteId(path: readonly WireMessage[], triggerId: string | undefined): string | undefined {
  if (!triggerId) return undefined;
  const index = path.findIndex((message) => message.id === triggerId);
  if (index === -1) return undefined;
  const trigger = path[index];
  if (!isPersonTurnLine(trigger)) return undefined;
  // The person pointed at a specific message: the reply answers that one.
  if (typeof trigger.replyToId === "string" && trigger.replyToId && path.some((message) => message.id === trigger.replyToId)) {
    return trigger.replyToId;
  }
  // Several of the person's messages before this answer: name the one it is
  // addressing (the turn's trigger). Stop at the previous bot line; event and
  // peer rows between the person's lines do not break the burst.
  let personLines = 0;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    const message = path[cursor];
    if (message.role === "bot") break;
    if (isPersonTurnLine(message)) personLines += 1;
  }
  return personLines >= 2 ? triggerId : undefined;
}
