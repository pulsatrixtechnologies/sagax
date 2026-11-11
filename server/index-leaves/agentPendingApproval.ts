// @ts-nocheck
/**
 * agentPendingApproval (#2922). The cards a conversation's CURRENT turn waits
 * on, in that thread AND in the threads it handed work to (a teammate's
 * permission card two levels down still blocks the turn the external caller
 * awaits).
 *
 * - open: live option cards (requestId, not answered, dismissed, expired nor
 *   settled by a reviewer), newest first, each with the thread that holds it
 *   (the one to answer on).
 * - reviewing: cards a model reviewer is still deciding (card.reviewing):
 *   not for the person yet, but the turn is not finished either.
 *
 * Turn scope: a card created before `since` (the awaited handle's time, else
 * the thread's last prompt) belongs to an earlier turn and is left out. The
 * persistent cards closeOpenApprovals keeps after a turn ends (ask_choice
 * questions, routine and skill proposals) would otherwise read as this turn
 * waiting. In a handed-off thread such a card counts only while that thread
 * still runs.
 *
 * A teammate card mirrored into the root thread (origin-approvals, #2901)
 * is listed once, as the mirror (requestId origin:<msgId>), never twice.
 * Confidential threads are skipped. The walk is bounded (depth 3, visited set)
 * so a handoff cycle cannot loop.
 */
import { describeMemberApproval } from "../org/org-member-routes.ts";
import { safetyHoldOpen } from "../safety/safety-review.ts";

export type Host = Record<string, any>;

export interface PendingApprovalRow {
  threadId: string;
  message: any;
  card: any;
  depth: number;
}

export interface PendingApprovalOptions {
  /** Cards created before this epoch ms belong to an earlier turn. Default: the root's last prompt. */
  since?: number;
  /** A root card being settled right now (request.resolved runs before its patch). */
  except?: string;
  /** The root thread only, no handoff walk. */
  rootOnly?: boolean;
  /** QA 0.8.67 G5: the awaited prompt's message id. A root card that sits
   * before it in the thread belongs to an earlier turn, whatever its time. */
  anchorId?: string;
}

/** QA 0.8.67 G5: a held card (confirmHeldCard, ownerRule from "hold") or its
 * mirror whose hold is no longer open: the turn that raised it ended, timed
 * out or the server restarted; nothing waits on its answer. */
export function deadHoldCard(card: any, holdOpen: (requestId: string) => boolean = safetyHoldOpen): boolean {
  if (card?.ownerRule?.from !== "hold") return false;
  const requestId = card.approvalOrigin?.requestId ?? card.requestId;
  return typeof requestId === "string" && !holdOpen(requestId);
}

const MAX_DEPTH = 3;

const isPrompt = (message: any) => message?.role === "user" && (message.kind ?? "text") === "text";

/** The person's lines that answer a card of their own turn (the card sits
 * after the turn's prompt): part of the turn the card unblocked. A quote-reply
 * to an older card is a new prompt. */
export function cardAnswerIds(messages: readonly any[]): Set<string> {
  const answers = new Set<string>();
  const cardAt = new Map<string, number>();
  let lastPrompt = -1;
  messages.forEach((message, index) => {
    if (message?.kind === "options" && message.id) cardAt.set(message.id, index);
    if (!isPrompt(message)) return;
    const card = message.replyToId ? cardAt.get(message.replyToId) : undefined;
    if (card !== undefined && card > lastPrompt) answers.add(message.id);
    else lastPrompt = index;
  });
  return answers;
}

/** When the thread's current turn began: its last prompt (a card answer is
 * not one). 0 when the thread has none. */
export function turnStartAt(messages: readonly any[]): number {
  const answers = cardAnswerIds(messages);
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isPrompt(message) && !answers.has(message.id)) return typeof message.at === "number" ? message.at : 0;
  }
  return 0;
}

const atOf = (row: PendingApprovalRow) => (typeof row.message?.at === "number" ? row.message.at : Number(row.message?.at) || 0);

