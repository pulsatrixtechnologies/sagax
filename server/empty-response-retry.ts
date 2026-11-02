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

/** Whether a failed chat turn should get the one harness empty-response retry
 * (not a routine, not already taken by limit failover). */
export function shouldEmptyResponseRetry(input: {
  ok: boolean;
  stopped: boolean;
  limitTaken: boolean;
  alreadyReported?: boolean;
  isRoutine: boolean;
  empty: boolean;
  take: () => boolean;
}): boolean {
  if (input.ok || input.stopped || input.limitTaken || input.alreadyReported || input.isRoutine || !input.empty) {
    return false;
  }
  return input.take();
}
