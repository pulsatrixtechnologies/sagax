// The server's side of a realtime call's `work` function
// (server/voice/realtime-call.ts): the request becomes an ordinary turn on the
// bot's thread, and the turn's answer, a card it opened, or its failure
// comes back. Pure over its deps, so it is tested without a server.
import { liveCardKind, spokenApprovalPrompt, spokenQuestionPrompt } from "../../shared/live-approval.ts";
import type { RealtimeWorkResult } from "./realtime-call.ts";
import type { Message, StoreChange } from "../store.ts";

export interface RealtimeWorkDeps {
  onChange(listener: (change: StoreChange) => void): () => void;
  threadId: string;
  /** Sends the request as the person's words on the call; the user
   * message's id, or null when it waits in the thread's queue. */
  send(text: string): Promise<{ messageId: string } | { queued: true }>;
  /** Answers a question card with the person's words. */
  answer(requestId: string, text: string): Promise<boolean>;
  /** The bot's turn on the thread is still running. */
  busy(): boolean;
  timeoutMs: number;
  /** after the bot went idle with no answer (default IDLE_GRACE_MS) */
  idleGraceMs?: number;
  now?(): number;
}

/** How long after the bot went idle with no answer the work is a failure:
 * the answer row lands a moment after the turn settles. */
const IDLE_GRACE_MS = 2_500;

export function realtimeWork(deps: RealtimeWorkDeps) {
  /** a question the bot asked on this call: the person's next request answers it */
  let question: string | null = null;

  const wait = (since: number, messageId: string | null, signal: AbortSignal): Promise<RealtimeWorkResult> => new Promise((resolve) => {
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: RealtimeWorkResult) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      clearTimeout(timeout);
      if (idleTimer) clearTimeout(idleTimer);
      signal.removeEventListener("abort", aborted);
      resolve(result);
    };
    // the call's thread: what the bot writes after the request is its answer
    // (a reply that names another request is not ours)
    const ours = (message: Message) => message.at >= since && !(messageId && message.requestMessageId && message.requestMessageId !== messageId && message.kind === "text");
    const onMessage = (message: Message) => {
      if (message.role === "user" || !ours(message)) return;
      if (message.kind === "options") {
        const kind = liveCardKind(message.card);
        if (!kind || !message.card?.requestId) return;
        const requestId = message.card.requestId;
        if (kind === "question") {
          question = requestId;
          finish({ kind: "answer", text: spokenQuestionPrompt(message.card) });
          return;
        }
        if (kind === "review") {
          finish({ kind: "answer", text: "I need your decision on screen, in the chat." });
          return;
        }
        const at = message.at;
        finish({ kind: "card", card: { requestId, prompt: spokenApprovalPrompt(message.card) }, next: () => wait(at, messageId, signal) });
        return;
      }
      if (message.kind === "text" && message.turnTerminal && message.text?.trim()) finish({ kind: "answer", text: message.text.trim() });
    };
    const unsubscribe = deps.onChange((change) => {
      if ((change.type === "message" || change.type === "message.patch") && change.threadId === deps.threadId) {
        // listeners run inside the store's write: read after it
        const message = change.message;
        queueMicrotask(() => onMessage(message));
      } else if (change.type === "bot") {
        queueMicrotask(() => {
          if (settled || deps.busy()) return;
          idleTimer ??= setTimeout(() => finish({ kind: "failed", reason: "no answer" }), deps.idleGraceMs ?? IDLE_GRACE_MS);
        });
      } else if (change.type === "thread.deleted" && change.threadId === deps.threadId) {
        finish({ kind: "failed", reason: "deleted" });
      }
    });
    const timeout = setTimeout(() => finish({ kind: "timeout" }), deps.timeoutMs);
    timeout.unref?.();
    const aborted = () => finish({ kind: "failed", reason: "hung up" });
    signal.addEventListener("abort", aborted, { once: true });
  });

  return async (request: string, signal: AbortSignal): Promise<RealtimeWorkResult> => {
    const since = deps.now?.() ?? Date.now();
    if (question) {
      const requestId = question;
      question = null;
      const ok = await deps.answer(requestId, request);
      if (ok) return wait(since, null, signal);
    }
    const sent = await deps.send(request);
    return wait(since, "messageId" in sent ? sent.messageId : null, signal);
  };
}
