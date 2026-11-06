/** What a room member's turn says to the room.
 *
 * A member that works through tools narrates as it goes ("I'll check my work
 * history…", "Good, correct layer id…", "Let me inspect"). Those are working
 * notes, not its answer: the room's reply is the turn's final assistant
 * message, the one the store marks `turnTerminal` when the turn settles.
 * Earlier assistant messages of a settled turn stay in the transcript, folded
 * under the reply, but teammates never read them as the member's answer and
 * a chained @mention in them summons nobody.
 *
 * Follows Hermes Agent's desktop group chat (MIT): the newest assistant
 * message is the reply, and an empty or "(pass)" reply is no reply. Pure. */
import type { WireMessage as Message } from "../shared/wire.ts";

/** "(pass)" (loosely: pass / (pass) / pass.) or nothing at all. */
export function isPassText(text: string | undefined): boolean {
  const trimmed = (text ?? "").trim();
  return !trimmed || /^\(?\s*pass\s*\)?\.?$/i.test(trimmed);
}

/** The room reply of one turn from its assistant messages, in order: the
 * last one, or "" when the turn ended with nothing to say. */
export function roomTurnReply(texts: readonly string[]): string {
  const last = texts.at(-1)?.trim() ?? "";
  return isPassText(last) ? "" : last;
}

/** The working notes of settled room turns: bot text messages of a turn
 * that also has a terminal (final) message, other than that final message.
 * A turn still running has no terminal yet and keeps every line. */
export function roomTurnNarrationIds(messages: readonly Message[]): Set<string> {
  const settled = new Set<string>();
  for (const message of messages) {
    if (message.role === "bot" && message.kind === "text" && message.turnId && message.turnTerminal) settled.add(message.turnId);
  }
  const narration = new Set<string>();
  for (const message of messages) {
    if (
      message.role === "bot" &&
      message.kind === "text" &&
      message.turnId &&
      !message.turnTerminal &&
      // a voice note or an image is never folded away as a working note
      !message.attachments?.length &&
      settled.has(message.turnId)
    ) narration.add(message.id);
  }
  return narration;
}

/** Asked once when an addressed member's turn settled without a final
 * message, so the room gets its result rather than silence. */
export const ROOM_SUMMARY_REASK =
  "Your last turn in this room ended without a final message to the room. Reply now with one short message (1–3 lines): your result, or that you could not finish and why. Do not start new work.";

export function finishedWithoutSummaryLine(name: string, reasking: boolean): string {
  return reasking
    ? `${name} finished without a summary — asking for a short result`
    : `${name} finished without a summary`;
}
