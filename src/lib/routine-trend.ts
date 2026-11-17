// The Routines table's trend (2026-11-17, owner): a routine's last 7 runs as a
// row of marks, oldest at the left, newest at the right. One rule here for the
// marks, their order, the empty slots and the sentence that says them in words
// (the colours are never the only way to read a run).
import type { RoutineRun } from "@/lib/routines";
import { routineRunTime } from "@/lib/routine-display";

export const TREND_SLOTS = 7;

/** `blocked` is a blocked or missed run (the muted danger); `waiting` a run
 * that waits on the person. Queued and cancelled runs are no mark at all. */
export type TrendKind = "success" | "problems" | "failed" | "blocked" | "running" | "waiting" | "empty";
export type TrendRunKind = Exclude<TrendKind, "empty">;
export const TREND_RUN_KINDS: readonly TrendRunKind[] = ["success", "problems", "failed", "blocked", "running", "waiting"];

export interface TrendMark { kind: TrendKind; run?: RoutineRun }
export interface RoutineTrend {
  /** Always TREND_SLOTS marks: empty slots first, then the runs oldest to newest. */
  marks: TrendMark[];
  newest: RoutineRun | undefined;
  counts: Partial<Record<TrendRunKind, number>>;
}

/** A run with nothing to report is a success; a completed run with problems is
 * not. Null: not a mark (queued, cancelled). */
export function trendKind(run: Pick<RoutineRun, "status" | "problems">): TrendRunKind | null {
  switch (run.status) {
    case "completed": return run.problems ? "problems" : "success";
    case "nothing_to_report": return "success";
    case "failed": return "failed";
    case "blocked": case "missed": return "blocked";
    case "running": return "running";
    case "waiting": return "waiting";
    default: return null;
  }
}

export function routineTrend(runs: readonly RoutineRun[]): RoutineTrend {
  const kept = runs.filter((run) => trendKind(run) !== null)
    .sort((a, b) => routineRunTime(a) - routineRunTime(b))
    .slice(-TREND_SLOTS);
  const marks: TrendMark[] = [
    ...Array.from({ length: TREND_SLOTS - kept.length }, (): TrendMark => ({ kind: "empty" })),
    ...kept.map((run): TrendMark => ({ kind: trendKind(run)!, run })),
  ];
  const counts: RoutineTrend["counts"] = {};
  for (const mark of marks) if (mark.kind !== "empty") counts[mark.kind] = (counts[mark.kind] ?? 0) + 1;
  return { marks, newest: kept.at(-1), counts };
}
