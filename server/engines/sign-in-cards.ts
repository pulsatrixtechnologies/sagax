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

/** #4233: the person a keyed fix card is for (its payer), or "server" for a
 * server engine's card, which goes to the administrators. Lower case. */
export function keyedCardPerson(access: Pick<WireAccessCard, "payerPrincipalId">): string {
  return access.payerPrincipalId?.trim().toLowerCase() || "server";
}

/** #4233: whether a refusal account (refusalAccount: [via, principal, slot]
 * as JSON) is the one a keyed card is about. A card for a person matches
 * that person's account; a server engine's card any account of the engine. */
export function keyedCardAccount(access: Pick<WireAccessCard, "payerPrincipalId">, account: string | undefined): boolean {
  const payer = access.payerPrincipalId?.trim().toLowerCase();
  if (!payer || account === undefined) return true;
  let principal: unknown;
  try { principal = (JSON.parse(account) as unknown[])[1]; } catch { return true; }
  return typeof principal !== "string" || principal === "organization" || principal.toLowerCase() === payer;
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
  /** #4233: the open fix card raised with `key` for `person`
   * (keyedCardPerson), read from storage after a restart. */
  pendingKeyed(key: string, person: string): { threadId: string; messageId: string } | null;
  /** #4233: the engine `engine` works again on `account`: its open keyed
   * cards close. `signedInOnly`: only a sign-in was seen, so a credit card
   * stays. How many closed. */
  retireKeyed(engine: string, account: string | undefined, signedInOnly: boolean): number;
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
  /** #4233: open keyed fix cards, by message id. Same life as `open`. */
  let keyed: Map<string, OpenCard & { key: string; person: string; engine: string; access: WireAccessCard }> | null = null;

  const keep = (index: Map<string, Map<string, OpenCard>>, threadId: string, message: WireMessage) => {
    const card = signInCard(message);
    if (!card) return;
    const payer = lower(card.payerPrincipalId);
    let cards = index.get(payer);
    if (!cards) index.set(payer, cards = new Map());
    cards.set(message.id, { threadId, messageId: message.id, botId: card.botId, at: message.at, ownerPrincipalId: card.ownerPrincipalId ?? "" });
  };
  const keepKeyed = (index: NonNullable<typeof keyed>, threadId: string, message: WireMessage) => {
    const access = message.kind === "access" ? message.access : undefined;
    if (!access?.key || !access.instanceId) return;
    index.set(message.id, { threadId, messageId: message.id, botId: access.botId, at: message.at, ownerPrincipalId: access.ownerPrincipalId ?? "",
      key: access.key, person: keyedCardPerson(access), engine: access.instanceId, access });
  };
  const loaded = () => {
    if (open) return open;
    const index = new Map<string, Map<string, OpenCard>>();
    const keyedIndex: NonNullable<typeof keyed> = new Map();
    for (const { threadId, message } of deps.accessCards()) {
      keep(index, threadId, message);
      keepKeyed(keyedIndex, threadId, message);
    }
    open = index;
    keyed = keyedIndex;
    return index;
  };
  const keyedCards = () => { loaded(); return keyed!; };
  /** `audience`: who else was told (a server engine's administrators). */
  const close = (payer: string, card: OpenCard, audience: readonly string[] = []): boolean => {
    let removed = false;
    try { removed = deps.remove(card.threadId, card.messageId); } catch { /* still closed in memory: tried again at the next start */ }
    try { deps.withdrawNotice({ threadId: card.threadId, botId: card.botId, at: card.at, personIds: [...new Set([payer, card.ownerPrincipalId, ...audience].filter(Boolean))] }); } catch { /* nothing waits */ }
    return removed;
  };

  return {
    noted(threadId, message) {
      if (open) keep(open, threadId, message);
      if (keyed) keepKeyed(keyed, threadId, message);
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
        keyed?.delete(card.messageId);
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
          keyed?.delete(card.messageId);
          if (close(payer, card)) removed += 1;
        }
        if (!cards.size) index.delete(payer);
      }
      if (removed) deps.log?.(`[sign-in] ${removed} background sign-in card(s) removed at start`);
      return removed;
    },
    pendingKeyed(key, person) {
      const who = person.toLowerCase();
      const cards = keyedCards();
      for (const card of cards.values()) {
        if (card.key !== key || card.person !== who) continue;
        // a card taken out some other way (the person's own done or cancel)
        if (!deps.messagesFor(card.threadId).some((m) => m.id === card.messageId)) { cards.delete(card.messageId); continue; }
        return { threadId: card.threadId, messageId: card.messageId };
      }
      return null;
    },
    retireKeyed(engine, account, signedInOnly) {
      const cards = keyedCards();
      let closed = 0;
      for (const card of cards.values()) {
        if (card.engine !== engine || !keyedCardAccount(card.access, account)) continue;
        if (signedInOnly && card.access.cause !== "sign_in_expired") continue;
        cards.delete(card.messageId);
        const payer = lower(card.access.payerPrincipalId ?? "");
        if (payer) open?.get(payer)?.delete(card.messageId);
        close(payer, card, card.access.audiencePrincipalIds ?? []);
        closed += 1;
      }
      if (closed) deps.log?.(`[sign-in] ${closed} fix card(s) closed: the engine works again`);
      return closed;
    },
  };
}
