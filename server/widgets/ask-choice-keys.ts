// #4205: ask_choice keys. A bot names a card with its own short key (an item
// id): asking the same key again replaces that pending card in place, a
// retire closes it at once (it leaves the pinned zone and an answer to it
// starts nothing), and the answer reaches the bot with the key verbatim
// (server/messages/replies.ts). A key spans the bot's conversations with the
// same person, so a routine that runs every few minutes, each run in its own
// conversation, keeps one card per item instead of one per run.
import { createHash } from "node:crypto";
import type { Message } from "../store.ts";

type Card = NonNullable<Message["card"]>;

/** #4233: the stable key of an ask the bot did not key itself, taken from
 * its normalized text (case, accents' composition, spacing, punctuation and
 * markdown ignored), so the same ask in a repeating routine's next run
 * replaces its pending card in place instead of raising a second one. */
export function askTextKey(question: string): string {
  const plain = question.normalize("NFC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return `ask-${createHash("sha256").update(plain).digest("hex").slice(0, 16)}`;
}

/** Row `message` is the pending card the bot raised with `key`. */
function pendingWithKey(message: Message | undefined, key: string): message is Message {
  const card = message?.kind === "options" ? message.card : undefined;
  return Boolean(card && card.askKey === key && !card.answered && !card.dismissed && !card.expired);
}

/** The pending card raised with `key` in one conversation's `messages`,
 * newest first. `accepts`: the card is the asking bot's own (#4219: in a
 * room several bots raise cards, each with its own keys). */
export function pendingKeyedCard(
  threadId: string,
  messages: readonly Message[],
  key: string,
  accepts: (message: Message) => boolean = () => true,
): { threadId: string; message: Message } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (pendingWithKey(message, key) && accepts(message)) return { threadId, message };
  }
  return null;
}

interface Spot { threadId: string; messageId: string }

export interface AskKeyIndexDeps {
  /** Rows that may hold a pending keyed card (a superset). */
  seed(): Iterable<{ threadId: string; message: Message }>;
  messagesFor(threadId: string): readonly Message[];
}

/** Where each pending keyed card is, so a keyed ask_choice reads only the
 * conversation that holds its card, never every conversation of the bot (a
 * routine that runs every few minutes leaves thousands). Filled when a card
 * is raised, and once from the open request cards in storage after a
 * restart (an indexed read); a card answered, retired, expired or deleted
 * leaves it when its row changes, and a stale spot is dropped on lookup. */
export class AskKeyIndex {
  private readonly byKey = new Map<string, Spot[]>();
  private readonly keyOfRow = new Map<string, string>();
  private seeded = false;
  private readonly deps: AskKeyIndexDeps;

  constructor(deps: AskKeyIndexDeps) {
    this.deps = deps;
  }

  private seedOnce(): void {
    if (this.seeded) return;
    this.seeded = true;
    for (const { threadId, message } of this.deps.seed()) {
      const key = message.kind === "options" ? message.card?.askKey : undefined;
      if (key && pendingWithKey(message, key)) this.remember(key, threadId, message.id);
    }
  }

  /** Card row `messageId` of `threadId` was raised with `key`. */
  remember(key: string, threadId: string, messageId: string): void {
    const row = `${threadId}\u0000${messageId}`;
    if (this.keyOfRow.get(row) === key) return;
    this.forget(threadId, messageId);
    this.keyOfRow.set(row, key);
    const spots = this.byKey.get(key) ?? [];
    spots.push({ threadId, messageId });
    this.byKey.set(key, spots);
  }

  forget(threadId: string, messageId: string): void {
    const row = `${threadId}\u0000${messageId}`;
    const key = this.keyOfRow.get(row);
    if (key === undefined) return;
    this.keyOfRow.delete(row);
    const spots = (this.byKey.get(key) ?? []).filter((spot) => spot.threadId !== threadId || spot.messageId !== messageId);
    if (spots.length) this.byKey.set(key, spots);
    else this.byKey.delete(key);
  }

