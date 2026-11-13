// The waiting item's wire shape (#3512, #3543), apart from the reader that
// builds it (shared/waiting-items.ts): the served approvals list
// (shared/approvals-inbox.ts InboxPayload.waiting) carries these items while
// the reader reads that list's rows, so the shape sits below both and no
// import goes round (#4164). Read it through shared/waiting-items.ts.

/** What waits: a permission card, a question card, a question in words
 * (answered with the person's own words), a proposal or offer card. */
export type WaitingKind = "approval" | "question" | "request" | "proposal";

/** How it is answered: allow or deny, one of its options, or words. */
export type WaitingAnswerWith = "decision" | "option" | "text";

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
