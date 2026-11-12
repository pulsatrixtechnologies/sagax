import type { RoutineReadinessCheck } from "./routine-readiness.ts";
/** Durable, non-actionable projection of one background routine run.
 *
 * The provider still runs in its isolated execution task. This small card is
 * upserted into the trusted conversation that created the routine so the user
 * can see progress, results, and where to review an approval without hunting
 * through the routines calendar.
 */
export interface RoutineRunCardData {
  readiness?: RoutineReadinessCheck[];
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
  /** The whole report (up to ROUTINE_REPORT_POST_MAX): what "Details" opens
   * and what the released apps still draw as a bubble. */
  summary?: string;
  /** #3581: the one or two lines the card shows, from the report's closing
   * line (reportBrief in shared/routine-result.ts). Absent on cards stored
   * before it: the apps read the same function from `summary`. */
  brief?: string;
  error?: string;
  /** 2026-10-26: this failure paused the routine after this many failed
   * runs in a row (shared/routine-auto-pause.ts); the notice offers Resume. */
  autoPausedAfter?: number;
  /** 2026-11-01: completed, but not all of it went right (RoutineRun.problems). */
  problems?: string;
  /** #3479: the same problem came back in later runs: how many runs in a
   * row had it (this row's run included), since when, and when last. */
  repeat?: {
    firstRunId: string; count: number; since: number; lastAt: number;
    /** #3695: the one summary card of a routine that repeats more than once
     * a day: `count` runs in a row ended with problems, whatever they said. */
    streak?: true;
    /** #3910: `count` runs in a row ended with problems, whatever they said
     * (a routine that repeats more than once a day), on any of its cards: a
     * run the person started reads the streak's words too. */
    anyProblem?: true;
  };
  /** #3479: the first run without problems after `afterRuns` runs with them.
   * #3990: `streak` on the streak's own summary card, turned to works again
   * in place. */
  recovered?: { afterRuns: number; since: number; streak?: true };
  /** #3990: a person started this run (Run now): its card is theirs. */
  startedBy?: "person";
  /** 2026-11-01: why a queued or waiting run has not gone on yet. */
  attention?: string;
  /** 2026-11-03: the teammates the run handed work to, linked from the card. */
  handedTo?: Array<{ botId: string; threadId: string; name?: string; status: string; task?: string; startedAt?: number; finishedAt?: number; note?: string }>;
  /** 2026-11-04: when the run started, so a running card shows how long it
   * has been going. */
  startedAt?: number;
  /** #2694: a proactive wake's kind ("heartbeat", "mail", "calendar", ...),
   * so the person can say less of it, or never, from the chat. */
  wakeTopic?: string;
  /** #3423: the Pulsatrix watches a watch wake reported, with their domain:
   * the row's "never" stops these watches for good (the person's choice). */
  watches?: Array<{ id: string; domain: string }>;
  /** #2694: the person's feedback on that wake, kept across card updates. */
  feedback?: "up" | "down" | "less" | "never";
}
