// #4878: a failed turn the usage-limit failover took over
// (server/usage/limit-failover-host.ts turnFailed). The same work goes on in
// the same thread on the next engine of the chain, or waits there for the
// engine's reset. A caller waiting on that thread for a result (a
// run_with_engine part such as a routine's verification step, a headless
// task) reads it here, so the refused turn is never taken for the work's
// failure while another engine still does it.

/** How long a waiting caller gives the failover to start the turn on the
 * next engine. Past it nothing took the work on (every engine refused, or
 * it waits for a reset): the caller ends with the refusal. */
export const LIMIT_TAKEOVER_GRACE_MS = 30_000;

const MAX_KEPT = 500;

export interface LimitTakeovers {
  /** The failover took over the failed turn `turnId` of `threadId`. */
  note(threadId: string, turnId: string | undefined): void;
  /** Whether it did, consumed once. */
  take(threadId: string, turnId: string | undefined): boolean;
}

export function createLimitTakeovers(): LimitTakeovers {
  const taken = new Map<string, string>();
  return {
    note(threadId, turnId) {
      taken.delete(threadId);
      taken.set(threadId, turnId ?? "");
      if (taken.size > MAX_KEPT) taken.delete(taken.keys().next().value!);
    },
    take(threadId, turnId) {
      const noted = taken.get(threadId);
      if (noted === undefined || (noted && turnId && noted !== turnId)) return false;
      taken.delete(threadId);
      return true;
    },
  };
}
