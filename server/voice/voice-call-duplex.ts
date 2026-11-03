// Pure admit for a voice-call send when full-duplex is on (issue #292).
// Flag off: the caller keeps today's steer-or-queue path. Flag on: a new
// utterance replaces the in-flight turn and never enters the steer queue.

/** The server runs the full-duplex call path (replace, opener) only when
 * SAGAX_VOICE_FULL_DUPLEX=1. Off (the default), a duplex send takes the
 * steer path every call had before 0.5.0. */
export function voiceFullDuplexEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SAGAX_VOICE_FULL_DUPLEX === "1";
}

/** A call mark without the page's duplex and speculative flags. */
export function withoutDuplexMarks<T extends { duplex?: boolean; speculative?: boolean }>(meta: T): T {
  const { duplex: _duplex, speculative: _speculative, ...rest } = meta;
  return rest as T;
}

export type DuplexAdmit =
  | { action: "start" }
  | { action: "steer" }
  | { action: "queue" }
  | { action: "replace"; interrupt: boolean; discardQueue: boolean }
  | { action: "defer" }
  | { action: "stop"; interrupt: boolean; discardQueue: true };

export function admitDuplexSend(input: {
  duplex: boolean;
  botBusy: boolean;
  stopping: boolean;
  queued: boolean;
  backgroundWork?: boolean;
  newTopic?: boolean;
  speculative?: boolean;
  intent?: "stop" | "correction" | "new_topic";
  continues?: boolean;
  /** STT reissue of the utterance already on this thread. Absent: treat as same. */
  sameUtterance?: boolean;
}): DuplexAdmit {
  if (!input.duplex) {
    return input.botBusy || input.stopping || input.queued ? { action: "steer" } : { action: "start" };
  }
  // "stop" cancels the in-flight turn and does not start a new LLM turn.
  // A correction replaces. The person's words never fork a parallel task:
  // that made every follow-up, and the partial and final of one sentence, a
  // parallel-task card. While the call turn runs a tool (`backgroundWork`),
  // new words join that turn (steer), so the work is not killed. While it
  // only thinks, they replace it.
  if (input.intent === "stop" && (input.botBusy || input.stopping)) {
    return { action: "stop", interrupt: true, discardQueue: true };
  }
  // STT reissue of the same utterance (continues) is a correction of the
  // words, not a sibling topic. A continues flag on a different utterance
  // (skipped speculative, or a new topic's final after a fork) must not
  // replace the live turn.
  if (input.continues && (input.botBusy || input.stopping || input.queued)) {
    if (input.sameUtterance === false && input.newTopic && input.backgroundWork && !input.stopping) {
      return { action: "steer" };
    }
    return { action: "replace", interrupt: input.botBusy || input.stopping, discardQueue: true };
  }
  if (input.newTopic && input.backgroundWork && input.botBusy && !input.stopping) {
    return { action: "steer" };
  }
  if (input.botBusy || input.stopping || input.queued) {
    return { action: "replace", interrupt: input.botBusy || input.stopping, discardQueue: true };
  }
  return { action: "start" };
}

/** How long a duplex send waits for the interrupted turn to settle before
 * starting the new one. Idle wait and thread_busy retry share this budget
 * after the abort is acknowledged. */
export const DUPLEX_INTERRUPT_WAIT_MS = 300;

function voiceWords(text: string | undefined): string[] {
  return (text ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]+/g) ?? [];
}

/** Words a line must have before one of them may differ (STT revised it). */
const REVISED_WORD_MIN = 4;

/** True when `next` is the same spoken utterance as `previous`: STT grew it,
 * or its final revised one word of the partial ("will be" then "would be
 * able to"). */
export function continuesSameUtterance(previous: string | undefined, next: string): boolean {
  const before = voiceWords(previous);
  const after = voiceWords(next);
  if (!before.length || !after.length) return false;
  const [shorter, longer] = before.length <= after.length ? [before, after] : [after, before];
  const differ = shorter.filter((word, i) => word !== longer[i]).length;
  return differ === 0 || (differ === 1 && shorter.length >= REVISED_WORD_MIN);
}

/** Last person line that belongs to this thread, not a parallel request card. */
export function lastOwnUserVoiceText(
  messages: Array<{ role?: string; text?: string; parallelTask?: unknown }>,
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!;
    if (message.role === "user" && message.text?.trim() && !message.parallelTask) return message.text;
  }
}

/** Parallel sibling whose last ask is this continues text. */
export function matchingVoiceSibling(
  siblings: Array<{ threadId: string; text: string }>,
  text: string,
): string | undefined {
  return siblings.find((row) => continuesSameUtterance(row.text, text))?.threadId;
}

/** One increasing token per thread: only the latest duplex replace starts. */
export function duplexEpoch(): { claim: () => number; isLatest: (token: number) => boolean } {
  let seq = 0;
  return {
    claim() {
      seq += 1;
      return seq;
    },
    isLatest(token: number) {
      return token === seq;
    },
  };
}

export function isThreadBusyError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "thread_busy";
}

/** POST /interrupt pinned to the cancelled spoken utterance. An unpinned
 * Stop still applies. A pin for a turn that no longer owns the thread is
 * skipped so a newer send is not killed. */
export function pinVoiceInterrupt(input: {
  expectedUtteranceId?: string;
  liveUtteranceId?: string | null;
}): "apply" | "skip" {
  if (!input.expectedUtteranceId || !input.liveUtteranceId) return "apply";
  return input.expectedUtteranceId === input.liveUtteranceId ? "apply" : "skip";
}

/** A cancelled voice turn must not land LLM tokens, the completed answer,
 * or in-flight tool start/result. turn.completed still settles busy. */
export function dropCancelledVoiceEvent(
  stale: boolean,
  event: { type: string; streamKind?: string; itemType?: string },
): boolean {
  if (!stale) return false;
  if (event.type === "content.delta" && event.streamKind === "assistant_text") return true;
  if (event.type === "item.completed" && (event.itemType === "assistant_text" || event.itemType === "tool")) return true;
  if (event.type === "item.started" && event.itemType === "tool") return true;
  return false;
}

export function isStaleAssistantOutput(input: {
  eventTurnId?: string;
  cancelledTurnIds?: Iterable<string>;
  ownerStopped?: boolean;
  ownerTurnId?: string | null;
}): boolean {
  if (input.eventTurnId && input.cancelledTurnIds) {
    for (const id of input.cancelledTurnIds) {
      if (id === input.eventTurnId) return true;
    }
  }
  if (input.ownerStopped && (!input.eventTurnId || !input.ownerTurnId || input.eventTurnId !== input.ownerTurnId)) {
    return true;
  }
  if (input.eventTurnId && input.ownerTurnId && input.eventTurnId !== input.ownerTurnId) return true;
  return false;
}

export async function waitForThreadIdle(
  isBusy: () => boolean,
  opts?: {
    capMs?: number;
    stepMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<"idle" | "timeout"> {
  const capMs = opts?.capMs ?? DUPLEX_INTERRUPT_WAIT_MS;
  const stepMs = opts?.stepMs ?? 40;
  const now = opts?.now ?? Date.now;
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = now() + capMs;
  while (isBusy() && now() < deadline) await sleep(stepMs);
  return isBusy() ? "timeout" : "idle";
}
