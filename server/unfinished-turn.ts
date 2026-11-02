// A turn that ends without doing what it said (2026-11-02, "I click a button,
// it says it is doing something and never comes back").
//
// Two shapes end a person's turn silently:
// - "announced": the last thing the bot wrote announces an action ("I'll
//   open it", "Je vais regarder", "Let me check") and no tool call came
//   after it.
// - "after_tools": the bot called tools after its last words (or had no
//   words at all) and the turn ended on those calls, with nothing said.
//
// The reference design always closes a turn with an answer. So does Sagax:
// such a turn is continued once, automatically, with a short internal note
// to do it now or say plainly that it cannot. Bounded: one note per person's
// turn (the continued turn is never continued again), never after a question
// to the person, a card or widget the person must answer, a stop, a failure,
// a routine, a bot-to-bot turn or a loop the loop guard is handling.
// Recorded in the step journal (tool `sagax.unfinished_turn`, class `guard`).
import type { WireMessage as Message } from "../shared/wire.ts";

export type UnfinishedKind = "announced" | "after_tools";

/** Rows that hand the turn to the person: their answer is the next step. */
const ASKS_THE_PERSON = new Set(["options", "widget", "app", "access", "secret", "call"]);

/** Tool rows that are a failure streak the loop guard is counting: at this
 * many failed calls in one turn, the guard is the one to act, not this. */
const LOOP_FAILURES = 3;

// An announcement opens the last sentence: the bot says what it is about to
// do. "Let me know", "I'll be here", "Je reste disponible" and offers ("If
// you want, I'll ...", "Si tu veux, je vais ...") are not announcements.
const ANNOUNCE_EN = /^(?:ok(?:ay)?[,.!]?\s+|sure[,.!]?\s+|got it[,.!]?\s+|alright[,.!]?\s+)?(?:i(?:'|’)ll|i will|i(?:'|’)m going to|i am going to|let me|i(?:'|’)m (?:now )?(?:opening|checking|looking|searching|finding|pulling|running|starting|fetching|creating|updating|loading))\b(?!\s+know\b)(?!\s+(?:be|stay|wait|keep)\b)/i;
const ANNOUNCE_FR = /^(?:ok[,.!]?\s+|d(?:'|’)accord[,.!]?\s+|parfait[,.!]?\s+|bien re[çc]u[,.!]?\s+)?(?:je vais|je m(?:'|’)en occupe|laisse[- ]moi|je (?:lance|regarde|cherche|v[ée]rifie|r[ée]cup[eè]re|pr[ée]pare|cr[ée]e|ouvre|m(?:'|’)occupe)|j(?:'|’)(?:ouvre|y vais|v[ée]rifie)|un instant)\b(?!\s+(?:rester|attendre|patienter)\b)/i;

/** The last sentence of a reply, without markdown decoration. */
function lastSentence(text: string): string {
  const lines = text.trim().split(/\n+/).map((line) => line.replace(/^[\s>*\-#\d.)]+/, "").replace(/[*_`]+/g, "").trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  const parts = last.split(/(?<=[.!?…])\s+(?=\S)/);
  return (parts.at(-1) ?? last).trim();
}

/** Whether a reply ends by announcing an action it has not taken yet. A
 * question to the person is never one. */
export function endsWithAnnouncement(text: string): boolean {
  const sentence = lastSentence(text);
  if (!sentence || /\?\s*["»)]?$/.test(sentence)) return false;
  // "I'll find the draft and open it." and "Opening it now..." both read as
  // an action under way; anything longer than a short line is an answer.
  if (sentence.length > 240) return false;
  return ANNOUNCE_EN.test(sentence) || ANNOUNCE_FR.test(sentence);
}

/** How a finished turn left the person, given the turn's own rows in order
 * (digest excluded). null: it answered, asked, or handed over a card. */
export function unfinishedTurnKind(rows: readonly Pick<Message, "role" | "kind" | "text" | "tool">[]): UnfinishedKind | null {
  const own = rows.filter((row) => row.role === "bot" && row.kind !== "digest");
  if (own.some((row) => ASKS_THE_PERSON.has(row.kind))) return null;
  const failures = own.filter((row) => row.kind === "activity" && row.tool && row.tool.ok === false).length;
  if (failures >= LOOP_FAILURES) return null;
  const lastText = own.findLastIndex((row) => row.kind === "text" && Boolean(row.text?.trim()));
  const toolAfter = own.slice(lastText + 1).some((row) => row.kind === "activity" && Boolean(row.tool?.name));
  if (lastText >= 0) {
    const text = own[lastText]!.text!;
    if (!toolAfter) return endsWithAnnouncement(text) ? "announced" : null;
    // words, then tools, then nothing: a question before the tools still
    // waits on the person's answer
    if (/\?\s*["»)]?$/.test(lastSentence(text))) return null;
    return "after_tools";
  }
  return toolAfter ? "after_tools" : null;
}

/** The internal note the continued turn gets. Never shown as the person's
 * words; it names no tool and grants nothing. */
export function unfinishedTurnPrompt(kind: UnfinishedKind): string {
  const said = kind === "announced"
    ? "Your last message announced an action, but the turn ended before you did it."
    : "You called tools, but the turn ended without a word to the person.";
  return [
    `[Sagax note, not from the person] ${said}`,
    "Do it now if you can, then tell the person the result in one short message.",
    "If you cannot do it (no tool for it, it is on their screen, or it needs them), say so plainly in one short message and tell them what to do instead.",
    "Do not announce it again.",
  ].join(" ");
}

/** One continuation per person's message: the thread remembers the message
 * it continued for, so the continued turn (and any later turn answering the
 * same message) is never continued again. A new message from the person
 * starts over. */
export function createUnfinishedTurnGuard(limit = 5_000) {
  const continuedFor = new Map<string, string>();
  return {
    continued(threadId: string, personMessageId: string): boolean {
      return continuedFor.get(threadId) === personMessageId;
    },
    mark(threadId: string, personMessageId: string): void {
      continuedFor.delete(threadId);
      continuedFor.set(threadId, personMessageId);
      if (continuedFor.size > limit) continuedFor.delete(continuedFor.keys().next().value!);
    },
  };
}

export interface UnfinishedTurnContext {
  ok: boolean;
  stopped: boolean;
  /** routine run, bot-to-bot, webhook: not a person waiting in the chat */
  automated: boolean;
  voiceCall: boolean;
  /** finish-until or a working goal relaunches the turn on its own */
  relaunches: boolean;
  /** this turn was itself the continuation */
  wasContinuation: boolean;
}

/** Whether to continue a settled turn, and as what. */
export function decideUnfinishedTurn(rows: Parameters<typeof unfinishedTurnKind>[0], context: UnfinishedTurnContext): UnfinishedKind | null {
  if (!context.ok || context.stopped || context.automated || context.voiceCall || context.relaunches || context.wasContinuation) return null;
  return unfinishedTurnKind(rows);
}
