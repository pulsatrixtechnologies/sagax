// A person's message to a busy bot whose engine cannot take words into its
// running turn (ACP engines, any steer that was refused) used to wait in the
// queue until the whole turn ended: minutes, during which the bot did not
// read it (2026-10-28). Now the running turn is interrupted at its next safe
// point, the end of the tool call it is running, and the queue starts a turn
// with the new message right away; the engine's session keeps its context.
//
// Pure bookkeeping, no IO: index.ts says when a tool starts and ends, and
// owns the interrupt. A tool that runs past the ceiling is cut there, so the
// message never waits for minutes.

import { isPersistentQuestionCard } from "../shared/ask-question.ts";

type RequestCard = Parameters<typeof isPersistentQuestionCard>[0] & {
  requestId?: string; approvalOrigin?: unknown; answered?: string; dismissed?: boolean;
};

/** An open request card of this turn that a Stop of the turn settles
 * (closeOpenApprovals): not answered or put away, not another origin's
 * approval, not a durable proposal (routine, skill). */
export function openTurnRequestCard(card: RequestCard | null | undefined): boolean {
  return Boolean(card?.requestId) && !card!.approvalOrigin && !card!.answered && !card!.dismissed
    && !card!.routineRequest && !card!.skillRequest;
}

/** #4475: an open card a Stop of its turn would close unanswered (a
 * permission and the like; a persistent question survives the Stop). While
 * one waits on the person, their words never interrupt the turn at a safe
 * point: the answer to a sibling question card would close it silently.
 * The words wait in the queue for the turn, which goes on once the card is
 * answered. */
export function stopClosesCard(card: RequestCard | null | undefined): boolean {
  return openTurnRequestCard(card) && !isPersistentQuestionCard(card);
}

/** How long a running tool may hold a waiting message before the turn is
 * interrupted anyway. */
export const SAFE_POINT_CEILING_MS = 45_000;

/** Text the queued message is sent with: the model reads why its work
 * stopped, and that it may carry on. */
export const SAFE_POINT_NOTE =
  "[You were paused at a safe step so you could read this new message right away. Take it into account, then carry on with the earlier work if it still applies.]";

interface Pending {
  fire: () => void;
  timer: ReturnType<typeof setTimeout>;
}

export class SafePointPreempts {
  private readonly pending = new Map<string, Pending>();

  private readonly ceilingMs: number;

  constructor(ceilingMs = SAFE_POINT_CEILING_MS) {
    this.ceilingMs = ceilingMs;
  }

  /** A message waits on `threadId`. With no tool running the turn is
   * interrupted now; otherwise at the end of the running tools, or at the
   * ceiling. A second message joins the first request. */
  request(threadId: string, toolsRunning: number, fire: () => void): "now" | "at-safe-point" | "already" {
    if (this.pending.has(threadId)) return "already";
    if (toolsRunning <= 0) {
      fire();
      return "now";
    }
    const timer = setTimeout(() => this.take(threadId)?.(), this.ceilingMs);
    timer.unref?.();
    this.pending.set(threadId, { fire, timer });
    return "at-safe-point";
  }

  /** A tool of `threadId` ended; `stillRunning` are left. */
  toolEnded(threadId: string, stillRunning: number): void {
    if (stillRunning > 0) return;
    this.take(threadId)?.();
  }

  /** The turn settled on its own: nothing left to interrupt. */
  clear(threadId: string): void {
    this.take(threadId);
  }

  waiting(threadId: string): boolean {
    return this.pending.has(threadId);
  }

  private take(threadId: string): (() => void) | undefined {
    const entry = this.pending.get(threadId);
    if (!entry) return undefined;
    clearTimeout(entry.timer);
    this.pending.delete(threadId);
    return entry.fire;
  }
}
