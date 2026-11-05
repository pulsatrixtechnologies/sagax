// One automatic retry of the same chat turn after an empty model response
// (reasoning_only / no final answer). Tracks thread ids already retried so a
// second empty does not loop into incidents.

export interface EmptyResponseRetry {
  /** True once per thread: the caller should resend the same user message. */
  take(threadId: string): boolean;
  /** Clear after a successful turn so a later empty can retry once again. */
  clear(threadId: string): void;
  /** Whether this thread already used its one empty-response retry. */
  has(threadId: string): boolean;
}

const MAX_TRACKED = 2_000;

/** Pure helper: no I/O. Wire resend + incident skip in the harness. */
export function createEmptyResponseRetry(): EmptyResponseRetry {
  const retried = new Set<string>();
  return {
    take(threadId) {
      if (!threadId || retried.has(threadId)) return false;
      retried.add(threadId);
      if (retried.size > MAX_TRACKED) retried.delete(retried.keys().next().value!);
      return true;
    },
    clear(threadId) {
      retried.delete(threadId);
    },
    has(threadId) {
      return retried.has(threadId);
    },
  };
}

/** The words an engine driver uses when it already asked the model once more
 * inside the failed turn (drivers/acp/helpers.ts reasoningOnlySoftMessage).
 * Resending the whole message on top of that would repeat the same wait
 * (prod 2026-11-02: two rounds of Grok's own 15 retries, 12 minutes) and
 * could redo steps the turn already ran. */
export const ENGINE_RETRIED_IN_TURN = /\beven after Sagax asked it once more\b/i;

/** Whether a failed chat turn should get the one harness empty-response retry
 * (not a routine, not already taken by limit failover, not already retried
 * by the driver inside the turn). */
export function shouldEmptyResponseRetry(input: {
  ok: boolean;
  stopped: boolean;
  limitTaken: boolean;
  alreadyReported?: boolean;
  isRoutine: boolean;
  empty: boolean;
  /** The failure's words, when the caller has them. */
  detail?: string | null;
  take: () => boolean;
}): boolean {
  if (input.ok || input.stopped || input.limitTaken || input.alreadyReported || input.isRoutine || !input.empty) {
    return false;
  }
  if (input.detail && ENGINE_RETRIED_IN_TURN.test(input.detail)) return false;
  return input.take();
}
