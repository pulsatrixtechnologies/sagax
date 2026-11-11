import { describe, expect, it } from "vitest";

import { ROUTINE_PROBLEM_STREAK_TOLD, routineRepeatsWithinDay } from "./routine-repeat.ts";

const at = Date.parse("2026-11-11T12:00:00Z");

describe("routineRepeatsWithinDay (#3695): which routines report by their streak", () => {
  it("an interval under a day repeats; a whole day does not", () => {
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 5, anchorAt: at }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: at, window: { start: "08:00", end: "17:00" } }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 1_440, anchorAt: at }, at)).toBe(false);
  });

  it("an interval whose window fits one run a day does not repeat; one that fits two does", () => {
    // a window as long as the interval: one start a day at most
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 120, anchorAt: at, window: { start: "09:00", end: "11:00" } }, at, "UTC")).toBe(false);
    // hourly at a quarter to, between 08:00 and 09:30: only 08:45 fits
    const quarterTo = Date.parse("2026-11-11T08:45:00Z");
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: quarterTo, window: { start: "08:00", end: "09:30" } }, at, "UTC")).toBe(false);
    // hourly on the hour in the same window: 08:00 and 09:00
    const onTheHour = Date.parse("2026-11-11T08:00:00Z");
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: onTheHour, window: { start: "08:00", end: "09:30" } }, at, "UTC")).toBe(true);
    // the zone the window is read in decides the minute: 08:45 UTC is 03:45 in Toronto, still a quarter to
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 60, anchorAt: quarterTo, window: { start: "08:00", end: "09:30" } }, at, "America/Toronto")).toBe(false);
    // an interval that does not divide a day moves its starts: two can fit
    expect(routineRepeatsWithinDay({ type: "interval", everyMinutes: 70, anchorAt: quarterTo, window: { start: "08:00", end: "09:30" } }, at, "UTC")).toBe(true);
  });

  it("a cron with two or more times on one day repeats; one time a day, a week or a month does not", () => {
    expect(routineRepeatsWithinDay({ type: "cron", expression: "*/5 * * * *", timeZone: "UTC" }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "15 8 * * 1-5; 30 12 * * 1-5", timeZone: "America/Toronto" }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 9,17 * * 1", timeZone: "America/Toronto" }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 7 * * *", timeZone: "America/Toronto" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 7 * * 1", timeZone: "America/Toronto" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 9 1 * *", timeZone: "UTC" }, at)).toBe(false);
    // one time on two days, late and early: once a day, not twice
    expect(routineRepeatsWithinDay({ type: "cron", expression: "0 23 * * 1; 0 1 * * 2", timeZone: "UTC" }, at)).toBe(false);
  });

  it("a run at every usage-limit reset repeats (a short usage window resets several times a day); the next reset only does not", () => {
    expect(routineRepeatsWithinDay({ type: "limit_reset", engine: "claude", repeat: "every_reset", at: null }, at)).toBe(true);
    expect(routineRepeatsWithinDay({ type: "limit_reset", engine: "claude", repeat: "once", at: null }, at)).toBe(false);
  });

  it("a daily time, a single date and every trigger never repeat within a day", () => {
    expect(routineRepeatsWithinDay({ type: "daily", time: "07:00", weekdays: [1, 2, 3, 4, 5] }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "once", at }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "webhook" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "event", source: "email" }, at)).toBe(false);
    expect(routineRepeatsWithinDay({ type: "event", source: "github", events: ["issues.opened"] }, at)).toBe(false);
    expect(routineRepeatsWithinDay(null, at)).toBe(false);
  });

  it("the person is told after three runs in a row", () => {
    expect(ROUTINE_PROBLEM_STREAK_TOLD).toBe(3);
  });
});
