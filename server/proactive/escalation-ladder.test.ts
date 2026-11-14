// #4250 (S3): the one escalation ladder, per level.
import { describe, expect, it } from "vitest";

import { FIX_LADDER, URGENT_LADDER, dueStep, hasNextStep, ladderFor, morningMinute, stepDueAt, stepsToldBy } from "./escalation-ladder.ts";

const H = 3_600_000;
const D = 24 * H;

describe("escalation ladder", () => {
  it("a ladder per level: urgent 2 h then 24 h, a fix item a day then weekly, FYI never", () => {
    expect(ladderFor("urgent")).toBe(URGENT_LADDER);
    expect(ladderFor("card")).toBe(FIX_LADDER);
    expect(ladderFor("fyi")).toBeNull();
    expect([1, 2, 3].map((step) => stepDueAt(URGENT_LADDER, 0, step))).toEqual([2 * H, D, null]);
    expect([1, 2, 3].map((step) => stepDueAt(FIX_LADDER, 0, step))).toEqual([D, 8 * D, 15 * D]);
    expect(hasNextStep(URGENT_LADDER, 0, 2)).toBe(false);
    expect(hasNextStep(FIX_LADDER, 0, 40)).toBe(true);
  });

  it("the step due now; a step missed while the server was down rings once, as the last one due", () => {
    expect(dueStep(URGENT_LADDER, 0, 0, 2 * H - 1)).toBeNull();
    expect(dueStep(URGENT_LADDER, 0, 0, 2 * H)).toBe(1);
    expect(dueStep(URGENT_LADDER, 0, 0, 3 * D)).toBe(2);
    expect(dueStep(URGENT_LADDER, 0, 2, 30 * D)).toBeNull();
    expect(dueStep(FIX_LADDER, 0, 1, 8 * D - 1)).toBeNull();
    expect(dueStep(FIX_LADDER, 0, 1, 16 * D)).toBe(3);
  });

  it("the steps a previous version's mark covers, and the morning's minute", () => {
    expect(stepsToldBy(FIX_LADDER, 0, D + 5)).toBe(1);
    expect(stepsToldBy(FIX_LADDER, 0, 9 * D)).toBe(2);
    expect(morningMinute(null)).toBe(8 * 60);
    expect(morningMinute({ start: "22:00", end: "06:30", timeZone: "UTC" })).toBe(6 * 60 + 30);
  });
});
