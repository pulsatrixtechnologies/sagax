import { describe, expect, it } from "vitest";
import type { RoutineRun } from "@/lib/routines";
import { runFigures, runsInPeriod } from "./routine-figures";

const NOW = Date.UTC(2026, 10, 17, 12);
const H = 3_600_000;
const run = (id: string, status: RoutineRun["status"], hoursAgo: number, extra: Partial<RoutineRun> = {}) =>
  ({ id, routineId: "r", routineName: "Digest", botId: "b", target: "bot", runOn: "maus", manual: false, scheduledFor: NOW - hoursAgo * H, createdAt: NOW - hoursAgo * H, status, ...extra }) as RoutineRun;

describe("runsInPeriod", () => {
  it("keeps the runs of the period only", () => {
    const runs = [run("a", "completed", 2), run("b", "completed", 30), run("c", "completed", 24 * 8)];
    expect(runsInPeriod(runs, "day", NOW).map((r) => r.id)).toEqual(["a"]);
    expect(runsInPeriod(runs, "week", NOW).map((r) => r.id)).toEqual(["a", "b"]);
    expect(runsInPeriod(runs, "month", NOW).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });
});

describe("runFigures", () => {
  it("counts succeeded and failed runs and rounds the rate", () => {
    const figures = runFigures([run("1", "completed", 1), run("2", "completed", 2), run("3", "failed", 3)]);
    expect(figures).toEqual({ total: 3, succeeded: 2, failed: 1, rate: 67 });
  });
  it("never counts a run with nothing to do as a failure", () => {
    const figures = runFigures([run("1", "nothing_to_report", 1), run("2", "completed", 2, { quiet: true })]);
    expect(figures).toEqual({ total: 2, succeeded: 2, failed: 0, rate: 100 });
  });
  it("counts a completed run with problems, a block and a miss as failures", () => {
    const figures = runFigures([run("1", "completed", 1, { problems: "one file was missing" }), run("2", "blocked", 2), run("3", "missed", 3), run("4", "completed", 4)]);
    expect(figures).toEqual({ total: 4, succeeded: 1, failed: 3, rate: 25 });
  });
  it("leaves out runs still going and cancelled runs", () => {
    const figures = runFigures([run("1", "running", 1), run("2", "queued", 1), run("3", "waiting", 1), run("4", "cancelled", 1), run("5", "completed", 1)]);
    expect(figures).toEqual({ total: 1, succeeded: 1, failed: 0, rate: 100 });
  });
  it("has no rate when nothing ran", () => {
    expect(runFigures([])).toEqual({ total: 0, succeeded: 0, failed: 0, rate: null });
  });
});
