import { describe, expect, it } from "vitest";
import type { RoutineRun } from "@/lib/routines";
import { routineTrend, trendKind, TREND_SLOTS } from "./routine-trend";

const H = 3_600_000;
const NOW = Date.UTC(2026, 10, 17, 12);
const run = (id: string, status: RoutineRun["status"], hoursAgo: number, extra: Partial<RoutineRun> = {}) =>
  ({ id, routineId: "r", routineName: "n", botId: "b", target: "bot", runOn: "maus", manual: false, scheduledFor: NOW - hoursAgo * H, createdAt: NOW - hoursAgo * H, status, ...extra }) as RoutineRun;

describe("trendKind", () => {
  it("maps each result to its mark", () => {
    expect(trendKind({ status: "completed" })).toBe("success");
    expect(trendKind({ status: "nothing_to_report" })).toBe("success");
    expect(trendKind({ status: "completed", problems: "a file was missing" })).toBe("problems");
    expect(trendKind({ status: "failed" })).toBe("failed");
    expect(trendKind({ status: "blocked" })).toBe("blocked");
    expect(trendKind({ status: "missed" })).toBe("blocked");
    expect(trendKind({ status: "running" })).toBe("running");
    expect(trendKind({ status: "waiting" })).toBe("waiting");
  });
  it("draws no mark for a queued or cancelled run", () => {
    expect(trendKind({ status: "queued" })).toBeNull();
    expect(trendKind({ status: "cancelled" })).toBeNull();
  });
});

describe("routineTrend", () => {
  it("keeps the last 7 runs, oldest at the left and newest at the right", () => {
    const runs = Array.from({ length: 10 }, (_, index) => run(`r${index}`, "completed", index + 1));
    const trend = routineTrend(runs);
    expect(trend.marks).toHaveLength(TREND_SLOTS);
    expect(trend.marks.map((mark) => mark.run?.id)).toEqual(["r6", "r5", "r4", "r3", "r2", "r1", "r0"]);
    expect(trend.newest?.id).toBe("r0");
  });
  it("pads with empty slots at the left when there are fewer than 7 runs", () => {
    const trend = routineTrend([run("a", "failed", 5), run("b", "completed", 2)]);
    expect(trend.marks.map((mark) => mark.kind)).toEqual(["empty", "empty", "empty", "empty", "empty", "failed", "success"]);
  });
  it("shows 7 empty slots for a routine that never ran", () => {
    const trend = routineTrend([]);
    expect(trend.marks.every((mark) => mark.kind === "empty")).toBe(true);
    expect(trend.newest).toBeUndefined();
    expect(trend.counts).toEqual({});
  });
  it("counts each kind and leaves queued and cancelled runs out of the 7", () => {
    const trend = routineTrend([run("a", "completed", 9), run("b", "completed", 8, { problems: "x" }), run("c", "failed", 7), run("d", "queued", 1), run("e", "cancelled", 2), run("f", "running", 0.1)]);
    expect(trend.counts).toEqual({ success: 1, problems: 1, failed: 1, running: 1 });
    expect(trend.marks.filter((mark) => mark.kind !== "empty")).toHaveLength(4);
  });
});
