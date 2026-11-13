// #3514: a card the bot posts with ask_choice (or choose_page_target) waits
// on the person, and no engine holds that tool call open: on every engine it
// returns at once and tells the model to end its turn. An engine that does
// not end it (Grok went on for six minutes, then said the card waits) kept
// the answer queued behind that turn: the person's answer, skip or expiry
// reached the bot only after the turn's own end.
//
// Now:
//  - on an engine that cannot take words into its running turn (ACP engines:
//    Grok and the others), the turn ends at the end of the call that posted
//    the card, the safe point (server/safe-point-preempt.ts): the bot says
//    nothing more than what it already said, and the answer starts the next
//    turn at once with the choice as its input;
//  - on every engine, an answer, a skip, a close or an expiry of the card
//    that arrives while the turn that posted it still runs ends that turn
//    at its safe point, so the answer's own turn starts at once instead of
//    waiting behind it.
// An engine that takes words live (Claude, Codex) ends its turn on its own
// when the tool says so: nothing changes for it at post time. A routine run
// and a room keep their own flow (the run waits on its card; a room's
// speakers answer there), as for any message sent while they work.

/** What the tools that post a waiting card are called. */
export const WAITING_CARD_TOOLS: ReadonlySet<string> = new Set(["ask_choice", "choose_page_target"]);

/** What a card route answered (server/widgets/chat-card-types.ts AgentCardResult). */
export interface PostedCardResult {
  ok: boolean;
  messageId?: string;
  answered?: unknown;
  auto?: unknown;
  /** #4205: false for an ask_choice raised with wait false. */
  holds?: false;
}

/** Whether `result` is a card now waiting on the person: drawn, not settled
 * by Full access, not a publish target resolved without a card. #4205: a
 * card raised with wait false holds no turn, so the turn is never cut after
 * it and goes on to ask its next item (several cards in one turn). */
export function postedCardWaits(tool: unknown, result: PostedCardResult): boolean {
  if (typeof tool !== "string" || !WAITING_CARD_TOOLS.has(tool)) return false;
  return result.ok === true && typeof result.messageId === "string" && result.messageId.length > 0
    && !result.answered && !result.auto && result.holds !== false;
}

/** The turn that posted each thread's waiting cards. A thread runs one turn
 * at a time, so only the latest turn's cards are kept. */
export class PostedCardTurns {
  private readonly byThread = new Map<string, { turnId: string; cards: Set<string> }>();

  /** `turnId` posted the card row `messageId` in `threadId`. */
  posted(threadId: string, turnId: string, messageId: string): void {
    const entry = this.byThread.get(threadId);
    if (entry && entry.turnId === turnId) {
      entry.cards.add(messageId);
      return;
    }
    this.byThread.set(threadId, { turnId, cards: new Set([messageId]) });
  }

  /** The turn that posted card `messageId` of `threadId`, once: the card is
   * settled, so it is forgotten. Undefined when no running turn posted it. */
  settle(threadId: string, messageId: string): string | undefined {
    const entry = this.byThread.get(threadId);
    if (!entry || !entry.cards.delete(messageId)) return undefined;
    if (!entry.cards.size) this.byThread.delete(threadId);
    return entry.turnId;
  }

  /** The turn of `threadId` ended: its cards no longer have a turn. */
  turnEnded(threadId: string, turnId?: string): void {
    const entry = this.byThread.get(threadId);
    if (entry && (turnId === undefined || entry.turnId === turnId)) this.byThread.delete(threadId);
  }

  size(): number {
    return this.byThread.size;
  }
}

export interface CardTurnHandoffDeps {
  /** The direct turn running in `threadId` now, if any. */
  liveTurn(threadId: string): string | undefined;
  /** A routine run's or a room's turn: they keep their own flow. */
  ownFlow(botId: string, threadId: string): boolean;
  /** The running turn's engine takes words into it live. */
  engineCanSteer(botId: string, threadId: string): boolean;
  toolsRunning(threadId: string): number;
  safePoints: { request(threadId: string, toolsRunning: number, fire: () => void): "now" | "at-safe-point" | "already" };
  /** End the running turn of `threadId` quietly (a safe-point cut, not a Stop). */
  cut(botId: string, threadId: string): void;
  turns: PostedCardTurns;
}

/** End `turnId` at its next safe point, if it is still the running turn. */
function cutAtSafePoint(deps: CardTurnHandoffDeps, botId: string, threadId: string, turnId: string): void {
  deps.safePoints.request(threadId, deps.toolsRunning(threadId), () => {
    if (deps.liveTurn(threadId) !== turnId) return;
    deps.cut(botId, threadId);
  });
}

/** A waiting card was just posted by `threadId`'s running turn. Remember
 * that turn, and end it at the end of the posting call when its engine
 * cannot take the answer live. "cut" when the end was requested. */
export function cardPosted(deps: CardTurnHandoffDeps, botId: string, threadId: string, messageId: string): "cut" | "kept" | "no-turn" {
  const turnId = deps.liveTurn(threadId);
  if (!turnId || deps.ownFlow(botId, threadId)) return "no-turn";
  deps.turns.posted(threadId, turnId, messageId);
  if (deps.engineCanSteer(botId, threadId)) return "kept";
  cutAtSafePoint(deps, botId, threadId, turnId);
  return "cut";
}

/** Card `messageId` was answered, skipped, closed or expired. When the turn
 * that posted it still runs, it ends at its safe point, so the bot hears
 * the outcome at once instead of after that turn. "cut" when requested. */
export function cardSettled(deps: CardTurnHandoffDeps, botId: string, threadId: string, messageId: string): "cut" | "none" {
  const turnId = deps.turns.settle(threadId, messageId);
  if (!turnId || deps.liveTurn(threadId) !== turnId || deps.ownFlow(botId, threadId)) return "none";
  cutAtSafePoint(deps, botId, threadId, turnId);
  return "cut";
}
