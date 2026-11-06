import type { RoutineRun } from "@/lib/routines";
import { trimRoutineRuns } from "./store/model";

/** The app starts with the runs of the last two weeks (the server adds older ones each automation's status needs); a
 * view that shows older dates loads them. */
export const ROUTINE_RUNS_WINDOW_MS = 14 * 24 * 60 * 60_000;

/** Runs a view loaded on top of those the app holds; what it holds is newer, so it wins. */
export function withOlderRoutineRuns(current: readonly RoutineRun[], loaded: readonly RoutineRun[]): RoutineRun[] {
  const held = new Set(current.map((run) => run.id));
  return trimRoutineRuns([...current, ...loaded.filter((run) => !held.has(run.id))]);
}

/** Where the loaded runs now begin: lower only when the loaded range reaches the window the app holds. */
export function olderRunsSince(since: number | null, loaded: { from?: number; to?: number }): number | null {
  if (since === null || loaded.from === undefined || loaded.to === undefined || loaded.to < since) return since;
  return Math.min(since, loaded.from);
}
