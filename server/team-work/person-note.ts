// What the person wrote to a team bot, told to the bot that handed it the
// work (#3461, lot 1 of #3451; decisions 3a and 4a). Where a person's write
// in a thread is recorded (the callers of Store.setTaskAskedAt), this checks
// that another bot of the same person opened that thread (not an AI client,
// not a confidential thread) and leaves one quiet row in the person's own
// conversation with that bot: kind "text", `teamNote` the structured note,
// `text` the readable fallback. A burst of writes to the same thread folds
// into the same row while the orchestrator's session has not been handed it
// (it is still the conversation's newest row, no turn of the conversation is
// running and no record says the session received it); otherwise the new
// words are a new row, so they still reach the orchestrator. The orchestrator reads it at its next turn, once,
// through its unseen messages (server/context/delta-context.ts); no turn is
// started for it. The team bot's answers stay in the step's chat.
//
// Delivery is this one function: another way to tell the orchestrator
// (waking it at once) would change only `deliver`.
import { TEAM_NOTE_BURST_MS, TEAM_NOTE_CHARS, type TeamNote } from "../../shared/team-work.ts";

export interface PersonNoteThread {
  title: string;
  confidential?: boolean;
  ownerPrincipalId?: string;
  openedBy?: { botId: string; name?: string; kind?: string };
}

export interface PersonNoteRow {
  id: string;
  at: number;
  kind: string;
  teamNote?: TeamNote;
}

export interface PersonNoteDeps {
  thread(botId: string, threadId: string): PersonNoteThread | undefined;
  bot(botId: string): { id: string; name: string; hidden?: boolean } | undefined;
  /** The two bots belong to this person (on a one-person server: always). */
  samePerson(botId: string, otherBotId: string, person: string | undefined): boolean;
  /** The person's one conversation with that bot (conversationThreadFor). */
  conversation(botId: string, person: string | undefined): string | undefined;
  /** The newest rows of a thread, oldest first. */
  messages(threadId: string): PersonNoteRow[];
  append(threadId: string, row: { role: "bot"; kind: "text"; text: string; teamNote: TeamNote }): void;
  patch(threadId: string, messageId: string, patch: { text: string; teamNote: TeamNote }): void;
  redact(text: string): string;
  /** The session of this bot on that conversation may already hold that row:
   * a turn is running there, or a record of what its sessions were handed
   * names it. Such a row is never changed: the new words are a new row. */
  handed(botId: string, threadId: string, messageId: string): boolean;
  /** The conversation gained a row its session was not handed: its next
   * turn is sent it (markTaskContextExternallyUpdated, never unread). */
  externallyUpdated(botId: string, threadId: string): void;
}

export interface PersonWrote {
  /** The team bot written to, and the thread. */
  botId: string;
  threadId: string;
  text: string;
  at: number;
  /** Who wrote, when the server knows the person. */
  person?: string;
}

export type PersonNoteOutcome =
  | { noted: true; threadId: string; messageId?: string; folded: boolean }
  | { noted: false; reason: "no-thread" | "confidential" | "not-opened-by-a-bot" | "agent" | "own" | "no-opener" | "other-person" | "no-conversation" | "empty" };

/** The newest words kept, at most TEAM_NOTE_CHARS. */
export function noteWords(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > TEAM_NOTE_CHARS ? `…${flat.slice(flat.length - TEAM_NOTE_CHARS + 1).trimStart()}` : flat;
}

/** The row's readable fallback, for a client that does not draw the note. */
export function teamNoteText(note: TeamNote): string {
  return `You wrote to ${note.botName}${note.title ? ` (${note.title})` : ""}: ${note.text}`;
}

/** How the orchestrator's next turn reads the row: a note from the app. */
export function teamNoteContext(note: TeamNote): string {
  return `[Note from the app] The person wrote to ${note.botName} directly, in the conversation you opened with it${note.title ? ` ("${note.title}")` : ""}: "${note.text}". `
    + `${note.botName} answers them there. Take it into account in what you coordinate next.`;
}

