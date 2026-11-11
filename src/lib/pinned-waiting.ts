// What the pinned row over the composer draws (#3214, #3512, #3543): the
// server's own list of what waits on the person (GET /api/approvals?waiting=1,
// shared/waiting-items.ts), the one list Today and the organization's
// connector read, so the three surfaces cannot disagree.
//
// Before #3543 the app used that list only to choose which conversations to
// read, then rebuilt the items from their transcripts: an item in a
// conversation it had not loaded, or of a kind it did not know, was missing
// from the pinned row while Today and the connector listed it. Now each
// server item is drawn as it is served, with its message (as the
// conversation shows it) given to the conversation's own card for its kind.
// An item of a kind this app version does not know, or without its message,
// is still drawn: its text, and its conversation opens.
//
// The list is read again when a card, a question in words or an offer opens
// or closes in one of the conversations (their live frames), after missed
// frames, and on a slow safety timer (#3542).
import { createContext, use, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, type Message } from "@/state/store";
import { listenLiveFrames } from "@/lib/live-events";
import { pendingApprovals, type Pending } from "@/components/PendingApproval";
import { inputRequestCard, pendingOffers, pendingQuestions, type PinnedItem } from "@/lib/pending-question";
import { waitingChangeFrame, type ServedWaitingItem } from "../../shared/waiting-items";

/** #3542: the safety net only; live frames read the list when it changes. */
export const WAITING_ITEMS_POLL_MS = 10 * 60_000;

/** Frames that come together (a card and its notice) read the list once. */
const WAITING_RELOAD_DELAY_MS = 400;

type Drawn =
  | { kind: "approval"; pending: Pending }
  | { kind: "question" | "offer"; message: Message }
  | { kind: "request"; message: Message; card: NonNullable<Message["attention"]> }
  | "settled"
  | null;

const cardClosed = (message: Message): boolean => Boolean(message.card && (message.card.answered || message.card.dismissed || message.card.expired));

/** The conversation's card for one server item, read from its message:
 * null when this app cannot draw it with one (drawn as `other`), "settled"
 * when the message says it is already answered. */
function drawnAs(item: ServedWaitingItem, message: Message | undefined, threadId: string, approvals: readonly Pending[]): Drawn {
  if (!message) return null;
  const asApproval = (): Drawn => {
    // the composer's own copy of a live approval (a parallel task's, a
    // bot-to-bot conversation's) knows who asked; the decision goes to the
    // thread the server says it waits in
    const live = approvals.find((pending) => (item.messageId ? pending.message.id === item.messageId : pending.requestId === item.id));
    if (live) return pendingApprovals([message]).length ? { kind: "approval", pending: { ...live, message } } : null;
    const pending = pendingApprovals([message])[0];
    if (!pending) return null;
    return { kind: "approval", pending: pending.threadId || item.threadId === threadId ? pending : { ...pending, threadId: item.threadId } };
  };
  const asQuestion = (): Drawn => (pendingQuestions([message]).length ? { kind: "question", message } : null);
  switch (item.kind) {
    case "approval":
    case "question":
    case "proposal": {
      if (item.kind === "proposal" && item.proactiveId) {
        if (pendingOffers([message]).length) return { kind: "offer", message };
        return cardClosed(message) ? "settled" : null;
      }
      const drawn = item.kind === "question" ? asQuestion() ?? asApproval() : asApproval() ?? asQuestion();
      if (drawn) return drawn;
      return cardClosed(message) ? "settled" : null;
    }
    case "request": {
      if (message.inputRequest) {
        const request = message.inputRequest;
        if (request.answered || request.expired) return "settled";
        const card = inputRequestCard(message);
        return card ? { kind: "request", message, card } : null;
      }
      if (message.attention) return message.attention.handledAt ? "settled" : { kind: "request", message, card: message.attention };
      return null;
    }
    default:
      return null;
  }
}

/** The pinned row's items: the server's items, in the server's order, each
 * drawn with its card. `fresh` is the transcript the store holds for the
 * conversation on screen: an item whose message it holds is drawn from that
 * newer copy, and one it shows settled (just answered here) leaves at once,
 * before the list is read again. `approvals` are the composer's own live
 * approvals (this turn's, its parallel tasks'): they add who asked to the
 * server's item of the same request, and one the list does not carry yet
 * is pinned after the server's items (#3615). */
