import type { RoutineRun } from "./routines.ts";

/** How long a routine may be held up before it acts: a deferred run tells the owner, a waiting run gives way. */
export const ROUTINE_DEFERRAL_NOTICE_MS = 30 * 60_000;

/** What a routine says when its waiting run gives way to the next occurrence, or when an occurrence is skipped behind a wait. */
export const ROUTINE_SUPERSEDED = "Stopped waiting: the next scheduled run of this routine started instead";
export const ROUTINE_SKIPPED_WHILE_WAITING = "Skipped because the previous run of this routine is still waiting";
/** 2026-11-01: a new run (Run now, run_routine, a queued occurrence) held
 * behind a wait nobody answered within the notice window takes its place,
 * as a scheduled occurrence already did: it never waits forever. */
export const ROUTINE_SUPERSEDED_BY_NEW_RUN = "Stopped waiting: a new run of this routine started instead";
/** 2026-11-01: a running run whose turn is gone (nothing works on its
 * thread and no event came for this long) ends, saying so, instead of
 * holding its routine and its bot's queue forever. */
export const ROUTINE_TURN_LOST_MS = 30 * 60_000;
export const ROUTINE_TURN_LOST = "The run's turn ended without a result: nothing has worked on it for 30 minutes";

/** Waiting since a notice window before its routine's next occurrence came due, with no hand-off still open: that occurrence starts instead. */
export function supersededBy(dueAt: number, run: Pick<RoutineRun, "status" | "waitingSince" | "threadId">, handedOffWorkLive?: (threadId: string) => boolean): boolean {
  return run.status === "waiting" && run.waitingSince !== undefined && run.waitingSince <= dueAt - ROUTINE_DEFERRAL_NOTICE_MS &&
    !(run.threadId && handedOffWorkLive?.(run.threadId));
}

/** Once per wait: the first occurrence skipped after the waiting run blocking it passed the notice window. */
export function skipNeedsNotice(dueAt: number, waitingSince: number, previousSkipAt: number | undefined): boolean {
  const staleAt = waitingSince + ROUTINE_DEFERRAL_NOTICE_MS;
  return dueAt >= staleAt && (previousSkipAt === undefined || previousSkipAt < staleAt);
}
