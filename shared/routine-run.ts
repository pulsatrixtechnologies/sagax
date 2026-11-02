/** Durable, non-actionable projection of one background routine run.
 *
 * The provider still runs in its isolated execution task. This small card is
 * upserted into the trusted conversation that created the routine so the user
 * can see progress, results, and where to review an approval without hunting
 * through the routines calendar.
 */
export interface RoutineRunCardData {
  runId: string;
  routineId: string;
  routineName: string;
  scheduledFor?: number;
  status: "queued" | "running" | "waiting" | "completed" | "failed" | "blocked" | "cancelled" | "missed" | "nothing_to_report";
  /** Present while a queued run is being held because its target bot or room
   * is busy. The status stays queued; this is the surfaced deferral fact. */
  deferredAt?: number;
  /** Exact terminal team-goal outcome when this run targeted a room. */
  goalStatus?: "completed" | "needs-input" | "blocked" | "limit-reached" | "paused" | "stopped" | "failed";
  executionThreadId?: string;
  summary?: string;
  error?: string;
  /** 2026-10-26: this failure paused the routine after this many failed
   * runs in a row (shared/routine-auto-pause.ts); the notice offers Resume. */
  autoPausedAfter?: number;
  /** 2026-11-01: completed, but not all of it went right (RoutineRun.problems). */
  problems?: string;
  /** 2026-11-01: why a queued or waiting run has not gone on yet. */
  attention?: string;
}
