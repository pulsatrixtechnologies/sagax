// What waits for the person, in one place (#3512).
//
// Before this, three surfaces counted what a bot waits on the person for,
// each its own way, and they disagreed: the pinned row over a bot's message
// box read the open cards of the topics it guessed held one, Today listed the
// option cards, the "needs you" cards and the proactive offers, and the list
// served to an organization's connector (list_pending_approvals) read only
// the option cards of the threads marked waiting. A live check counted 18
// items in Today and 2 in the connector's list; an offer card sat in an older
// topic where no pinned row looked.
//
// The one source is the server's Today list (server/index-leaves/inboxPending.ts,
// server/approvals/today-rows.ts): every open approval card, question card,
// question in words (a "needs you" card or a parked teammate's input
// request) and proposal or offer card of the viewer's conversations. This
// file reads one Today row as a waiting item: its kind, bot, conversation,
// age, full text, options and how it is answered or skipped. The pinned row
// (GET /api/approvals?waiting=1&botId=), Today and the connector's list
// (server/org/org-member-routes.ts) all read these items, so they agree.
//
// Pure: no store, no clock (the age is computed from `now`).
import type { InboxApproval } from "./approvals-inbox.ts";

/** What waits: a permission card, a question card, a question in words
 * (answered with the person's own words), a proposal or offer card. */
export type WaitingKind = "approval" | "question" | "request" | "proposal";

/** How it is answered: allow or deny, one of its options, or words. */
export type WaitingAnswerWith = "decision" | "option" | "text";

/** The id prefix of a question in words (a "needs you" card or an input
 * request row): `attention:<messageId>`, as Today addresses it. */
export const REQUEST_ID_PREFIX = "attention:";
/** The id prefix of a proactive offer: `proactive:<proposalId>`. */
export const OFFER_ID_PREFIX = "proactive:";

export interface WaitingItem {
  /** What answers it: a card's request id, `attention:<messageId>` for a
   * question in words, `proactive:<proposalId>` for an offer. */
  id: string;
  kind: WaitingKind;
  /** The bot whose conversation holds it. */
  botId: string;
  botName: string;
  /** The conversation (thread) it sits in. */
  threadId: string;
  messageId?: string;
  /** When it was raised (ms). */
  at: number;
  /** How long it has waited (ms), at the time the list was read. */
  ageMs: number;
  /** One line naming it. */
  title: string;
  /** Its full text, every question and line it carries. */
  text: string;
  /** The options it offers, in order (empty when it takes words only). */
  options: string[];
  answerWith: WaitingAnswerWith;
  /** It also takes the person's own words. */
  freeText: boolean;
  /** Every item can be skipped: closed without an answer. */
  skippable: true;
  /** A question in words: the thread and bot the answer goes to. */
  workThreadId?: string;
  workBotId?: string;
  /** An offer: its proposal id (POST /api/bots/:botId/proactive/:id). */
  proactiveId?: string;
  /** The conversation's own title, when it has one. */
  threadTitle?: string;
  confidential?: boolean;
}

/** #3543: an item as the pinned row receives it (GET /api/approvals?waiting=1):
 * the item with its message exactly as the conversation shows it, so the
 * pinned row draws the server's own items with the conversation's card
 * components, even in a conversation the app has not loaded. */
export type ServedWaitingItem = WaitingItem & { message?: unknown };

/** The served items: each with the message of the Today row it was read
 * from, when the viewer may decide it. */
export function servedWaitingItems(entries: ReadonlyArray<{ item: WaitingItem; row: InboxApproval }>): ServedWaitingItem[] {
  return entries.map(({ item, row }) => (row.message ? { ...item, message: row.message } : item));
}

/** A Today row that waits on the viewer: theirs to answer. A row shown to a
 * team manager, or one that waits on an admin, waits on someone else. */
export function waitsOnViewer(row: Pick<InboxApproval, "decidable" | "scope">): boolean {
  return row.decidable && (row.scope === "mine" || row.scope === "org");
}

type Loose = Record<string, unknown>;
const objectOf = (value: unknown): Loose | undefined => (value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : undefined);
const textOf = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const labelOf = (value: unknown): string => textOf(typeof value === "string" ? value : objectOf(value)?.label);
const labels = (value: unknown): string[] => (Array.isArray(value) ? value.map(labelOf).filter(Boolean) : []);
const firstLine = (text: string): string => text.split("\n").map((line) => line.trim()).find(Boolean) ?? "";
const joined = (parts: readonly string[]): string => parts.filter(Boolean).join("\n\n");

