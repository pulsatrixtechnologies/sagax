// #5025: a routine run's claimed card is never drawn twice. The
// host drew a card for every run whose last words "announced" one, even
// when the bot said a card was already waiting and that a second would
// duplicate it, and two runs of the same trigger with nearly the same
// words left two cards ("1 of 2"). Before a claimed ask is drawn, the open
// cards of the same bot for the same person are read: one that carries the
// same ask, names the same ticket, or comes from this run or this
// trigger's earlier run with nearly the same words is that ask's card.
import type { Message } from "../store.ts";
import { askTextKey, raiseTextKeyedAsk } from "../widgets/ask-choice-keys.ts";
import {
  ROUTINE_CLAIM_ALREADY_OPEN, routineClaimedCardChoices, routineClaimedCardWaiting, type RoutineClaimedCardContext,
} from "./routines.ts";

type Card = NonNullable<Message["card"]>;
type ClaimedChoice = ReturnType<typeof routineClaimedCardChoices>[number];

/** An open card of the asking bot, for the same person. */
export interface OpenAskCard {
  question: string;
  /** when it was drawn */
  at: number;
  /** in this run's conversation or one of its routine's earlier runs */
  near?: boolean;
}

/** How alike two asks' words must be (shared words over all their words)
 * for an earlier run's card to carry the new one. */
const CLAIMED_ASK_ALIKE = 0.5;

/** A card still waiting on the person: a question or an approval, neither
 * answered, put away nor expired. */
export function openAskCard(message: Message): boolean {
  const card = message.kind === "options" ? message.card : undefined;
  return Boolean(card?.requestId && !card.answered && !card.dismissed && !card.expired);
}

/** The references a question names: a number marked with # ("#123456"), or
 * one of five digits or more ("block 654321"). */
function askReferences(text: string): Set<string> {
  const references = new Set<string>();
  for (const match of text.normalize("NFC").matchAll(/#\s?(\d{3,})(?!\d)|(?<![\d:.,])(\d{5,})(?![\d:.,]\d)/g)) references.add(match[1] ?? match[2]!);
  return references;
}

/** The words that say what an ask is about (four letters or more). */
function askWords(text: string): Set<string> {
  return new Set(text.normalize("NFC").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []);
}

function alike(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** Whether `question` already has its card among `open`: a card drawn
 * since the claim window opened (the card the words speak of), the same
 * ask, the same ticket, or, from this run or this trigger's earlier run,
 * nearly the same words. */
export function claimedAskOpen(question: string, open: readonly OpenAskCard[], since?: number): boolean {
  if (!open.length) return false;
  const key = askTextKey(question);
  const references = askReferences(question);
  const words = askWords(question);
  return open.some((card) => {
    if (since !== undefined && card.at >= since) return true;
    if (askTextKey(card.question) === key) return true;
    const theirs = askReferences(card.question);
    // the same ticket carries a different ask only from this trigger's own
    // runs (the routine asks again once that card is answered); a card of
    // another source on that ticket never swallows a different question
    for (const reference of references) if (theirs.has(reference)) return Boolean(card.near) || alike(words, askWords(card.question)) >= CLAIMED_ASK_ALIKE;
    // two asks that each name their ticket, none shared, are two subjects
    if (references.size && theirs.size) return false;
    return Boolean(card.near) && alike(words, askWords(card.question)) >= CLAIMED_ASK_ALIKE;
  });
}

/** The host's side of raiseClaimedCard (server/index.ts): one card per ask
 * of the claim that has none open yet. A repeating routine's run
 * (`context.noHold`) raises each keyed by its text, so the same ask
 * replaces its pending card in place (#4233). The run's waiting line,
 * ROUTINE_CLAIM_ALREADY_OPEN when every ask already has its card, or null
 * when no card could be drawn. */
export function raiseClaimedAsks(
  threadId: string,
  claim: string,
  context: RoutineClaimedCardContext | undefined,
  deps: {
    /** the bot's open cards for the person (OpenAskCard) */
    open(): readonly OpenAskCard[];
    /** a repeating routine's keyed cards (#4233), else null */
    keys: null | {
      find(key: string): { threadId: string; message: Message } | null;
      remember(key: string, threadId: string, messageId: string): void;
      patch(threadId: string, messageId: string, card: Card): boolean;
    };
    raise(choice: ClaimedChoice & { card?: { askKey: string; noHold: true } }): { messageId: string } | null;
  },
): string | null | typeof ROUTINE_CLAIM_ALREADY_OPEN {
  const choices = routineClaimedCardChoices(claim);
  if (!choices.length) return null;
  const open = deps.open();
  const keys = context?.noHold ? deps.keys : null;
  // a card drawn since the window opened is the one card a single ask
  // speaks of; it never stands for several
  const since = choices.length === 1 ? context?.since : undefined;
  // the same ask of a repeating routine is replaced in place by its key
  const fresh = choices.filter((choice) => (keys && keys.find(askTextKey(choice.question))) || !claimedAskOpen(choice.question, open, since));
  if (!fresh.length) return ROUTINE_CLAIM_ALREADY_OPEN;
  const raised = fresh.filter((choice) => keys
    ? raiseTextKeyedAsk(threadId, choice, { find: keys.find, remember: keys.remember, patch: keys.patch, raise: deps.raise })
    : deps.raise(choice));
  return raised.length ? routineClaimedCardWaiting(raised) : null;
}
