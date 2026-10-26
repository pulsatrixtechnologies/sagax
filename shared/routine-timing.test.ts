import { describe, expect, it } from "vitest";

import {
  FLEXIBLE_DEFAULT_EARLY_MINUTES,
  FLEXIBLE_DEFAULT_LATE_MINUTES,
  applyTiming,
  cappedWindow,
  clampTimingWindow,
  dailyGapMs,
  flexibleStartAt,
  cronGapCacheMisses,
  nominalGapMs,
  placedStart,
  planFlexibleStart,
  windowCapMinutes,
} from "./routine-timing.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("flexible timing windows", () => {
  it("defaults an omitted window to 15 minutes on each side", () => {
    expect(FLEXIBLE_DEFAULT_EARLY_MINUTES).toBe(15);
    expect(FLEXIBLE_DEFAULT_LATE_MINUTES).toBe(15);
    const daily = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    expect(applyTiming(daily, { timing: "flexible" })).toEqual({
      ...daily,
      timing: "flexible",
      windowEarlyMinutes: 15,
      windowLateMinutes: 15,
    });
  });

  it("leaves exact timing, including a missing choice, unchanged", () => {
    const daily = { type: "daily" as const, time: "09:00", weekdays: [1, 2, 3, 4, 5] };
    expect(applyTiming(daily, {})).toEqual(daily);
    expect(applyTiming(daily, { timing: "exact" })).toEqual(daily);
    expect(() => applyTiming(daily, { timing: "exact", windowEarlyMinutes: 5 })).toThrow(/window/i);
    expect(() => applyTiming({ type: "once", at: 1 }, { timing: "flexible" })).toThrow(/one-time/i);
    expect(() => applyTiming(daily, { timing: "soon" })).toThrow(/exact or flexible/i);
  });

  it("caps the window at half the gap for a daily, an interval, and a cron", () => {
    expect(windowCapMinutes(dailyGapMs([1]))).toBe((7 * 24 * 60) / 2);
    expect(windowCapMinutes(dailyGapMs([0, 1, 2, 3, 4, 5, 6]))).toBe(12 * 60);
    expect(windowCapMinutes(nominalGapMs({ type: "interval", everyMinutes: 10 }, 0))).toBe(5);
    expect(windowCapMinutes(nominalGapMs({ type: "interval", everyMinutes: 5 }, 0))).toBe(2);
    const cron = { type: "cron" as const, expression: "*/10 * * * *", timeZone: "UTC" };
    expect(nominalGapMs(cron, Date.parse("2026-06-01T00:00:00Z"))).toBe(10 * MINUTE);
    expect(windowCapMinutes(nominalGapMs(cron, Date.parse("2026-06-01T00:00:00Z")))).toBe(5);
    const stepped = { type: "cron" as const, expression: "*/7 * * * *", timeZone: "UTC" };
    expect(nominalGapMs(stepped, Date.parse("2026-06-01T00:00:00Z"))).toBe(4 * MINUTE);
    expect(windowCapMinutes(nominalGapMs(stepped, 0))).toBe(2);

    const everyTen = { type: "interval" as const, everyMinutes: 10, anchorAt: 0 };
    const stored = applyTiming(everyTen, { timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });
    expect(stored).toMatchObject({ windowEarlyMinutes: 15, windowLateMinutes: 15 });
    const capped = cappedWindow(stored, 0);
    expect(capped.early + capped.late).toBe(5);
    expect(clampTimingWindow(15, 0, 5)).toEqual({ early: 5, late: 0 });
    expect(clampTimingWindow(0, 15, 5)).toEqual({ early: 0, late: 5 });

    const daily = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const wide = applyTiming(daily, { timing: "flexible", windowEarlyMinutes: 10_000, windowLateMinutes: 10_000 });
    expect(wide).toMatchObject({ windowEarlyMinutes: 10_000, windowLateMinutes: 10_000 });
    expect(cappedWindow(wide, 0).early + cappedWindow(wide, 0).late).toBe(12 * 60);
    const kept = applyTiming(daily, { timing: "flexible", windowEarlyMinutes: 600, windowLateMinutes: 600 });
    expect(kept).toMatchObject({ windowEarlyMinutes: 600, windowLateMinutes: 600 });
  });

  it("caps a day-restricted cron from its shortest gap, at any start", () => {
    const weekday = { type: "cron" as const, expression: "0 0,8,23 * * 3,4", timeZone: "UTC" };
    const wednesday = Date.parse("2026-06-03T12:00:00Z");
    const thursday = Date.parse("2026-06-04T00:01:00Z");
    expect(nominalGapMs(weekday, wednesday)).toBe(60 * MINUTE);
    expect(nominalGapMs(weekday, thursday)).toBe(60 * MINUTE);
    const wide = { ...weekday, windowEarlyMinutes: 120, windowLateMinutes: 120 };
    const fromWednesday = cappedWindow(wide, wednesday);
    const fromThursday = cappedWindow(wide, thursday);
    expect(fromWednesday).toEqual(fromThursday);
    expect(fromWednesday.early + fromWednesday.late).toBe(30);

    const monthDay = { type: "cron" as const, expression: "0 0,8,23 3,4 * *", timeZone: "UTC" };
    const third = Date.parse("2026-06-03T22:00:00Z");
    const fourth = Date.parse("2026-06-04T00:01:00Z");
    expect(nominalGapMs(monthDay, third)).toBe(60 * MINUTE);
    expect(nominalGapMs(monthDay, fourth)).toBe(60 * MINUTE);
    expect(nominalGapMs(monthDay, Date.parse("2026-01-04T00:01:00Z"))).toBe(60 * MINUTE);
  });

  it("computes a dense day-restricted gap quickly and remembers it", () => {
    const everyFive = { type: "cron" as const, expression: "*/5 * 1-15 * *", timeZone: "UTC" };
    const everyMinute = { type: "cron" as const, expression: "*/1 * 1 * *", timeZone: "UTC" };
    const before = cronGapCacheMisses();
    const started = performance.now();
    expect(nominalGapMs(everyFive, Date.parse("2026-06-01T00:00:00Z"))).toBe(5 * MINUTE);
    expect(performance.now() - started).toBeLessThan(50);
    expect(cronGapCacheMisses()).toBe(before + 1);
    const again = performance.now();
    expect(nominalGapMs(everyFive, Date.parse("2026-12-01T00:00:00Z"))).toBe(5 * MINUTE);
    expect(performance.now() - again).toBeLessThan(50);
    expect(cronGapCacheMisses()).toBe(before + 1);

    const minuteStarted = performance.now();
    expect(nominalGapMs(everyMinute, Date.parse("2026-06-01T00:00:00Z"))).toBe(MINUTE);
    expect(performance.now() - minuteStarted).toBeLessThan(50);
    expect(cronGapCacheMisses()).toBe(before + 2);
    expect(nominalGapMs(everyMinute, Date.parse("2026-08-01T00:00:00Z"))).toBe(MINUTE);
    expect(cronGapCacheMisses()).toBe(before + 2);
  });

  it("reads month and weekday names without walking", () => {
    const weekdays = { type: "cron" as const, expression: "*/5 * * * MON-FRI", timeZone: "America/Toronto" };
    const before = cronGapCacheMisses();
    const started = performance.now();
    expect(nominalGapMs(weekdays, Date.parse("2026-06-01T00:00:00Z"))).toBe(5 * MINUTE);
    expect(performance.now() - started).toBeLessThan(50);
    expect(cronGapCacheMisses()).toBe(before + 1);
    expect(nominalGapMs({ ...weekdays, expression: "*/5 * * * mon-fri" }, Date.parse("2026-06-01T00:00:00Z"))).toBe(5 * MINUTE);

    const january = { type: "cron" as const, expression: "* * * JAN *", timeZone: "UTC" };
    const januaryStarted = performance.now();
    expect(nominalGapMs(january, Date.parse("2026-06-01T00:00:00Z"))).toBe(MINUTE);
    expect(performance.now() - januaryStarted).toBeLessThan(50);
    expect(cronGapCacheMisses()).toBe(before + 3);
    expect(nominalGapMs(january, Date.parse("2026-08-01T00:00:00Z"))).toBe(MINUTE);
    expect(cronGapCacheMisses()).toBe(before + 3);
  });

  it("keeps a weekly gap at seven days", () => {
    const monday = { type: "cron" as const, expression: "0 9 * * 1", timeZone: "UTC" };
    expect(nominalGapMs(monday, Date.parse("2026-06-01T00:00:00Z"))).toBe(7 * DAY);
    const wide = { ...monday, windowEarlyMinutes: 10_000, windowLateMinutes: 10_000 };
    expect(cappedWindow(wide, 0).early + cappedWindow(wide, 0).late).toBe(7 * 12 * 60);
    expect(nominalGapMs({ ...monday, expression: "0 9 * * MON" }, 0)).toBe(7 * DAY);
  });

  it("counts a skipped spring-forward time at the later instant", () => {
    const toronto = { type: "cron" as const, expression: "30 2 * * *", timeZone: "America/Toronto" };
    expect(nominalGapMs(toronto, Date.parse("2026-03-01T00:00:00Z"))).toBe(23 * 60 * MINUTE);
    const lordHowe = { type: "cron" as const, expression: "0 1,3 * * *", timeZone: "Australia/Lord_Howe" };
    expect(nominalGapMs(lordHowe, Date.parse("2026-10-01T00:00:00Z"))).toBe(90 * MINUTE);
  });

  it("shortens a gap that contains a spring-forward and leaves the fall-back hour longer", () => {
    const toronto = { type: "cron" as const, expression: "0 1,3 * * 0", timeZone: "America/Toronto" };
    const june = Date.parse("2026-06-07T12:00:00Z");
    const november = Date.parse("2026-11-02T12:00:00Z");
    expect(nominalGapMs(toronto, june)).toBe(60 * MINUTE);
    expect(nominalGapMs(toronto, november)).toBe(60 * MINUTE);
    const utc = { type: "cron" as const, expression: "0 1,3 * * 0", timeZone: "UTC" };
    expect(nominalGapMs(utc, june)).toBe(120 * MINUTE);
  });

  it("jumps to the first open slot and skips a slot that already fired", () => {
    const start = Date.parse("2026-01-01T00:00:00Z");
    const now = start + 72 * 60 * MINUTE;
    const every = 5 * MINUTE;
    let calls = 0;
    const placed = planFlexibleStart({
      routineId: "r1",
      schedule: { type: "interval", everyMinutes: 5, windowEarlyMinutes: 1, windowLateMinutes: 1 },
      afterNominal: start,
      notBefore: now,
      nextNominal: (after) => {
        calls += 1;
        return start + (Math.floor((after - start) / every) + 1) * every;
      },
    });
    expect(calls).toBe(1);
    expect(placed!.nominal).toBeGreaterThan(now - MINUTE);
    expect(placed!.start).toBeGreaterThanOrEqual(now);

    const nominal = Date.parse("2026-06-02T09:00:00Z");
    const openAt = nominal + 5 * MINUTE;
    const next = planFlexibleStart({
      routineId: "r1",
      schedule: { type: "daily", weekdays: [0, 1, 2, 3, 4, 5, 6], windowEarlyMinutes: 10, windowLateMinutes: 10 },
      afterNominal: openAt - 10 * MINUTE - 1,
      notBefore: openAt,
      lastFiredNominalAt: nominal,
      nextNominal: (after) => (after < nominal ? nominal : nominal + DAY),
    });
    expect(next!.nominal).toBe(nominal + DAY);
  });

  it("picks a start inside the window, the same one every time, and a late window of 0 never after the slot", () => {
    const nominal = Date.parse("2026-06-02T00:10:00Z");
    const midnight = Date.parse("2026-06-02T00:00:00Z");
    const starts = new Set<number>();
    let crossedMidnight = false;
    for (let index = 0; index < 80; index++) {
      const id = `slot-${index}`;
      const start = flexibleStartAt(id, nominal, 30, 15);
      expect(start).toBe(flexibleStartAt(id, nominal, 30, 15));
      expect(start).toBeGreaterThanOrEqual(nominal - 30 * MINUTE);
      expect(start).toBeLessThanOrEqual(nominal + 15 * MINUTE);
      if (start < midnight) crossedMidnight = true;
      starts.add(start);
    }
    expect(crossedMidnight).toBe(true);
    expect(starts.size).toBeGreaterThan(1);

    const onTime = flexibleStartAt("ready", nominal, 20, 0);
    expect(onTime).toBeLessThanOrEqual(nominal);
    expect(onTime).toBeGreaterThanOrEqual(nominal - 20 * MINUTE);
    expect(flexibleStartAt("point", nominal, 0, 0)).toBe(nominal);
    expect(placedStart(nominal - 10 * MINUTE, nominal, 0, nominal - 5 * MINUTE)).toBe(nominal - 5 * MINUTE);
    expect(placedStart(nominal - 10 * MINUTE, nominal, 0, nominal + MINUTE)).toBeNull();
  });
});
