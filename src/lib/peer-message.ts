// A user-role line that another bot wrote.
//
// ask_bot, delegate_bot and start_thread all deliver a peer's words into a
// bot's own conversation as a user-role message: that is the turn the model
// answers, and the server stores it that way. The author rides along on
// Message.peerAsk, and the text opens with a bracketed provenance note for
// the model ("[Message from @Chief, another bot in this Sagax
// workspace — …]"). A renderer keyed on role alone shows that line on the
// person's side of the chat, as if they had said it — which is the bug
// this module exists to prevent. The parse is the client twin of
// server/peers/peer-provenance.ts: the field wins; rows stored before it existed
// still open with the note, so the note is read as the fallback.
// The wire shape, so server code and tests can read peer lines too.
import type { WireMessage as Message } from "../../shared/wire.ts";

export type PeerDelivery = "ask_bot" | "delegate_bot" | "start_thread" | "coordinate_bots" | "ai_client" | "relayed_reply";

export interface PeerLine {
  /** The bot that wrote it; absent on rows older than Message.peerAsk. */
  botId?: string;
  name: string;
  delivery: PeerDelivery;
  /** The words themselves, with the provenance note removed. */
  body: string;
  unattended?: boolean;
}

/** The party an AI client's line names (its chip and its sheet): the
 * renderer shows the localized label for it. */
export const AI_CLIENT_PARTY = "AI client";

// The note is one bracketed line with a fixed opening; the wording after
// the workspace clause varies by delivery and is not needed here.
const PROVENANCE_NOTE =
  /^\[(Message from|Delegated by|Thread opened by) @([^,\]]+), another bot in this Sagax workspace[^\]]*\]\s*/;

const DELIVERY: Record<string, PeerDelivery> = {
  "Message from": "ask_bot",
  "Delegated by": "delegate_bot",
  "Thread opened by": "start_thread",
};

/** Who wrote a user-role line, when it was not the person; null when it was. */
export function peerLine(message: Pick<Message, "role" | "text" | "peerAsk" | "aiClient">): PeerLine | null {
  if (message.role !== "user") return null;
  const text = message.text ?? "";
  // #291: a person's AI client (send_prompt) wrote it, not the person typing
  if (message.aiClient === true && !message.peerAsk) return { name: AI_CLIENT_PARTY, delivery: "ai_client", body: text };
  const note = PROVENANCE_NOTE.exec(text);
  const name = message.peerAsk?.name ?? note?.[2]?.trim();
  if (!name) return null;
  return {
    botId: message.peerAsk?.botId,
    name,
    delivery: (note && DELIVERY[note[1]]) || "ask_bot",
    body: note ? text.slice(note[0].length) : text,
    ...(message.peerAsk?.unattended ? { unattended: true } : {}),
  };
}

/** A coordinate_bots request another bot sent into this bot's own thread.
 * The server stores it bot-role with the sender on Message.from, so without
 * this it reads as the bot talking to itself. Null for anything else,
 * including a bot's own line. */
export function peerRequest(
  message: Pick<Message, "role" | "text" | "from" | "roomRequest">,
  threadBotId: string,
): PeerLine | null {
  if (message.role !== "bot" || message.roomRequest?.phase !== "request") return null;
  const from = message.from;
  if (!from?.name || from.botId === threadBotId) return null;
  return { botId: from.botId, name: from.name, delivery: "coordinate_bots", body: message.text ?? "" };
}

/** #2808: a teammate's coordinate_bots reply the server relayed into this
 * bot's chat as it is (Message.relayedFrom). The unified chat hides the
 * "<teammate> replied" row, so the bubble itself names who wrote it. */
export function peerRelay(
  message: Pick<Message, "role" | "text" | "relayedFrom">,
  threadBotId: string,
): PeerLine | null {
  const from = message.relayedFrom;
  if (message.role !== "bot" || !from?.name || from.botId === threadBotId) return null;
  return { botId: from.botId, name: from.name, delivery: "relayed_reply", body: message.text ?? "" };
}
