// #4438: a waiting card is kept true when the person opens it. A bot's keyed
// card (ask-choice-keys.ts) describes a state read when it was raised; the
// thing it asks about may have been done another way since. The routine that
// raised it re-checks it at its next run (openCardsNote), and an answer is
// re-checked before it is applied (messages/replies.ts staleCardRule). When
// the person opens the chat, its pinned card or Today, the asking bot also
// re-checks its cards whose facts are older than its last check, in a quiet
// turn of its own conversation for this (never the person's chat): it closes
// with one line the ones already done and asks again, with the same key,
// the ones whose facts changed. Nothing is posted in the chat and nothing
// rings: the card changes in place and the pinned count follows.
import { openCardsNote, type OpenCardFacts } from "./ask-choice-keys.ts";

/** A bot's keyed card waiting on a person, as the re-check reads it. */
export interface WaitingKeyedCard extends OpenCardFacts {
  botId: string;
  /** The person it waits on. */
  person: string;
  /** Its row: conversation and message. */
  row: string;
}

/** Facts read this recently are fresh: opening the list again within this
 * time starts no second check of the same card. */
export const CARD_RECHECK_AFTER_MS = 5 * 60_000;

/** The name the bot's conversation for these checks goes by. */
export const CARD_CHECK_CALLER = "Card check";

/** Rows the bot's conversation for these checks holds before the next check
 * starts a fresh one: each check reads its cards again from the block it is
 * given, never from earlier checks. */
export const CARD_CHECK_CONVERSATION_ROWS = 40;

export interface OpenCardsRecheckDeps {
  now(): number;
  /** Start the asking bot's quiet check of `person`'s cards with `prompt`.
   * False: it could not start now (the bot is busy, gone), and the next
   * opening of the list tries again. */
  start(botId: string, person: string, prompt: string): boolean;
}

/** The quiet check's prompt: the bot's open cards with when their facts were
 * read, and what to do with each (openCardsNote). */
export function quietCheckPrompt(cards: readonly OpenCardFacts[]): string {
  return [
    "Quiet check: the person just opened their waiting cards. This conversation is not their chat: nothing you write here reaches them, so write nothing for them.",
    openCardsNote(cards, "you raised")!,
    "Do only that, then end with one short line for the record.",
  ].join("\n");
}

export class OpenCardsRecheck {
  /** When each card's row was last sent to a check, and its bot. */
  private readonly checkedAt = new Map<string, { botId: string; at: number }>();
  private readonly deps: OpenCardsRecheckDeps;

  constructor(deps: OpenCardsRecheckDeps) {
    this.deps = deps;
  }

  /** The person's waiting list was read: only a read that opens it (the
   * screen's first read: the chat, its pinned card, Today) re-checks; a
   * screen's poll or a live frame's reload never starts a turn. `botId`:
   * the list is one bot's chat or pinned panel, and only that bot, the one
   * that asked, re-checks; none (Today) is every bot of the person. */
  listRead(opened: boolean, cards: (botId?: string) => readonly WaitingKeyedCard[], botId?: string): number {
    return opened ? this.pass(cards(botId), botId) : 0;
  }

  /** The person opened their waiting cards: each bot whose cards' facts are
   * older than their last check re-checks them, one quiet turn per bot and
   * person. `botId`: `cards` are only that bot's, so only its rows that are
   * gone are forgotten. Returns how many checks started. */
  pass(cards: readonly WaitingKeyedCard[], botId?: string): number {
    const now = this.deps.now();
    const scoped = botId ? cards.filter((card) => card.botId === botId) : cards;
    const live = new Set(scoped.map((card) => card.row));
    for (const [row, seen] of this.checkedAt) if (!live.has(row) && (!botId || seen.botId === botId)) this.checkedAt.delete(row);
    const due = new Map<string, WaitingKeyedCard[]>();
    for (const card of scoped) {
      const read = Math.max(card.factsAt, this.checkedAt.get(card.row)?.at ?? 0);
      if (now - read < CARD_RECHECK_AFTER_MS) continue;
      const id = `${card.botId}\u0000${card.person}`;
      due.set(id, [...(due.get(id) ?? []), card]);
    }
    let started = 0;
    for (const group of due.values()) {
      const { botId, person } = group[0]!;
      let ok = false;
      try {
        ok = this.deps.start(botId, person, quietCheckPrompt(group));
      } catch {
        ok = false;
      }
      if (!ok) continue;
      for (const card of group) this.checkedAt.set(card.row, { botId, at: now });
      started += 1;
    }
    return started;
  }
}
