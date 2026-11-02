// Successive attempts on one assignment (DEL-02, thinned L7): each launch
// of a blocked or failed job ends the open attempt and starts a new one in
// the same assignment (same destination / session). Undelivered inbox rows
// (`delivered_at IS NULL`) stay for the next attempt; already delivered ones
// are never reset. Pure helpers plus the attempt record shape the store
// persists.
export type AttemptOutcome =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "superseded";

export interface Attempt {
  id: string;
  assignmentId: string;
  /** 1-based successive number on this assignment. */
  number: number;
  startedAt: number;
  finishedAt?: number;
  outcome: AttemptOutcome;
}

/** Next attempt number given the attempts already stored for a job. */
export function nextAttemptNumber(existing: readonly Pick<Attempt, "number">[]): number {
  let max = 0;
  for (const a of existing) if (a.number > max) max = a.number;
  return max + 1;
}

/** The open (running) attempt, if any. */
export function openAttempt(existing: readonly Attempt[]): Attempt | undefined {
  for (let i = existing.length - 1; i >= 0; i--) {
    const a = existing[i]!;
    if (a.outcome === "running") return a;
  }
  return undefined;
}

/**
 * A job that already reported stays finished unless an undelivered inbox
 * entry arrived after that report (DEL-03 startup rule).
 */
export function shouldResumeAfterReport(
  reportedAt: number | undefined,
  undelivered: readonly { createdAt: number }[],
): boolean {
  if (reportedAt === undefined) return false;
  return undelivered.some(item => item.createdAt > reportedAt);
}

/** Map a terminal assignment outcome onto the attempt that produced it. */
export function attemptOutcomeFor(
  status: "completed" | "failed" | "cancelled" | "expired",
  outcome?: string,
): Exclude<AttemptOutcome, "running" | "superseded"> {
  if (status === "completed") return "completed";
  if (outcome === "interrupted") return "interrupted";
  return "failed";
}

/**
 * Admission order at startup and on each tick: priority-now first, then
 * oldest createdAt (stable for equal keys).
 */
export function byOldestFirst<T extends { createdAt: number; priority?: "now" }>(a: T, b: T): number {
  const now = Number(b.priority === "now") - Number(a.priority === "now");
  if (now !== 0) return now;
  return a.createdAt - b.createdAt;
}
