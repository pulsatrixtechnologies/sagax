// #3471: every card that waits on the person can be skipped, and every kind
// expires under the one policy of #1940 (pending-approval-expiry.ts).
//
// Skipping is not a refusal: the card closes as skipped, the waiting bot
// hears one plain line once (the person skipped this, there is no answer),
// its turn or run goes on or ends without the action, and nothing is run.
//
// Two shapes wait on the person:
//  - an option card with a requestId (an approval, a choice or free-text
//    question): its live turn hears the line through the engine (a
//    permission declined with it, a question answered with it);
//  - a question in words a bot's work left (a parked teammate's input
//    request row, a hand-off's or a routine run's attention card): the
//    waiting work hears the line (the coordinator's answer of its thread),
//    or, when nothing is parked any more, reads it in its thread.
import type { Message } from "../store.ts";

export type WaitingLocale = "en" | "fr";

/** The plain line the waiting bot hears when the person skips its card. */
export function waitingCardSkipNote(locale: WaitingLocale = "en"): string {
  if (locale === "fr") {
    return "La personne a passé ceci sans répondre : il n'y a pas de réponse et rien n'a été fait. Continue sans, ou termine ici.";
  }
  return "The person skipped this without answering: there is no answer and nothing was run. Go on without it, or end here.";
}

/** #3543: the plain line the waiting bot or run hears when the person marks
 * its question handled (Today's "Mark as handled"): settled by them, with
 * no answer given here. */
export function waitingCardHandledNote(locale: WaitingLocale = "en"): string {
  if (locale === "fr") {
    return "La personne a marqué ceci comme réglé, sans donner de réponse ici. Considère que c'est pris en charge : continue sans réponse, ou termine ici.";
  }
  return "The person marked this handled without giving an answer here. Treat it as taken care of: go on without an answer, or end here.";
}

/** The card as it reads once skipped: settled for every reader of
 * `answered`, no option left to press, no answer text. */
export function skippedCardPatch(card: NonNullable<Message["card"]>): NonNullable<Message["card"]> {
  const { answeredText: _text, ...rest } = card;
  return { ...rest, answered: "skipped", skipped: true, options: [] };
}

/** An option card still waiting on the person. */
export function waitingCardOpen(card: Message["card"] | undefined): card is NonNullable<Message["card"]> {
  return Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);
}

export interface SkipCardDeps {
  messages(threadId: string): readonly Message[];
  patch(threadId: string, messageId: string, card: NonNullable<Message["card"]>): void;
  /** Tell the live turn the line: a permission is declined with it, a
   * question answered with it (a question refuses a deny). */
  deliver(threadId: string, requestId: string, response: { behavior: "deny" | "answer"; message: string }): unknown;
  /** The in-memory state of the request (maps, waiting activity, notice). */
  release?(threadId: string, requestId: string): void;
  localeFor?(threadId: string): WaitingLocale;
}

export type SkipReply = { status: number; body: Record<string, unknown> };

/** Skip one open option card of `threadId`. The card is closed first, so
 * the engine's own resolution never marks it denied. */
export async function skipWaitingCard(deps: SkipCardDeps, threadId: string, requestId: string): Promise<SkipReply> {
  const message = deps.messages(threadId).find((row) => row.card?.requestId === requestId);
  if (!message?.card) return { status: 404, body: { error: "this card is no longer available" } };
  if (!waitingCardOpen(message.card)) return { status: 409, body: { error: "this card is already closed" } };
  const card = message.card;
  deps.patch(threadId, message.id, skippedCardPatch(card));
  const note = waitingCardSkipNote(deps.localeFor?.(threadId) ?? "en");
  try {
    await deps.deliver(threadId, requestId, { behavior: card.tool ? "deny" : "answer", message: note });
  } catch {
    // the turn may be gone: the card is closed either way and nothing ran
  }
  try {
    deps.release?.(threadId, requestId);
  } catch {
    /* in-memory state only */
  }
  return { status: 200, body: { ok: true, outcome: "skipped" } };
}

/** A question in words still waiting on the person: an input request row
 * (not a reminder) or an attention card not handled. */
export function personRequestOpen(message: Message): boolean {
  const request = message.inputRequest;
  if (request) return !request.reminder && !request.answered && !request.expired;
  return Boolean(message.attention && !message.attention.handledAt);
}

/** The waiting work's thread a person request answers into. */
export function personRequestWorkThread(message: Message): string | undefined {
  return message.inputRequest?.threadId ?? message.attention?.threadId;
}

/** How a question in words closes. `skipped`: no answer, the work hears so.
 * `handled` (#3543): the person marked it handled without an answer, the
 * work hears so. `answered`: the person's own words already went to the
 * work, nothing more is said. `expired`: it waited too long, with its line. */
export type PersonRequestClose = { kind: PersonRequestSettle } | { kind: "expired"; note: string };
/** How the person settles a question in words. */
export type PersonRequestSettle = "skipped" | "handled" | "answered";

export interface PersonRequestDeps {
  patch(threadId: string, messageId: string, patch: Partial<Message>): void;
  /** The waiting work takes the line as its answer (the coordinator's
   * answer of that thread); false when nothing is parked there. */
  answerWork(workThreadId: string, text: string): boolean;
  /** Nothing is parked: the line is kept in the work's thread instead. */
  noteWork(workThreadId: string, text: string): void;
  /** The other rows and cards of the same ask close the same way. */
  settleWork?(workThreadId: string, how: PersonRequestClose["kind"]): void;
  localeFor?(threadId: string): WaitingLocale;
  now?: () => number;
}

/** Close one person request: skipped, handled, answered or expired. The
 * one way a question in words settles (#3543): the waiting work hears the
 * line of how it closed, except once the person's own words reached it.
 * True when it closed. */
export function closePersonRequest(deps: PersonRequestDeps, threadId: string, message: Message, how: PersonRequestClose): boolean {
  if (!personRequestOpen(message)) return false;
  const work = personRequestWorkThread(message);
  const closed = how.kind === "skipped" || how.kind === "expired" ? how.kind : undefined;
  if (message.inputRequest) {
    deps.patch(threadId, message.id, {
      inputRequest: closed
        ? { ...message.inputRequest, expired: true, ...(closed === "skipped" ? { skipped: true } : {}) }
        : { ...message.inputRequest, answered: true },
    });
  }
  if (message.attention) {
    deps.patch(threadId, message.id, { attention: { ...message.attention, handledAt: deps.now?.() ?? Date.now(), ...(closed ? { closed } : {}) } });
  }
  if (!work) return true;
  if (how.kind !== "answered") {
    const locale = deps.localeFor?.(threadId) ?? "en";
    const note = how.kind === "expired" && "note" in how ? how.note : how.kind === "handled" ? waitingCardHandledNote(locale) : waitingCardSkipNote(locale);
    let taken = false;
    try {
      taken = deps.answerWork(work, note);
    } catch {
      taken = false;
    }
    if (!taken) {
      try {
        deps.noteWork(work, note);
      } catch {
        /* the card is closed either way */
      }
    }
  }
  try {
    deps.settleWork?.(work, how.kind);
  } catch {
    /* the card is closed either way */
  }
  return true;
}
