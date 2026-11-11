// #3551: the open "sign-in has expired" cards of a person's account.
//
// One state is told once. A refused turn shows its card in the chat it ran
// in; when a call on that account signs in again (a turn, a one-shot call, a
// renew), every such card of that account closes by itself, on every bot that
// shows it, and the notice still waiting for the person's brief goes with it.
//
// It also takes back the cards #3533's background path posted: at a start,
// a one-shot card (see isOneShotSignInCard) whose account signs in, or that
// was posted while the account was only at a usage limit (a limit never marks
// the sign-in expired, so its account reads as signed in), is removed without
// a word. A turn's card is never touched by that cleanup.
import type { WireAccessCard, WireMessage } from "../../shared/wire.ts";

/** #3533 reached the servers on 2026-11-10: no background card is older. */
export const ONE_SHOT_CARDS_SINCE = Date.UTC(2026, 10, 10);
/** A turn's card follows the person's message or the turn's own rows; a
 * background card came to a conversation nobody had spoken in this long. */
export const ONE_SHOT_QUIET_MS = 10 * 60_000;

export interface SignInCardAccount { instanceId: string; driverKind: string }

interface OpenCard { threadId: string; messageId: string; botId: string; at: number; ownerPrincipalId: string }

export interface SignInCardsDeps {
  /** Every stored access card (message-db accessCardMessages). */
  accessCards(): Array<{ threadId: string; message: WireMessage }>;
  /** The conversation the card sits in, as stored. */
  messagesFor(threadId: string): readonly WireMessage[];
  /** The bot's own conversation (where #3533 posted its cards). */
  mainThreadOf(botId: string): string | null;
  /** The engine account the bot runs on now. */
  accountOf(botId: string): SignInCardAccount | null;
  /** Take the card out of its conversation. */
  remove(threadId: string, messageId: string): boolean;
  /** Take back what still waits of its notice. */
  withdrawNotice(card: { threadId: string; botId: string; at: number; personIds: string[] }): void;
  /** At a start: whether the person's sign-in on that account works (not
   * marked expired, not held as signed out). */
  signInWorks(payerPrincipalId: string, botId: string, account: SignInCardAccount): boolean;
  log?(line: string): void;
}

export interface SignInCards {
  /** A stored message, as it is written: an open sign-in card is kept. */
  noted(threadId: string, message: WireMessage): void;
  /** A call on this person's account signed in: their open sign-in cards on
   * it close. `account` names the engine account (an instance id) or, from a
   * renew, only the driver. How many closed. */
  signedIn(payerPrincipalId: string, account: { instanceId?: string; driverKind?: string }): number;
  /** At a start: the background cards of #3533 whose account signs in go. */
  cleanupAtStart(): number;
}

function signInCard(message: WireMessage): (WireAccessCard & { payerPrincipalId: string }) | null {
  const access = message.kind === "access" ? message.access : undefined;
  if (!access || access.reason !== "no_access" || access.cause !== "sign_in_expired" || !access.payerPrincipalId) return null;
  return access as WireAccessCard & { payerPrincipalId: string };
}

/** #3551: a card #3533's one-shot path posted, told from a turn's by what is
 * stored. The one-shot path wrote `{ role: "bot", kind: "access", access }`
 * at the end of the bot's own conversation, nothing else: no turn id, no
 * request it answers, no room speaker, never a routine's card. A turn's card
 * comes right after the person's message or the turn's own rows; a one-shot
 * card came to a conversation where nobody had written and no turn had run
 * in the ten minutes before it. Pure. */
export function isOneShotSignInCard(message: WireMessage, thread: readonly WireMessage[], mainThread: boolean): boolean {
  const card = signInCard(message);
  if (!card || !mainThread || card.routine || message.role !== "bot") return false;
  if (message.turnId || message.requestMessageId || message.from || message.at < ONE_SHOT_CARDS_SINCE) return false;
  return !thread.some((other) => other.id !== message.id && other.at <= message.at && message.at - other.at <= ONE_SHOT_QUIET_MS
    && (other.role === "user" || Boolean(other.turnId)));
}

const lower = (id: string) => id.trim().toLowerCase();

export function createSignInCards(deps: SignInCardsDeps): SignInCards {
  /** Open sign-in cards by the person whose account was refused. Read from
   * storage the first time a call signs in, then kept from the writes. */
  let open: Map<string, Map<string, OpenCard>> | null = null;

  const keep = (index: Map<string, Map<string, OpenCard>>, threadId: string, message: WireMessage) => {
    const card = signInCard(message);
    if (!card) return;
    const payer = lower(card.payerPrincipalId);
    let cards = index.get(payer);
    if (!cards) index.set(payer, cards = new Map());
    cards.set(message.id, { threadId, messageId: message.id, botId: card.botId, at: message.at, ownerPrincipalId: card.ownerPrincipalId ?? "" });
  };
  const loaded = () => {
    if (open) return open;
    const index = new Map<string, Map<string, OpenCard>>();
    for (const { threadId, message } of deps.accessCards()) keep(index, threadId, message);
    open = index;
    return index;
  };
  const close = (payer: string, card: OpenCard): boolean => {
    let removed = false;
    try { removed = deps.remove(card.threadId, card.messageId); } catch { /* still closed in memory: tried again at the next start */ }
    try { deps.withdrawNotice({ threadId: card.threadId, botId: card.botId, at: card.at, personIds: [...new Set([payer, card.ownerPrincipalId].filter(Boolean))] }); } catch { /* nothing waits */ }
    return removed;
  };

  return {
    noted(threadId, message) {
      if (open) keep(open, threadId, message);
    },
    signedIn(payerPrincipalId, account) {
      if (!payerPrincipalId) return 0;
      const payer = lower(payerPrincipalId);
      const cards = loaded().get(payer);
      if (!cards?.size) return 0;
      let closed = 0;
      for (const card of cards.values()) {
        const on = deps.accountOf(card.botId);
        if (!on) continue;
        if (account.instanceId ? on.instanceId !== account.instanceId : on.driverKind !== account.driverKind) continue;
        cards.delete(card.messageId);
        close(payer, card);
        closed += 1;
      }
      if (!cards.size) loaded().delete(payer);
      if (closed) deps.log?.(`[sign-in] ${closed} sign-in card(s) closed: the account signs in again`);
      return closed;
    },
    cleanupAtStart() {
      let removed = 0;
      const index = loaded();
      for (const [payer, cards] of index) {
        for (const card of cards.values()) {
          const thread = deps.messagesFor(card.threadId);
          const message = thread.find((m) => m.id === card.messageId);
          if (!message) { cards.delete(card.messageId); continue; }
          if (!isOneShotSignInCard(message, thread, deps.mainThreadOf(card.botId) === card.threadId)) continue;
          const account = deps.accountOf(card.botId);
          if (account && !deps.signInWorks(payer, card.botId, account)) continue;
          cards.delete(card.messageId);
          if (close(payer, card)) removed += 1;
        }
        if (!cards.size) index.delete(payer);
      }
      if (removed) deps.log?.(`[sign-in] ${removed} background sign-in card(s) removed at start`);
      return removed;
    },
  };
}
