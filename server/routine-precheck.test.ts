import { describe, expect, it } from "vitest";
import {
  evaluateRoutinePrecheck,
  loadRoutinePrecheck,
  parseRoutinePrecheck,
  runRoutinePrecheck,
  RoutinePrecheckError,
} from "./routine-precheck.ts";

const now = Date.parse("2026-10-20T12:00:00Z");

describe("routine pre-check validation", () => {
  it("accepts the condition kinds", () => {
    expect(parseRoutinePrecheck({ kind: "condition", test: "elapsed_since_report", minMinutes: 60 }))
      .toEqual({ kind: "condition", test: "elapsed_since_report", minMinutes: 60 });
    expect(parseRoutinePrecheck({ kind: "condition", test: "every_nth", every: 3 }).test).toBe("every_nth");
  });

  it.each([
    null,
    "always",
    { kind: "script", command: "echo hi" },
    { kind: "condition", test: "unknown" },
    { kind: "condition", test: "elapsed_since_report" },
    { kind: "condition", test: "elapsed_since_report", minMinutes: 0 },
    { kind: "condition", test: "elapsed_since_report", minMinutes: 1.5 },
    { kind: "condition", test: "elapsed_since_report", minMinutes: 60, extra: true },
    { kind: "condition", test: "every_nth", every: 1 },
    { kind: "other", test: "every_nth", every: 2 },
  ])("rejects %j", (value) => {
    expect(() => parseRoutinePrecheck(value)).toThrow(RoutinePrecheckError);
    expect(loadRoutinePrecheck(value)).toBeUndefined();
  });
});

describe("routine pre-check evaluation", () => {
  it("elapsed_since_report wakes with no report, sleeps within the window, wakes after it", () => {
    const check = parseRoutinePrecheck({ kind: "condition", test: "elapsed_since_report", minMinutes: 30 });
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 0 })).toEqual({ wake: true });
    const quiet = evaluateRoutinePrecheck(check, { now, lastReportAt: now - 10 * 60_000, quietRunsSinceReport: 0 });
    expect(quiet.wake).toBe(false);
    expect(evaluateRoutinePrecheck(check, { now, lastReportAt: now - 30 * 60_000, quietRunsSinceReport: 0 })).toEqual({ wake: true });
  });

  it("every_nth wakes on the nth occurrence", () => {
    const check = parseRoutinePrecheck({ kind: "condition", test: "every_nth", every: 3 });
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 0 }).wake).toBe(false);
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 1 }).wake).toBe(false);
    expect(evaluateRoutinePrecheck(check, { now, quietRunsSinceReport: 2 }).wake).toBe(true);
  });

  it("throws on a pre-check it cannot read", () => {
    expect(() => evaluateRoutinePrecheck({ kind: "condition", test: "nope" } as never, { now, quietRunsSinceReport: 0 }))
      .toThrow(RoutinePrecheckError);
  });

  it("rejects on an error, a timeout or a malformed answer", async () => {
    await expect(runRoutinePrecheck(() => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(runRoutinePrecheck(() => new Promise(() => {}), 20)).rejects.toThrow(/did not answer/);
    await expect(runRoutinePrecheck(() => ({}) as never)).rejects.toThrow(/no answer/);
    await expect(runRoutinePrecheck(() => ({ wake: false, reason: "x".repeat(500) })))
      .resolves.toMatchObject({ wake: false, reason: "x".repeat(200) });
  });
});
