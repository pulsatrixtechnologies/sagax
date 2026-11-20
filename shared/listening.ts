// Listening to a conversation (#4100): the shapes the server, the desktop and
// the phone share. The person starts it in a bot's chat; the device sends the
// final lines it heard; the server keeps them for that person only, as one
// session record, and says it in one chat row patched in place and in a
// `listening` frame to the person's other devices. No audio is ever kept.
//
// Pure: imports nothing, so the server's hot paths and the page can both use it.

export type ListeningState = "listening" | "ended";

/** Why the person listens: a conversation around them (the chat's
 * listening, #4100), or an in-person meeting (#5130, the watch's meeting
 * mode): at the stop the bot writes the meeting notes the online notetaker
 * writes and keeps them in its memory. */
export type ListeningPurpose = "conversation" | "meeting";

/** Which channels the device hears: the microphone (the person), and on the
 * desktop the computer's sound (the others). */
export interface ListeningSources {
  microphone: boolean;
  computer: boolean;
}

/** A voice of this session: `key` is what the device's lines name, `label`
 * what a person reads ("Speaker 1", or the person's own name). */
export interface ListeningSpeaker {
  key: string;
  label: string;
}

/** One final line. `seq` is the device's own order, the idempotency key of a
 * batch sent again after a reconnect. `speaker` is a speaker key. */
export interface ListeningLine {
  seq: number;
  at: number;
  speaker: string;
  text: string;
}

/** The newest line, as a person reads it: `speaker` is the speaker's label. */
export interface ListeningLast {
  speaker: string;
  text: string;
}

/** What the chat row carries (WireMessage.listening): the session's card.
 * The row's `text` is the plain line for apps that do not know the field. */
export interface ListeningCard {
  sessionId: string;
  state: ListeningState;
  startedAt: number;
  endedAt?: number;
  lineCount: number;
  speakers: ListeningSpeaker[];
  last?: ListeningLast;
}

/** A session as the routes answer it: the card's facts and where it lives. */
export interface ListeningSessionView extends ListeningCard {
  botId: string;
  threadId: string;
  sources: ListeningSources;
  /** absent from servers before #5130: a conversation */
  purpose?: ListeningPurpose;
  /** the highest seq kept: a device that joins the live session numbers its
   * lines after it (empty lines are skipped, so it can be above lineCount) */
  lastSeq: number;
  /** the chat row this session patches */
  messageId?: string;
}

/** The live frame to the same person's other devices. `audience` is that
 * person: no other stream receives it. */
export interface ListeningFrame {
  kind: "listening";
  audience: string;
  botId: string;
  threadId: string;
  sessionId: string;
  state: ListeningState;
  lineCount: number;
  last?: ListeningLast;
}

/** A session that heard neither a line nor a heartbeat (an empty batch of
 * lines) for this long lost its device: the server ends it, with no turn. */
export const LISTENING_IDLE_END_MS = 5 * 60_000;

/** A session id: `ls_` and 20 hex digits. */
export const LISTENING_SESSION_ID = /^ls_[a-f0-9]{20}$/;

/** The row's plain line: "Listening to a conversation" while it is on, then
 * "Listened 24 min, 3 speakers". Apps that do not know `listening` draw it. */
export function listeningRowText(card: Pick<ListeningCard, "state" | "startedAt" | "endedAt" | "speakers">): string {
  if (card.state === "listening") return "Listening to a conversation";
  const minutes = Math.max(1, Math.round(((card.endedAt ?? card.startedAt) - card.startedAt) / 60_000));
  const count = card.speakers.length;
  if (count === 0) return `Listened ${minutes} min`;
  return `Listened ${minutes} min, ${count} ${count === 1 ? "speaker" : "speakers"}`;
}
