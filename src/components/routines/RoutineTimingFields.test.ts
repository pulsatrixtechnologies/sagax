import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { readTiming, RoutineTimingFields, withRoutineTiming } from "./RoutineTimingFields";

describe("routine timing fields", () => {
  it("shows exact or flexible, and the windows only for flexible", () => {
    const exact = renderToStaticMarkup(createElement(RoutineTimingFields, {
      mode: "exact", earlyMinutes: 15, lateMinutes: 15, onMode: () => {}, onEarly: () => {}, onLate: () => {},
    }));
    expect(exact).toContain("Exact");
    expect(exact).toContain("Flexible");
    expect(exact).not.toContain("Early window minutes");

    const flexible = renderToStaticMarkup(createElement(RoutineTimingFields, {
      mode: "flexible", earlyMinutes: 15, lateMinutes: 0, onMode: () => {}, onEarly: () => {}, onLate: () => {},
    }));
    expect(flexible).toContain("Early window minutes");
    expect(flexible).toContain("Late window minutes");
    expect(flexible).toContain("0 late means ready by the scheduled time.");
    expect(flexible).toContain('value="0"');
  });

  it("keeps an exact choice on a repeating schedule and drops it from a one-time schedule", () => {
    expect(withRoutineTiming({ type: "daily", time: "09:00", weekdays: [1] }, true, "exact", 15, 15)).toEqual({
      type: "daily", time: "09:00", weekdays: [1], timing: "exact",
    });
    expect(withRoutineTiming(
      { type: "daily", time: "09:00", weekdays: [1], timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 10 },
      true,
      "flexible",
      5,
      0,
    )).toEqual({ type: "daily", time: "09:00", weekdays: [1], timing: "flexible", windowEarlyMinutes: 5, windowLateMinutes: 0 });
    expect(withRoutineTiming({ type: "once", at: 1, timing: "flexible" }, false, "flexible", 15, 15)).toEqual({ type: "once", at: 1 });
    expect(readTiming({ type: "daily", timing: "flexible", windowEarlyMinutes: 4, windowLateMinutes: 6 })).toEqual({
      mode: "flexible", early: 4, late: 6,
    });
  });
});