export function createAgentPendingApproval(getHost: () => Host): any {
  function threadLive(host: Host, botId: string, threadId: string): boolean {
    try {
      if (host.threadBusy?.(botId, threadId)) return true;
    } catch {
      // no engine view: fall back on the activity
    }
    const activity = host.store.taskByThread?.(botId, threadId)?.activity;
    return activity === "working" || activity === "waiting-on-you";
  }

  function childThreads(host: Host, agentId: string, botId: string, threadId: string, depth: number, since: number): Array<{ threadId: string; botId: string }> {
    const out: Array<{ threadId: string; botId: string }> = [];
    try {
      for (const node of host.coordinator?.outstandingFor?.(threadId) ?? []) {
        if (node?.threadId) out.push({ threadId: node.threadId, botId: node.botId ?? botId });
      }
      // a fire-and-forget handoff (reply none) or one already closed while
      // its card stays open: the children this turn started
      for (const node of host.coordinator?.directChildrenOf?.(botId, threadId) ?? []) {
        if (node?.threadId && (node.createdAt ?? 0) >= since) out.push({ threadId: node.threadId, botId: node.botId ?? botId });
      }
    } catch {
      // coordinator not ready: no children
    }
    if (depth === 0) {
      for (const task of host.store.tasks?.(agentId) ?? []) {
        if (task?.parallelOf?.threadId === threadId && task.threadId) out.push({ threadId: task.threadId, botId: agentId });
      }
    }
    return out;
  }

  function agentPendingApproval(agentId: string, rootThreadId: string, opts: PendingApprovalOptions = {}): { open: PendingApprovalRow[]; reviewing: PendingApprovalRow[] } {
    const host = getHost();
    const since = typeof opts.since === "number" ? opts.since : turnStartAt(host.store.messagesFor(rootThreadId) ?? []);
    const open: PendingApprovalRow[] = [];
    const reviewing: PendingApprovalRow[] = [];
    const mirrored = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ threadId: string; botId: string; depth: number }> = [{ threadId: rootThreadId, botId: agentId, depth: 0 }];
    while (queue.length) {
      const { threadId, botId, depth } = queue.shift()!;
      if (!threadId || visited.has(threadId)) continue;
      visited.add(threadId);
      if (depth > 0 && host.store.isConfidentialThread?.(threadId)) continue;
      let live: boolean | null = null;
      const messages = host.store.messagesFor(threadId) ?? [];
      // The awaited prompt's place in the root thread: what comes before it is
      // an earlier turn's (when the prompt is not in the thread yet, the time
      // alone decides).
      const anchorAt = depth === 0 && opts.anchorId ? messages.findIndex((message: any) => message?.id === opts.anchorId) : -1;
      for (const [index, message] of messages.entries()) {
        const card = message?.kind === "options" ? message.card : undefined;
        if (!card?.requestId || card.answered || card.dismissed || card.expired || card.answeredBy) continue;
        if (depth === 0 && opts.except && card.requestId === opts.except) continue;
        if (typeof message.at === "number" && message.at < since) continue;
        if (index < anchorAt) continue;
        if (deadHoldCard(card, host.safetyHoldOpen ?? safetyHoldOpen)) continue;
        if (depth > 0 && (card.routineRequest || card.skillRequest || host.isPersistentQuestionCard?.(card))) {
          // a card that outlives its turn: only while that thread still runs
          if (live === null) live = threadLive(host, botId, threadId);
          if (!live) continue;
        }
        const origin = card.approvalOrigin;
        if (origin?.threadId && origin?.requestId) mirrored.add(`${origin.threadId}:${origin.requestId}`);
        (card.reviewing ? reviewing : open).push({ threadId, message, card, depth });
      }
      if (!opts.rootOnly && depth < MAX_DEPTH) {
        for (const child of childThreads(host, agentId, botId, threadId, depth, since)) {
          if (!visited.has(child.threadId)) queue.push({ ...child, depth: depth + 1 });
        }
      }
    }
    const notMirrored = (row: PendingApprovalRow) => !mirrored.has(`${row.threadId}:${row.card.requestId}`);
    const newestFirst = (a: PendingApprovalRow, b: PendingApprovalRow) => atOf(b) - atOf(a);
    return { open: open.filter(notMirrored).sort(newestFirst), reviewing: reviewing.filter(notMirrored).sort(newestFirst) };
  }
  return agentPendingApproval;
}

/** What an awaited turn waits on, as this caller may see it (#2922).
 * - approvals: the turn's open cards this caller answers, newest first.
 *   The conversation's own cards are the caller's; a card down the handoff
 *   only for the person who answers it and may post in that thread
 *   (isolation between persons), never for a bot caller.
 * - blockedElsewhere: an open card of this turn the caller does not answer:
 *   the turn waits on someone else, it is still running for this caller.
 * - engineBusy: the conversation still runs (engine, queue, teammates). */
export function createAgentPendingForCaller(getHost: () => Host): any {
  return function agentPendingForCaller(caller: { kind: string; id: string }, agentId: string, threadId: string, since?: number, anchorId?: string) {
    const host = getHost();
    const { open, reviewing } = host.agentPendingApproval(agentId, threadId, {
      ...(typeof since === "number" ? { since } : {}),
      ...(typeof anchorId === "string" && anchorId ? { anchorId } : {}),
    });
    const callerId = String(caller?.id ?? "").trim().toLowerCase();
    const mine = (row: PendingApprovalRow) => {
      if (row.threadId === threadId) return true;
      if (caller?.kind !== "person" || !callerId) return false;
      const bot = host.botForApproval(row.threadId, row.message);
      if (!bot || host.cardAnswererId(bot, row.threadId, row.card) !== callerId) return false;
      return host.botThreadReadable ? Boolean(host.botThreadReadable(bot, row.threadId, callerId, "thread.post")) : true;
    };
    const own = open.filter(mine);
    let engineBusy = false;
    try {
      engineBusy = Boolean(host.threadBusy?.(agentId, threadId))
        || (host.queuedThreadPosition?.(agentId, threadId) ?? null) !== null
        || Boolean(host.coordinator?.activeDirect?.(threadId))
        || (host.coordinator?.outstandingFor?.(threadId) ?? []).length > 0;
    } catch {
      engineBusy = false;
    }
    // #3515: a card stamped with the old English question title reads in the caller's language
    const person = caller?.kind === "person" ? caller.id : (caller as { speakerPrincipalId?: string })?.speakerPrincipalId;
    const translate = host.serverApprovalWords?.(host.languageOfPerson?.(person ?? null))?.t;
    return {
      approvals: own.map((row) => describeMemberApproval(row.threadId, row.message, row.card, undefined, translate)),
      reviewing: reviewing.some(mine),
      blockedElsewhere: own.length < open.length,
      engineBusy,
    };
  };
}