  /** Row `messageId` of `threadId` changed (null: the whole conversation
   * was deleted): an indexed card no longer pending leaves the index. Rows
   * it does not hold cost nothing. */
  changed(threadId: string, messageId: string | null): void {
    if (messageId === null) {
      for (const row of this.keyOfRow.keys()) {
        if (row.startsWith(`${threadId}\u0000`)) this.forget(threadId, row.slice(threadId.length + 1));
      }
      return;
    }
    const key = this.keyOfRow.get(`${threadId}\u0000${messageId}`);
    if (key === undefined) return;
    const message = this.deps.messagesFor(threadId).find((row) => row.id === messageId);
    if (!pendingWithKey(message, key)) this.forget(threadId, messageId);
  }

  /** The newest pending card raised with `key` in a conversation `inScope`
   * accepts (the bot's own with the same person) whose card `accepts`
   * takes (#4219: the asking bot's own, in a room several bots share).
   * Only those conversations' rows are read. */
  find(key: string, inScope: (threadId: string) => boolean, accepts: (message: Message) => boolean = () => true): { threadId: string; message: Message } | null {
    this.seedOnce();
    const spots = this.byKey.get(key);
    if (!spots) return null;
    for (const spot of [...spots].reverse()) {
      if (!inScope(spot.threadId)) continue;
      const message = this.deps.messagesFor(spot.threadId).find((row) => row.id === spot.messageId);
      if (!pendingWithKey(message, key)) {
        this.forget(spot.threadId, spot.messageId);
        continue;
      }
      if (accepts(message)) return { threadId: spot.threadId, message };
    }
    return null;
  }

  size(): number {
    return this.keyOfRow.size;
  }
}

/** A closed card: a question card is retired as expired, the way a
 * superseded turn retires its questions (approvals/retire-open-questions.ts);
 * a passive card in the chat is put away. */
export function closedAskCard(card: Card): Card {
  return card.requestId ? { ...card, expired: true, options: [] } : { ...card, dismissed: true };
}

/** #4233: an ask a repeating routine's run wrote as text (routines.ts
 * routineClaimedCardChoices) drawn holding nothing and keyed by its text
 * (askTextKey): the same ask in a later run replaces its pending card in
 * place (#4205 keys), never a second card nor a second ring. True when the
 * ask has its card. */
export function raiseTextKeyedAsk<C extends { question: string; options: string[] }>(
  threadId: string,
  choice: C,
  deps: {
    find(key: string): { threadId: string; message: Message } | null;
    remember(key: string, threadId: string, messageId: string): void;
    patch(threadId: string, messageId: string, card: Card): boolean;
    raise(choice: C & { card: { askKey: string; noHold: true } }): { messageId: string } | null;
  },
): boolean {
  const askKey = askTextKey(choice.question);
  const found = deps.find(askKey);
  if (found && deps.patch(found.threadId, found.message.id, replacedAskCard(found.message.card!, { question: choice.question, options: choice.options, noHold: true }))) return true;
  const drawn = deps.raise({ ...choice, card: { askKey, noHold: true } });
  if (drawn) deps.remember(askKey, threadId, drawn.messageId);
  return Boolean(drawn);
}

/** The pending card's new words: same card, same request, same place. */
export function replacedAskCard(card: Card, next: { question: string; options: string[]; noHold: boolean; questionOptions?: Array<{ label: string; description?: string }>; askTo?: Card["askTo"] }): Card {
  const questionOptions = next.questionOptions ?? next.options.map((label) => ({ label }));
  const questions = card.questionRequest?.questions;
  const { noHold: _held, ...rest } = card;
  return {
    ...rest,
    subtitle: next.question,
    options: next.options,
    ...(next.noHold ? { noHold: true as const } : {}),
    // #4219: re-addressed to another person of the room
    ...(next.askTo ? { askTo: next.askTo } : {}),
    ...(card.questionRequest && questions?.length
      ? { questionRequest: { ...card.questionRequest, questions: [{ ...questions[0]!, question: next.question, options: questionOptions }] } }
      : {}),
  };
}
