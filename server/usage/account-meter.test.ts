import { describe, expect, it } from "vitest";

import { createAccountMeter } from "./account-meter.ts";

const NOW = Date.UTC(2026, 10, 19, 15, 0);
const HOUR = 3_600_000;
const window = (usedPercent: number, resetsAt: number) => ({ available: true, usedPercent, remainingPercent: 100 - usedPercent, resetsAt: new Date(resetsAt).toISOString() });

describe("the account meter (#5014)", () => {
  it("keeps each window of a plan report, for every instance folded on its login", () => {
    const clock = { now: NOW };
    const meter = createAccountMeter({ now: () => clock.now });
    meter.notePlan("Person:P1", ["claude", "claude-opus"], { fiveHour: window(42, NOW + 2 * HOUR), weekly: window(30, NOW + 72 * HOUR) });
    expect(meter.windows("person:p1", "claude-opus")).toEqual({
      fiveHour: { usedPercent: 42, resetsAt: NOW + 2 * HOUR },
      weekly: { usedPercent: 30, resetsAt: NOW + 72 * HOUR },
    });
    expect(meter.fullest("person:p1", "claude")).toBe(42);
    // another payer reads nothing of it
    expect(meter.windows("person:p2", "claude").fiveHour.usedPercent).toBeNull();
  });

  it("reads a window whose reset passed as empty, not opened until a real turn uses it", () => {
    const clock = { now: NOW };
    const meter = createAccountMeter({ now: () => clock.now });
    meter.notePlan("server", ["claude"], { fiveHour: window(90, NOW + HOUR) });
    clock.now = NOW + HOUR + 1;
    expect(meter.windows("server", "claude").fiveHour).toEqual({ usedPercent: 0, resetsAt: null });
  });

  it("reads the provider's limit headers (Claude's rate_limit_event)", () => {
    const meter = createAccountMeter({ now: () => NOW });
    const resetsAt = Math.floor((NOW + 3 * HOUR) / 1000);
    meter.noteHeader("server", "claude", { status: "allowed_warning", rateLimitType: "five_hour", resetsAt, utilization: 0.82 });
    expect(meter.windows("server", "claude").fiveHour).toEqual({ usedPercent: 82, resetsAt: resetsAt * 1000 });
    meter.noteHeader("server", "claude", { status: "allowed", rateLimitType: "five_hour", resetsAt });
    // no figure: the last one of the same window stands
    expect(meter.windows("server", "claude").fiveHour.usedPercent).toBe(82);
    meter.noteHeader("server", "claude", { status: "rejected", rateLimitType: "seven_day", resetsAt: resetsAt + 86_400 });
    expect(meter.windows("server", "claude").weekly.usedPercent).toBe(100);
    // one model's weekly window never says the account is full
    meter.noteHeader("server", "claude-b", { status: "rejected", rateLimitType: "seven_day_opus", resetsAt });
    expect(meter.windows("server", "claude-b").weekly.usedPercent).toBeNull();
  });

  it("drops only a reading at 100 % after a turn worked", () => {
    const meter = createAccountMeter({ now: () => NOW });
    meter.notePlan("server", ["claude"], { fiveHour: window(100, NOW + HOUR), weekly: window(40, NOW + 48 * HOUR) });
    meter.worked("server", ["claude"]);
    expect(meter.windows("server", "claude")).toEqual({ fiveHour: { usedPercent: null, resetsAt: null }, weekly: { usedPercent: 40, resetsAt: NOW + 48 * HOUR } });
  });

  it("learns how many points one unit of demand costs on each account", () => {
    const clock = { now: NOW };
    const meter = createAccountMeter({ now: () => clock.now });
    meter.notePlan("server", ["claude"], { fiveHour: window(10, NOW + 4 * HOUR) });
    meter.noteSpend("server", "claude", 2);
    meter.noteSpend("server", "claude", 3);
    clock.now += 10 * 60_000;
    meter.notePlan("server", ["claude"], { fiveHour: window(20, NOW + 4 * HOUR) });
    expect(meter.scale("server", "claude")).toBeCloseTo(2, 9);
    // a new window starts counting again: nothing is learned across a reset
    meter.noteSpend("server", "claude", 5);
    meter.notePlan("server", ["claude"], { fiveHour: window(5, NOW + 9 * HOUR) });
    expect(meter.scale("server", "claude")).toBeCloseTo(2, 9);
    expect(meter.scale("server", "other")).toBeNull();
  });
});