/** One Today row as a waiting item; null when it carries nothing to show. */
export function waitingItemOf(row: InboxApproval, now: number): WaitingItem | null {
  const message = objectOf(row.message);
  const card = objectOf(message?.card);
  const base = {
    botId: row.botId,
    botName: row.botName,
    threadId: row.threadId,
    ...(row.messageId ? { messageId: row.messageId } : {}),
    at: row.at,
    ageMs: Math.max(0, now - row.at),
    skippable: true as const,
    ...(row.threadTitle ? { threadTitle: row.threadTitle } : {}),
    ...(row.confidential ? { confidential: true } : {}),
  };
  if (row.kind === "attention") {
    const attention = objectOf(message?.attention);
    const lines = (Array.isArray(attention?.items) ? attention!.items as unknown[] : []).map((item) => textOf(objectOf(item)?.text)).filter(Boolean);
    const options = labels(attention?.choices);
    const text = lines.join("\n");
    const workThreadId = textOf(attention?.threadId);
    const workBotId = textOf(attention?.botId);
    return {
      ...base,
      id: row.requestId,
      kind: "request",
      title: firstLine(text),
      text,
      options,
      answerWith: options.length ? "option" : "text",
      freeText: true,
      ...(workThreadId ? { workThreadId } : {}),
      ...(workBotId ? { workBotId } : {}),
    };
  }
  const title = textOf(card?.title);
  const subtitle = textOf(card?.subtitle);
  if (row.kind === "proposal" && row.proactiveId) {
    return {
      ...base,
      id: row.requestId,
      kind: "proposal",
      title: title || firstLine(subtitle),
      text: joined([title, subtitle]),
      options: labels(card?.options),
      answerWith: "option",
      freeText: false,
      proactiveId: row.proactiveId,
    };
  }
  if (row.kind === "question") {
    const questions = (Array.isArray(objectOf(card?.questionRequest)?.questions) ? objectOf(card?.questionRequest)!.questions as unknown[] : []).map(objectOf).filter((q): q is Loose => Boolean(q));
    const asked = questions.map((q) => {
      const words = textOf(q.question);
      const choices = labels(q.options);
      return choices.length > 0 && questions.length > 1 ? `${words}\n${choices.map((choice) => `- ${choice}`).join("\n")}` : words;
    });
    const options = questions.length === 1 ? labels(questions[0]!.options) : questions.length ? [] : labels(card?.options);
    const freeText = questions.length ? questions.every((q) => q.custom !== false) : true;
    const text = joined([subtitle && !asked.includes(subtitle) ? subtitle : "", ...asked]) || title;
    return {
      ...base,
      id: row.requestId,
      kind: "question",
      title: firstLine(asked[0] ?? "") || title || firstLine(subtitle),
      text,
      options,
      answerWith: options.length || questions.length > 1 ? "option" : "text",
      freeText,
    };
  }
  const plainTitle = textOf(objectOf(card?.plain)?.title);
  const named = plainTitle || title || textOf(row.tool);
  return {
    ...base,
    id: row.requestId,
    kind: row.kind === "proposal" ? "proposal" : "approval",
    title: named,
    text: joined([named, subtitle !== named ? subtitle : ""]),
    options: labels(card?.options),
    answerWith: "decision",
    freeText: false,
  };
}

/** Every item waiting on the viewer with the Today row it was read from,
 * oldest first. */
export function waitingEntriesFrom(rows: readonly InboxApproval[], now: number): Array<{ item: WaitingItem; row: InboxApproval }> {
  const out: Array<{ item: WaitingItem; row: InboxApproval }> = [];
  for (const row of rows) {
    if (!waitsOnViewer(row)) continue;
    const item = waitingItemOf(row, now);
    if (item) out.push({ item, row });
  }
  return out.sort((a, b) => a.item.at - b.item.at || a.item.id.localeCompare(b.item.id));
}

/** Every item waiting on the viewer, oldest first, from their Today rows. */
export function waitingItemsFrom(rows: readonly InboxApproval[], now: number): WaitingItem[] {
  return waitingEntriesFrom(rows, now).map((entry) => entry.item);
}

/** The items waiting in one bot's conversations (the pinned row). */
export function waitingItemsOfBot(items: readonly WaitingItem[], botId: string): WaitingItem[] {
  return items.filter((item) => item.botId === botId);
}

/** #3542: a live frame (GET /api/events) that may open or close an item
 * waiting on the person in one bot's conversations (`threads`): a card, a
 * question in words or an offer posted or changed there, or the person's
 * own words in a conversation where something waits (`waiting`), which
 * settle a "needs you" card, or a row taken back where something waits.
 * The pinned row asks the server again on these only, never on a short
 * timer. */
export function waitingChangeFrame(
  frame: { kind?: unknown; threadId?: unknown; message?: unknown },
  threads: ReadonlySet<string>,
  waiting: ReadonlySet<string>,
): boolean {
  // #4039: a row taken back where something waits (a routine's request)
  if (frame.kind === "message.removed") return typeof frame.threadId === "string" && waiting.has(frame.threadId);
  if (frame.kind !== "message" && frame.kind !== "message.patch") return false;
  const threadId = frame.threadId;
  if (typeof threadId !== "string" || (!threads.has(threadId) && !waiting.has(threadId))) return false;
  const message = frame.message && typeof frame.message === "object"
    ? frame.message as { role?: unknown; attention?: unknown; inputRequest?: unknown; card?: { requestId?: unknown; proactiveProposal?: unknown } | null }
    : undefined;
  if (!message) return false;
  if (message.attention || message.inputRequest || message.card?.requestId || message.card?.proactiveProposal) return true;
  return frame.kind === "message" && message.role === "user" && waiting.has(threadId);
}
