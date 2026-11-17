// The Routines page's Runs figures (2026-11-17): the total, the success rate
// and the succeeded-of-total bar for a chosen period, all read from the runs
// the app already holds (no server figure). One rule, here, so the cards, the
// bar and "View failed runs" cannot drift apart.
import { isRoutineProblemRun, type RoutineRun } from "@/lib/routines";
import { routineRunTime } from "@/lib/routine-display";

export type RunsPeriod = "day" | "week" | "month";
export const RUNS_PERIODS: readonly RunsPeriod[] = ["day", "week", "month"];
export const RUNS_PERIOD_MS: Record<RunsPeriod, number> = { day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000 };

/** A run that reached an outcome. Queued, running, waiting and cancelled runs
 * are not one: a cancelled run is the person's choice, never a failure. */
const SETTLED = new Set<RoutineRun["status"]>(["completed", "failed", "blocked", "missed", "nothing_to_report"]);

export function runsInPeriod(runs: readonly RoutineRun[], period: RunsPeriod, now = Date.now()): RoutineRun[] {
  const from = now - RUNS_PERIOD_MS[period];
  return runs.filter((run) => routineRunTime(run) >= from && routineRunTime(run) <= now);
}

export interface RunFigures {
  total: number;
  succeeded: number;
  failed: number;
  /** 0 to 100, whole; null when nothing ran (a dash, never 0%). */
  rate: number | null;
}

/** A run with nothing to do (`nothing_to_report`, or a completed run marked
 * `quiet`) is a success. A completed run with problems is not. */
export function runFigures(runs: readonly RoutineRun[]): RunFigures {
  const settled = runs.filter((run) => SETTLED.has(run.status));
  const failed = settled.filter((run) => isRoutineProblemRun(run)).length;
  const succeeded = settled.length - failed;
  return { total: settled.length, succeeded, failed, rate: settled.length === 0 ? null : Math.round((succeeded / settled.length) * 100) };
}
