// Where the text a bot writes during a live turn is drawn (#3696). The one
// rule the chat, a room, the working line and the turn's row read, so a
// line of the bot never shows as an answer bubble and then hides under the
// turn's row.
//
// A short text (at most LINE_TEXT_MAX characters on one line, no Markdown
// block) is drawn in the working line, in its look, from its first word: a
// note before or between steps reads there until the next step's words
// replace it, and stays in the turn's row. Text that grows past that is an
// answer being written: it opens into the bubble, and the bubble stays for
// the rest of the turn. The rule reads only the text, which only grows, so
// once a text is a bubble it stays one, and the streamed text and the
// settled message always agree.
import type { Message } from "@/state/store";

/** How long a text stays in the working line: one line at the desktop
 * column, two at 390 px. A count, not a measure, so the place is the same
 * at every width and never moves when the window does. */
export const LINE_TEXT_MAX = 100;

/** The working line's phase while it draws the bot's words: one phase, so
 * the words grow in place and a note after a note keeps the same line. */
export const LIVE_NOTE_PHASE = "live-note";

export type LiveTextPlace = "line" | "bubble";

// a Markdown block or a link: the bubble draws it, the line could not
const BLOCK_START = /^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/;
const RICH = /```|\]\(|!\[|<[a-z][^>]*>|https?:\/\//i;

export function liveTextPlace(text: string | undefined): LiveTextPlace {
  const words = (text ?? "").trim();
  if (words.length > LINE_TEXT_MAX || words.includes("\n")) return "bubble";
  return BLOCK_START.test(words) || RICH.test(words) ? "bubble" : "line";
}

/** The words the working line draws: the text without its inline marks. */
export function lineWords(text: string): string {
  return text.trim().replace(/\*\*|__|`/g, "");
}

/** The bot's note the working line draws now: the newest row of the chat is
 * a text of a live turn that is not its final message and fits the line.
 * The list leaves it out of the transcript (groupTranscript), and once a
 * later row of its turn exists it is in the turn's row. */
export function liveLineNote(
  lastMessage: Message | undefined,
  liveTurns: ReadonlySet<string>,
): Message | undefined {
  // a team note is never drawn in the person's chat
  if (!lastMessage || lastMessage.role !== "bot" || lastMessage.kind !== "text" || lastMessage.teamNote) return undefined;
  if (!lastMessage.turnId || lastMessage.turnTerminal || !liveTurns.has(lastMessage.turnId)) return undefined;
  if (!lastMessage.text?.trim() || liveTextPlace(lastMessage.text) !== "line") return undefined;
  return lastMessage;
}