export function pinnedItemsFrom(items: readonly ServedWaitingItem[], threadId: string, fresh: readonly Message[] = [], approvals: readonly Pending[] = []): PinnedItem[] {
  const byId = new Map(fresh.map((message) => [message.id, message]));
  const out: PinnedItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = `${item.threadId}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const served = item.message && typeof item.message === "object" ? item.message as Message : undefined;
    const local = item.threadId === threadId && item.messageId ? byId.get(item.messageId) : undefined;
    // the store's copy lacks what the server adds to an input request row
    // (its card), so it only says whether the row is settled
    const message = local && served ? { ...served, ...local, ...(served.attention && !local.attention ? { attention: served.attention } : {}) } : local ?? served;
    const drawn = drawnAs(item, message, threadId, approvals);
    if (drawn === "settled") continue;
    const base = { key, at: item.at, item, ...(item.threadId !== threadId ? { threadId: item.threadId } : {}) };
    if (!drawn) out.push({ ...base, kind: "other" });
    else if (drawn.kind === "approval") out.push({ ...base, kind: "approval", pending: drawn.pending });
    else if (drawn.kind === "request") out.push({ ...base, kind: "request", message: drawn.message, card: drawn.card });
    else out.push({ ...base, kind: drawn.kind, message: drawn.message });
  }
  // #3615: a live approval of this conversation the server's list does not
  // carry yet (the list is read again a moment after the card opens, or could
  // not be read) is pinned as it is: the card that waits on the person right
  // now never waits for the list to show over the box. Once the list carries
  // it, the server's item is the one drawn (matched above).
  const listed = (pending: Pending) => items.some((item) => (item.messageId ? item.messageId === pending.message.id : item.id === pending.requestId));
  for (const pending of approvals) {
    if (listed(pending)) continue;
    const where = pending.threadId ?? threadId;
    const key = `${where}:${pending.requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const title = pending.message.card?.title || pending.detail || pending.tool;
    const item: ServedWaitingItem = {
      id: pending.requestId, kind: "approval", botId: pending.message.from?.botId ?? "", botName: pending.askedBy ?? "",
      threadId: where, messageId: pending.message.id, at: pending.message.at, ageMs: 0, title, text: pending.detail || title,
      options: pending.message.card?.options ?? [], answerWith: "decision", freeText: false, skippable: true,
    };
    // a parallel task's approval carries its own thread, where the decision goes
    out.push({ key, at: item.at, item, kind: "approval", pending });
  }
  // #3681: a question of this conversation the list does not carry yet is
  // pinned the same way: the conversation leaves it to the pinned card from
  // its first frame, never drawn there for a moment and then taken away.
  for (const message of pendingQuestions(fresh)) {
    if (items.some((item) => item.messageId === message.id || (item.threadId === threadId && item.id === message.card?.requestId))) continue;
    const key = `${threadId}:${message.card?.requestId ?? message.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const first = message.card?.questionRequest?.questions[0];
    const title = first?.question || message.card?.title || "";
    const options = (first?.options ?? []).map((option) => option.label);
    const item: ServedWaitingItem = {
      id: message.card?.requestId ?? message.id, kind: "question", botId: message.from?.botId ?? "", botName: message.from?.name ?? "",
      threadId, messageId: message.id, at: message.at, ageMs: 0, title, text: title,
      options, answerWith: options.length ? "option" : "text", freeText: first?.custom !== false, skippable: true,
    };
    out.push({ key, at: item.at, item, kind: "question", message });
  }
  return out;
}

/** #3681, the owner's rule (2026-11-11): while an ask waits and the pinned
 * card of the view holds it, the conversation draws no card for it; once it
 * is answered, skipped or expired its record is back at its place. These
 * are the messages the pinned card holds: every item it draws with the
 * conversation's own card. An item of a kind this app does not know
 * (`other`) is only its text up there, so its card stays in the
 * conversation. The conversation reads this set, never a second rule. */
export function pinnedHeldIds(items: readonly PinnedItem[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const item of items) {
    if (item.kind === "other") continue;
    out.add(item.kind === "approval" ? item.pending.message.id : item.message.id);
  }
  return out;
}

/** Where "See in the conversation" lands for an ask the conversation does
 * not draw while it waits (#3681): the nearest message before it that the
 * conversation draws as words (the bot's own words that led to the ask, or
 * the person's message before them). The ask itself when nothing is. */
export function pinnedJumpTarget(messages: readonly Message[], askId: string, held: ReadonlySet<string>): string {
  const at = messages.findIndex((message) => message.id === askId);
  for (let index = at - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (held.has(message.id)) continue;
    if (message.kind === "text" && (message.text ?? "").trim()) return message.id;
  }
  return askId;
}

/** The pinned card's hold, shared by one view's composer (which writes it)
 * and its conversation (which reads it). A view with no pinned card (no
 * composer, a read-only conversation, a side panel, the Approvals page)
 * provides none, and its conversation draws every card as before. */
export interface PinnedHold {
  get: () => ReadonlySet<string>;
  set: (ids: ReadonlySet<string>) => void;
  subscribe: (listener: () => void) => () => void;
}

const NOTHING_HELD: ReadonlySet<string> = new Set();

export function createPinnedHold(): PinnedHold {
  let held = NOTHING_HELD;
  const listeners = new Set<() => void>();
  return {
    get: () => held,
    set: (ids) => {
      if (ids.size === held.size && [...ids].every((id) => held.has(id))) return;
      held = ids.size ? ids : NOTHING_HELD;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export const PinnedHoldContext = createContext<PinnedHold | null>(null);

const noSubscribe = () => () => undefined;
const nothingHeld = () => NOTHING_HELD;

/** The messages this view's pinned card holds right now (empty without one). */
export function usePinnedHeld(): ReadonlySet<string> {
  const hold = use(PinnedHoldContext);
  return useSyncExternalStore(hold?.subscribe ?? noSubscribe, hold?.get ?? nothingHeld, hold?.get ?? nothingHeld);
}

/** The composer tells its view what its pinned card holds; nothing once it
 * is gone (the view then draws its cards again). Before paint, so the card
 * never shows twice for a frame. */
export function usePublishPinnedHold(items: readonly PinnedItem[]): void {
  const hold = use(PinnedHoldContext);
  const ids = pinnedHeldIds(items);
  const key = [...ids].join("\u0000");
  useLayoutEffect(() => {
    hold?.set(key ? new Set(key.split("\u0000")) : NOTHING_HELD);
  }, [hold, key]);
  useLayoutEffect(() => () => hold?.set(NOTHING_HELD), [hold]);
}

/** The server's items that wait on the person in one bot's conversations
 * (`botId`), or in a room's threads (`threads`, no bot). `stamp` changes
 * when the bot's waiting state or topics change: the list is read again. */
export function useServerWaitingItems(botId: string | undefined, threads: readonly string[], stamp: string, room = false): ServedWaitingItem[] {
  const [items, setItems] = useState<ServedWaitingItem[]>([]);
  const waitingNow = useRef<Set<string>>(new Set());
  waitingNow.current = new Set(items.map((item) => item.threadId));
  const threadsKey = threads.join("\u0000");
  const active = Boolean(botId) || (room && threads.length > 0);
  useEffect(() => {
    if (!active) {
      setItems([]);
      return;
    }
    let live = true;
    let soon: number | undefined;
    const own = new Set(threadsKey ? threadsKey.split("\u0000") : []);
    const query = botId && !room ? `/api/approvals?waiting=1&botId=${encodeURIComponent(botId)}` : "/api/approvals?waiting=1";
    const load = () => {
      api<{ waiting?: ServedWaitingItem[] }>(query)
        .then((body) => {
          if (!live) return;
          const all = Array.isArray(body.waiting) ? body.waiting.filter((item) => item && typeof item.id === "string" && typeof item.threadId === "string") : [];
          setItems(room ? all.filter((item) => own.has(item.threadId)) : all);
        })
        .catch(() => undefined);
    };
    const loadSoon = () => {
      if (soon !== undefined) return;
      soon = window.setTimeout(() => {
        soon = undefined;
        load();
      }, WAITING_RELOAD_DELAY_MS);
    };
    load();
    const stop = listenLiveFrames({
      onFrame: (frame) => {
        if (waitingChangeFrame(frame as Parameters<typeof waitingChangeFrame>[0], own, waitingNow.current)) loadSoon();
      },
      onMissedFrames: loadSoon,
    });
    const timer = window.setInterval(load, WAITING_ITEMS_POLL_MS);
    return () => {
      live = false;
      stop();
      if (soon !== undefined) window.clearTimeout(soon);
      window.clearInterval(timer);
    };
  }, [active, botId, room, stamp, threadsKey]);
  return items;
}
