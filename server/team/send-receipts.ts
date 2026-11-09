// What became of a send_to_bot (#3246). A one-way send used to leave the
// sender nothing to read: asked whether a teammate answered, the bot always
// said no. Now:
// - its chip in the sender's conversation carries a receipt (« Sent to
//   <Bot> », queued / read / waiting / done / failed, a short summary of the
//   reply) the runtime keeps current;
// - send_status reads the same state, for this conversation's sends or one
//   recipient thread of the same person;
// - reply "resume" wakes the sender with a short return line once the
//   recipient's turn settles.
// IO comes through a narrow host so the rules are tested without a server.

import type { WireMessage as Message, TaskOpenedBy } from "../../shared/wire.ts";
import { isSettledSend, sendReturnLine, sendStateOf, sendSummary, type SendReceipt, type SendState } from "../../shared/send-receipt.ts";

/** The runtime's view of one send (HandoffView fields this module reads). */
export interface SendNode {
  id: string;
  botId: string;
  threadId: string;
  status: string;
  result?: string;
  question?: string;
  startedAt?: number;
  executions?: number;
}

export interface SendReceiptsHost {
  messagesFor(threadId: string): readonly Message[];
  patchMessage(threadId: string, messageId: string, patch: Partial<Message>): unknown;
  /** The recipient thread's opener (TaskOpenedBy), when it still exists. */
  openerOf(botId: string, threadId: string): TaskOpenedBy | undefined;
  botName(botId: string): string | undefined;
  /** Wake the sender in its conversation with the return line. */
  resume(input: { senderId: string; senderThreadId: string; replierId: string; replierThreadId: string; text: string }): void;
}

/** The recipient's last words in its thread, for a summary when the
 * runtime kept no result. */
export function lastReplyIn(messages: readonly Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i]!;
    if (m.role === "bot" && m.kind === "text" && m.text?.trim()) return m.text;
  }
  return undefined;
}

/** A send's state from its runtime node, or from its thread when the
 * runtime no longer holds it (a restart, a long-settled send). */
export function sendStateFrom(node: SendNode | undefined, thread: readonly Message[]): SendState {
  if (node) return sendStateOf(node.status, { question: Boolean(node.question), started: node.startedAt !== undefined || (node.executions ?? 0) > 0 });
  return lastReplyIn(thread) ? "done" : "queued";
}

export function createSendReceipts(host: SendReceiptsHost) {
  /** messageId of each receipt by send id, found once. */
  const where = new Map<string, string>();

  function receiptIn(senderThreadId: string, sendId: string): Message | undefined {
    const known = where.get(sendId);
    const messages = host.messagesFor(senderThreadId);
    if (known) {
      const hit = messages.find((m) => m.id === known);
      if (hit?.sendReceipt) return hit;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i]!;
      if (m.sendReceipt?.id === sendId) {
        where.set(sendId, m.id);
        return m;
      }
    }
    return undefined;
  }

  function patch(senderThreadId: string, message: Message, next: Partial<SendReceipt>): SendReceipt {
    const current = message.sendReceipt!;
    const merged: SendReceipt = { ...current, ...next };
    if (JSON.stringify(merged) !== JSON.stringify(current)) host.patchMessage(senderThreadId, message.id, { sendReceipt: merged });
    return merged;
  }

  /** The send's node changed: bring its receipt up to date (state only). */
  function changed(node: SendNode): void {
    const opener = host.openerOf(node.botId, node.threadId);
    if (!opener?.threadId || opener.delegationId !== node.id) return;
    const message = receiptIn(opener.threadId, node.id);
    if (!message?.sendReceipt) return;
    const state = sendStateFrom(node, []);
    // a settled receipt is final: report() wrote it with its summary
    if (isSettledSend(message.sendReceipt.state)) return;
    patch(opener.threadId, message, { state });
  }

  /** The send settled: final state, the reply's summary, and the return
   * line when the sender asked to be resumed (once). */
  function settled(node: SendNode, senderThreadIdHint?: string): void {
    const opener = host.openerOf(node.botId, node.threadId);
    const senderThreadId = opener?.threadId ?? senderThreadIdHint;
    if (!senderThreadId) return;
    const message = receiptIn(senderThreadId, node.id);
    const state: SendState = node.status === "completed" ? "done" : "failed";
    const reply = node.status === "completed"
      ? sendSummary(node.result || lastReplyIn(host.messagesFor(node.threadId)))
      : sendSummary(node.result);
    const receipt = message?.sendReceipt
      ? patch(senderThreadId, message, { state, ...(reply ? { summary: reply } : {}) })
      : undefined;
    const wantsResume = receipt?.resume === true || opener?.reply === "resume";
    if (!wantsResume || receipt?.resumed) return;
    const senderId = receipt?.senderId ?? opener?.botId;
    if (!senderId) return;
    if (message) patch(senderThreadId, message, { resumed: true });
    host.resume({
      senderId,
      senderThreadId,
      replierId: node.botId,
      replierThreadId: node.threadId,
      text: sendReturnLine(host.botName(node.botId) ?? "Your teammate", state, reply, node.threadId),
    });
  }

  return { changed, settled, receiptIn };
}

/** send_status's view of one send: what the sending bot reads. */
export interface SendStatusView {
  id?: string;
  threadId: string;
  botId: string;
  botName: string;
  title?: string;
  state: SendState;
  delivered: true;
  read: boolean;
  summary?: string;
  question?: string;
  reply: "resume" | "none";
  sentAt: number;
}

export function sendStatusView(input: {
  threadId: string;
  botId: string;
  botName: string;
  title?: string;
  opener: TaskOpenedBy;
  node?: SendNode;
  thread: readonly Message[];
}): SendStatusView {
  const state = sendStateFrom(input.node, input.thread);
  const reply = state === "done" ? sendSummary(input.node?.result || lastReplyIn(input.thread))
    : state === "failed" ? sendSummary(input.node?.result) : undefined;
  return {
    ...(input.opener.delegationId ? { id: input.opener.delegationId } : {}),
    threadId: input.threadId,
    botId: input.botId,
    botName: input.botName,
    ...(input.title ? { title: input.title } : {}),
    state,
    delivered: true,
    read: state !== "queued",
    ...(reply ? { summary: reply } : {}),
    ...(state === "waiting" && input.node?.question ? { question: sendSummary(input.node.question) } : {}),
    reply: input.opener.reply === "resume" ? "resume" : "none",
    sentAt: input.opener.at,
  };
}