export function createPersonNote(deps: PersonNoteDeps) {
  function deliver(botId: string, target: string, note: TeamNote): { messageId?: string; folded: boolean } {
    const rows = deps.messages(target);
    const last = rows.findLast((row) => row.teamNote !== undefined);
    // the same write recorded twice (a steer, then its turn) is one write
    if (last?.teamNote && last.teamNote.threadId === note.threadId && last.teamNote.lastAt === note.at) return { messageId: last.id, folded: true };
    // a row the session may hold is never changed: added words would not reach it
    const unhanded = last !== undefined && rows[rows.length - 1]?.id === last.id && !deps.handed(botId, target, last.id);
    if (unhanded && last?.teamNote && last.teamNote.threadId === note.threadId && note.at - last.teamNote.lastAt <= TEAM_NOTE_BURST_MS) {
      const folded: TeamNote = { ...last.teamNote, text: noteWords(`${last.teamNote.text} ${note.text}`), lastAt: note.at, count: last.teamNote.count + 1 };
      deps.patch(target, last.id, { text: teamNoteText(folded), teamNote: folded });
      return { messageId: last.id, folded: true };
    }
    deps.append(target, { role: "bot", kind: "text", text: teamNoteText(note), teamNote: note });
    return { folded: false };
  }

  return function notePersonWrote(input: PersonWrote): PersonNoteOutcome {
    const thread = deps.thread(input.botId, input.threadId);
    if (!thread) return { noted: false, reason: "no-thread" };
    if (thread.confidential) return { noted: false, reason: "confidential" };
    const opener = thread.openedBy;
    if (!opener?.botId) return { noted: false, reason: "not-opened-by-a-bot" };
    if (opener.kind === "agent" || opener.botId.startsWith("agent:")) return { noted: false, reason: "agent" };
    if (opener.botId === input.botId) return { noted: false, reason: "own" };
    const openerBot = deps.bot(opener.botId);
    const bot = deps.bot(input.botId);
    if (!openerBot || openerBot.hidden || !bot) return { noted: false, reason: "no-opener" };
    const person = thread.ownerPrincipalId ?? input.person;
    if (input.person && thread.ownerPrincipalId && input.person.toLowerCase() !== thread.ownerPrincipalId.toLowerCase()) {
      return { noted: false, reason: "other-person" };
    }
    if (!deps.samePerson(opener.botId, input.botId, person)) return { noted: false, reason: "other-person" };
    const target = deps.conversation(opener.botId, person);
    if (!target || target === input.threadId) return { noted: false, reason: "no-conversation" };
    const words = noteWords(deps.redact(input.text));
    if (!words) return { noted: false, reason: "empty" };
    const note: TeamNote = {
      botId: bot.id, botName: bot.name, threadId: input.threadId,
      ...(thread.title.trim() ? { title: thread.title.trim() } : {}),
      text: words, at: input.at, lastAt: input.at, count: 1,
    };
    const delivered = deliver(opener.botId, target, note);
    deps.externallyUpdated(opener.botId, target);
    return { noted: true, threadId: target, ...(delivered.messageId ? { messageId: delivered.messageId } : {}), folded: delivered.folded };
  };
}

// ── the one hook the write paths call ──────────────────────────────────

type NoteSink = (input: PersonWrote) => void;
let sink: NoteSink | null = null;

/** index.ts sets the server's note once its store is up. */
export function setPersonNoteSink(next: NoteSink | null): void {
  sink = next;
}

/** A person's write in a thread was recorded: tell the bot that opened it.
 * Never throws into the write path. */
export function notePersonWrote(input: PersonWrote): void {
  if (!sink) return;
  try {
    sink(input);
  } catch (error) {
    console.warn(`team note: ${error instanceof Error ? error.message : String(error)}`);
  }
}
