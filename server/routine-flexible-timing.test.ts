import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scheduleText } from "./routine-requests.ts";
import { nextOccurrence, RoutineManager, type RoutineScheduleInput } from "./routines.ts";
import { cappedWindow } from "../shared/routine-timing.ts";
import { zonedParts, zonedTimeToUtc } from "../shared/zoned-time.ts";

const MINUTE = 60_000;
const DAYS = [0, 1, 2, 3, 4, 5, 6];

function harness(start = new Date(2026, 7, 17, 8, 0, 0, 0).getTime(), timeZoneFor?: () => string | undefined) {
  const dir = mkdtempSync(join(tmpdir(), "routine-timing-"));
  const file = join(dir, "routines.json");
  let now = start;
  const manager = new RoutineManager({
    file,
    now: () => now,
    ...(timeZoneFor ? { timeZoneFor } : {}),
    botState: () => "ready",
    createTask: () => ({ threadId: "t1" }),
    startTurn: async () => {},
  });
  return {
    file,
    manager,
    get now() { return now; },
    setNow(at: number) { now = at; },
    stop() {
      manager.stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

const open: { stop: () => void }[] = [];
afterEach(() => {
  while (open.length) open.pop()!.stop();
});

function daily(extra: Record<string, unknown> = {}) {
  return { type: "daily" as const, time: "09:00", weekdays: DAYS, ...extra };
}

describe("flexible routine timing", () => {
  it("keeps exact timing on the old schedule and the old next run", () => {
    const h = harness();
    open.push(h);
    const schedule = daily();
    const routine = h.manager.create({ name: "Morning", prompt: "Check the list", botId: "b1", schedule });
    expect(routine.schedule).toEqual(schedule);
    expect(routine.nominalRunAt).toBeUndefined();
    expect(routine.nextRunAt).toBe(nextOccurrence(schedule, h.now));
    const disk = JSON.parse(readFileSync(h.file, "utf8")) as { routines: Array<{ schedule: object; nominalRunAt?: number }> };
    expect(disk.routines[0]!.schedule).toEqual(schedule);
    expect(disk.routines[0]!.nominalRunAt).toBeUndefined();
    const saved = routine.nextRunAt;
    h.manager.stop();
    const again = new RoutineManager({
      file: h.file,
      now: () => h.now,
      botState: () => "ready",
      createTask: () => ({ threadId: "t1" }),
      startTurn: async () => {},
    });
    open.push({ stop: () => again.stop() });
    again.start();
    expect(again.listRoutines()[0]!.nextRunAt).toBe(saved);
    again.stop();
  });

  it("starts inside the window, caps it, and keeps that start across a restart", () => {
    const h = harness();
    open.push(h);
    let routine = h.manager.create({
      name: "Window",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 }),
    });
    for (let index = 0; index < 6 && routine.nextRunAt === routine.nominalRunAt; index++) {
      routine = h.manager.create({
        name: `Window ${index}`,
        prompt: "Check the list",
        botId: "b1",
        schedule: daily({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 }),
      });
    }
    const nominal = routine.nominalRunAt!;
    const start = routine.nextRunAt!;
    expect(start).not.toBe(nominal);
    expect(start).toBeGreaterThanOrEqual(nominal - 15 * MINUTE);
    expect(start).toBeLessThanOrEqual(nominal + 15 * MINUTE);
    expect(routine.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });

    h.manager.stop();
    const again = new RoutineManager({
      file: h.file,
      now: () => h.now,
      botState: () => "ready",
      createTask: () => ({ threadId: "t1" }),
      startTurn: async () => {},
    });
    open.push({ stop: () => again.stop() });
    again.start();
    const reloaded = again.listRoutines().find((item) => item.id === routine.id)!;
    expect(reloaded.nextRunAt).toBe(start);
    expect(reloaded.nominalRunAt).toBe(nominal);
    again.stop();
  });

  it("caps a short interval and a cron at half the gap, and a late window of 0 stays on time", () => {
    const h = harness();
    open.push(h);
    const interval = h.manager.create({
      name: "Often",
      prompt: "Check the list",
      botId: "b1",
      schedule: {
        type: "interval",
        everyMinutes: 10,
        anchorAt: h.now,
        timing: "flexible",
        windowEarlyMinutes: 15,
        windowLateMinutes: 15,
      },
    });
    expect(interval.schedule).toMatchObject({ type: "interval", timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });
    if (interval.schedule.type !== "interval") throw new Error("expected an interval");
    const window = cappedWindow(interval.schedule, h.now);
    expect(window.early + window.late).toBe(5);
    expect(interval.nextRunAt).toBeGreaterThanOrEqual(interval.nominalRunAt! - window.early * MINUTE);
    expect(interval.nextRunAt).toBeLessThanOrEqual(interval.nominalRunAt! + window.late * MINUTE);

    const cron = h.manager.create({
      name: "Clock",
      prompt: "Check the list",
      botId: "b1",
      schedule: {
        type: "cron",
        expression: "*/10 * * * *",
        timeZone: "UTC",
        timing: "flexible",
        windowEarlyMinutes: 15,
        windowLateMinutes: 15,
      },
    });
    expect(cron.schedule).toMatchObject({ type: "cron", timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });
    if (cron.schedule.type !== "cron") throw new Error("expected a cron");
    const cronWindow = cappedWindow(cron.schedule, h.now);
    expect(cronWindow.early + cronWindow.late).toBe(5);
    expect(cron.nextRunAt).toBeGreaterThanOrEqual(cron.nominalRunAt! - cronWindow.early * MINUTE);
    expect(cron.nextRunAt).toBeLessThanOrEqual(cron.nominalRunAt! + cronWindow.late * MINUTE);

    const onTime = h.manager.create({
      name: "Ready",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 20, windowLateMinutes: 0 }),
    });
    expect(onTime.schedule).toMatchObject({ windowEarlyMinutes: 20, windowLateMinutes: 0 });
    expect(onTime.nextRunAt).toBeLessThanOrEqual(onTime.nominalRunAt!);
    expect(onTime.nextRunAt).toBeGreaterThanOrEqual(onTime.nominalRunAt! - 20 * MINUTE);
  });

  it("uses 15 minutes on each side when a flexible routine names no window", () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Default",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible" }),
    });
    expect(routine.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 });
  });

  it("rejects timing on a one-time routine and a window on exact timing", () => {
    const h = harness();
    open.push(h);
    expect(() => h.manager.create({
      name: "Once",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "once", at: h.now + MINUTE, timing: "flexible" } as RoutineScheduleInput,
    })).toThrow(/one-time/i);
    expect(() => h.manager.create({
      name: "Exact",
      prompt: "Check the list",
      botId: "b1",
      schedule: { ...daily(), timing: "exact", windowEarlyMinutes: 5 },
    })).toThrow(/window/i);
  });

  it("advances from the nominal slot, so an early start does not run that slot again", async () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Steady",
      prompt: "Check the list",
      botId: "b1",
      schedule: {
        type: "interval",
        everyMinutes: 30,
        anchorAt: h.now,
        timing: "flexible",
        windowEarlyMinutes: 5,
        windowLateMinutes: 5,
      },
    });
    const firstNominal = routine.nominalRunAt!;
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    const after = h.manager.getRoutine(routine.id)!;
    expect(after.nominalRunAt).toBe(nextOccurrence(routine.schedule, firstNominal));
    expect(after.nominalRunAt).not.toBe(firstNominal);
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);

    const kept = h.manager.update(routine.id, { name: "Steady renamed" });
    expect(kept?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 5, windowLateMinutes: 5 });
    expect(kept?.nominalRunAt).toBe(after.nominalRunAt);
    expect(kept?.nextRunAt).toBe(after.nextRunAt);

    const exact = h.manager.update(routine.id, {
      schedule: { type: "interval", everyMinutes: 30, anchorAt: h.now, timing: "exact" },
    });
    expect(exact?.schedule).not.toHaveProperty("timing");
    expect(exact?.nominalRunAt).toBeUndefined();
    expect(exact?.nextRunAt).toBe(nextOccurrence(exact!.schedule, h.now));
  });

  it("keeps flexible timing when an interval update does not mention it", () => {
    const h = harness();
    open.push(h);
    const anchorAt = h.now;
    const routine = h.manager.create({
      name: "Kept",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "interval", everyMinutes: 30, anchorAt, timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5 },
    });
    const updated = h.manager.update(routine.id, { schedule: { type: "interval", everyMinutes: 40, anchorAt } });
    expect(updated?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 10, windowLateMinutes: 5, everyMinutes: 40 });
    expect(updated?.nominalRunAt).toBeTypeOf("number");
  });

  it("keeps flexible timing when a daily or cron update does not mention it", () => {
    const h = harness();
    open.push(h);
    const dailyRoutine = h.manager.create({
      name: "Day",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 12, windowLateMinutes: 4 }),
    });
    const dailyUpdated = h.manager.update(dailyRoutine.id, { schedule: daily({ time: "10:30" }) });
    expect(dailyUpdated?.schedule).toMatchObject({
      type: "daily",
      time: "10:30",
      timing: "flexible",
      windowEarlyMinutes: 12,
      windowLateMinutes: 4,
    });
    const exact = h.manager.update(dailyRoutine.id, { schedule: daily({ time: "10:30", timing: "exact" }) });
    expect(exact?.schedule).not.toHaveProperty("timing");

    const cron = h.manager.create({
      name: "Clock",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "cron", expression: "0 9 * * 1", timeZone: "UTC", timing: "flexible", windowEarlyMinutes: 20, windowLateMinutes: 0 },
    });
    const cronUpdated = h.manager.update(cron.id, {
      schedule: { type: "cron", expression: "0 10 * * 1", timeZone: "UTC" },
    });
    expect(cronUpdated?.schedule).toMatchObject({
      type: "cron",
      expression: "0 10 * * 1",
      timing: "flexible",
      windowEarlyMinutes: 20,
      windowLateMinutes: 0,
    });
  });

  it("does not fire a slot again when flexible timing becomes exact before that slot", async () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Morning",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 30, windowLateMinutes: 0 }),
    });
    const fired = routine.nominalRunAt!;
    expect(routine.nextRunAt).toBeLessThan(fired);
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    expect(h.manager.getRoutine(routine.id)!.lastFiredNominalAt).toBe(fired);
    expect(h.now).toBeLessThan(fired);

    const exact = h.manager.update(routine.id, { schedule: daily({ timing: "exact" }) });
    expect(exact?.schedule).not.toHaveProperty("timing");
    expect(exact?.lastFiredNominalAt).toBe(fired);
    expect(exact?.nominalRunAt).toBeUndefined();
    expect(exact?.nextRunAt).toBe(nextOccurrence(daily(), fired));
    expect(exact!.nextRunAt).toBeGreaterThan(fired);

    h.setNow(fired);
    await h.manager.tick();
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  async function firedThenExact(h: ReturnType<typeof harness>) {
    const routine = h.manager.create({
      name: "Morning",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 30, windowLateMinutes: 0 }),
    });
    const fired = routine.nominalRunAt!;
    expect(routine.nextRunAt).toBeLessThan(fired);
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    const exact = h.manager.update(routine.id, { schedule: daily({ timing: "exact" }) });
    const next = exact!.nextRunAt!;
    expect(exact?.lastFiredNominalAt).toBe(fired);
    expect(next).toBeGreaterThan(fired);
    expect(h.now).toBeLessThan(fired);
    return { routine, fired, next };
  }

  function reopen(h: ReturnType<typeof harness>) {
    const again = new RoutineManager({
      file: h.file,
      now: () => h.now,
      botState: () => "ready",
      createTask: () => ({ threadId: "t1" }),
      startTurn: async () => {},
    });
    open.push({ stop: () => again.stop() });
    return again;
  }

  it("does not fire 09:00 again when an early run became exact and the server restarts", async () => {
    const h = harness();
    open.push(h);
    const { routine, fired, next } = await firedThenExact(h);
    h.manager.stop();
    const again = reopen(h);
    again.start();
    expect(again.getRoutine(routine.id)!.nextRunAt).toBe(next);
    expect(again.getRoutine(routine.id)!.nextRunAt).toBeGreaterThan(fired);
    h.setNow(fired);
    await again.tick();
    expect(again.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  it("does not put the fired slot back when the time zone is applied again", async () => {
    let zone = "UTC";
    const h = harness(undefined, () => zone);
    open.push(h);
    const { routine, fired, next } = await firedThenExact(h);
    expect(next).toBe(nextOccurrence(daily(), fired, "UTC"));
    zone = "Atlantic/Reykjavik";
    expect(h.manager.rescheduleWallClock()).toBe(0);
    const kept = h.manager.getRoutine(routine.id)!;
    expect(kept.nextRunAt).toBe(next);
    expect(kept.nextRunAt).toBeGreaterThan(fired);
    h.setNow(fired);
    await h.manager.tick();
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  it("does not fire the cleared slot when a retired suspension is reloaded", async () => {
    const h = harness();
    open.push(h);
    const { routine, fired, next } = await firedThenExact(h);
    h.manager.stop();
    const disk = JSON.parse(readFileSync(h.file, "utf8")) as { routines: Array<{ id: string; suspended?: unknown }> };
    const row = disk.routines.find((item) => item.id === routine.id);
    expect(row).toBeDefined();
    row!.suspended = { reason: "delegation_missing", at: 1 };
    writeFileSync(h.file, JSON.stringify(disk));
    const again = reopen(h);
    const loaded = again.getRoutine(routine.id)!;
    expect(loaded.suspended).toBeUndefined();
    expect(loaded.nextRunAt).toBe(next);
    expect(loaded.nextRunAt).toBeGreaterThan(fired);
    h.setNow(fired);
    await again.tick();
    expect(again.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  it("still places the upcoming slot when exact timing becomes flexible", () => {
    const h = harness();
    open.push(h);
    const exact = h.manager.create({
      name: "Morning",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily(),
    });
    const slot = exact.nextRunAt!;
    const flexible = h.manager.update(exact.id, {
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 0 }),
    });
    expect(flexible?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 0 });
    expect(flexible?.nominalRunAt).toBe(slot);
    expect(flexible?.nextRunAt).toBeLessThanOrEqual(slot);
    expect(flexible!.nextRunAt).toBeGreaterThanOrEqual(slot - 15 * MINUTE);
    expect(flexible?.lastFiredNominalAt).toBeUndefined();
  });

  it("applies window minutes sent without a timing choice, and rejects them on an exact routine", () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Morning",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 12, windowLateMinutes: 4 }),
    });
    const lateOnly = h.manager.update(routine.id, { schedule: daily({ windowLateMinutes: 9 }) });
    expect(lateOnly?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 12, windowLateMinutes: 9 });
    const both = h.manager.update(routine.id, { schedule: daily({ windowEarlyMinutes: 30, windowLateMinutes: 0 }) });
    expect(both?.schedule).toMatchObject({ timing: "flexible", windowEarlyMinutes: 30, windowLateMinutes: 0 });

    const exact = h.manager.create({
      name: "Exact",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily(),
    });
    expect(() => h.manager.update(exact.id, { schedule: daily({ windowEarlyMinutes: 5 }) })).toThrow(/window/i);
    expect(() => h.manager.create({
      name: "Create",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ windowEarlyMinutes: 5 }),
    })).toThrow(/window/i);
    expect(h.manager.getRoutine(exact.id)?.schedule).not.toHaveProperty("windowEarlyMinutes");
  });

  it("does not fire a slot again after pause and resume, or after an edit that keeps it", async () => {
    const h = harness();
    open.push(h);
    const anchorAt = h.now;
    const schedule = {
      type: "interval" as const,
      everyMinutes: 30,
      anchorAt,
      timing: "flexible" as const,
      windowEarlyMinutes: 10,
      windowLateMinutes: 10,
    };
    const routine = h.manager.create({ name: "Steady", prompt: "Check the list", botId: "b1", schedule });
    const fired = routine.nominalRunAt!;
    h.setNow(routine.nextRunAt!);
    expect(h.now).toBeLessThan(fired + 10 * MINUTE);
    await h.manager.tick();
    const after = h.manager.getRoutine(routine.id)!;
    expect(after.lastFiredNominalAt).toBe(fired);
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);

    const paused = h.manager.update(routine.id, { enabled: false });
    expect(paused?.nextRunAt).toBeNull();
    expect(paused?.lastFiredNominalAt).toBe(fired);
    const resumed = h.manager.update(routine.id, { enabled: true });
    expect(resumed?.nominalRunAt).toBe(nextOccurrence(routine.schedule, fired));
    expect(resumed?.nominalRunAt).not.toBe(fired);
    expect(resumed?.nextRunAt).toBeGreaterThan(h.now);
    expect(resumed?.lastFiredNominalAt).toBe(fired);
    await h.manager.tick();
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);

    const edited = h.manager.update(routine.id, {
      schedule: { ...schedule, windowEarlyMinutes: 8, windowLateMinutes: 8 },
    });
    expect(edited?.nominalRunAt).toBeGreaterThan(fired);
    expect(edited?.lastFiredNominalAt).toBe(fired);
    expect(edited?.nextRunAt).toBeGreaterThan(h.now);
    await h.manager.tick();
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  it("keeps a stored 600/600 daily window across a reload", () => {
    const h = harness();
    open.push(h);
    const routine = h.manager.create({
      name: "Wide",
      prompt: "Check the list",
      botId: "b1",
      schedule: daily({ timing: "flexible", windowEarlyMinutes: 600, windowLateMinutes: 600 }),
    });
    expect(routine.schedule).toMatchObject({ windowEarlyMinutes: 600, windowLateMinutes: 600 });
    const window = cappedWindow(routine.schedule, h.now);
    expect(window.early + window.late).toBe(12 * 60);
    expect(routine.nextRunAt).toBeGreaterThanOrEqual(routine.nominalRunAt! - window.early * MINUTE);
    expect(routine.nextRunAt).toBeLessThanOrEqual(routine.nominalRunAt! + window.late * MINUTE);
    h.manager.stop();
    const again = new RoutineManager({
      file: h.file,
      now: () => h.now,
      botState: () => "ready",
      createTask: () => ({ threadId: "t1" }),
      startTurn: async () => {},
    });
    open.push({ stop: () => again.stop() });
    const reloaded = again.getRoutine(routine.id)!;
    expect(reloaded.schedule).toMatchObject({ windowEarlyMinutes: 600, windowLateMinutes: 600 });
    again.stop();
  });

  it("plans the next run after 72 hours down for an interval and a cron", async () => {
    const h = harness();
    open.push(h);
    const interval = h.manager.create({
      name: "Often",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "interval", everyMinutes: 5, anchorAt: h.now, timing: "flexible", windowEarlyMinutes: 1, windowLateMinutes: 1 },
    });
    const cron = h.manager.create({
      name: "Clock",
      prompt: "Check the list",
      botId: "b1",
      schedule: { type: "cron", expression: "*/5 * * * *", timeZone: "UTC", timing: "flexible", windowEarlyMinutes: 1, windowLateMinutes: 1 },
    });
    const jumped = h.now + 72 * 60 * MINUTE;
    h.setNow(jumped);
    await h.manager.tick();
    const intervalAfter = h.manager.getRoutine(interval.id)!;
    const cronAfter = h.manager.getRoutine(cron.id)!;
    expect(intervalAfter.enabled).toBe(true);
    expect(intervalAfter.nextRunAt).toBeGreaterThanOrEqual(jumped);
    expect(cronAfter.enabled).toBe(true);
    expect(cronAfter.nextRunAt).toBeGreaterThanOrEqual(jumped);
  });

  it("describes a flexible daily schedule with its window", () => {
    expect(scheduleText({
      type: "daily",
      time: "09:00",
      weekdays: [1, 2, 3, 4, 5],
      timing: "flexible",
      windowEarlyMinutes: 15,
      windowLateMinutes: 0,
    }, "UTC")).toContain("around 09:00 (-15/+0 min)");
  });

  it("keeps a start around midnight and around a daylight-saving change inside the window", () => {
    const previous = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const h = harness(Date.parse("2026-06-01T22:00:00Z"));
      open.push(h);
      const routine = h.manager.create({
        name: "Midnight",
        prompt: "Check the list",
        botId: "b1",
        schedule: { type: "daily", time: "00:10", weekdays: DAYS, timing: "flexible", windowEarlyMinutes: 30, windowLateMinutes: 15 },
      });
      const nominal = Date.parse("2026-06-02T00:10:00Z");
      expect(routine.nominalRunAt).toBe(nominal);
      expect(routine.nextRunAt).toBeGreaterThanOrEqual(nominal - 30 * MINUTE);
      expect(routine.nextRunAt).toBeLessThanOrEqual(nominal + 15 * MINUTE);
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }

    const zone = "America/New_York";
    const saved = process.env.TZ;
    try {
      process.env.TZ = zone;
      const spring = harness(new Date(2026, 2, 7, 12, 0, 0, 0).getTime());
      open.push(spring);
      const sprung = spring.manager.create({
        name: "Spring",
        prompt: "Check the list",
        botId: "b1",
        schedule: { type: "daily", time: "02:30", weekdays: DAYS, timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 },
      });
      expect(zonedParts(sprung.nominalRunAt!, zone)).toMatchObject({ month: 3, day: 8, hour: 3, minute: 30 });
      expect(sprung.nextRunAt).toBeGreaterThanOrEqual(sprung.nominalRunAt! - 15 * MINUTE);
      expect(sprung.nextRunAt).toBeLessThanOrEqual(sprung.nominalRunAt! + 15 * MINUTE);

      const fall = harness(new Date(2026, 9, 31, 12, 0, 0, 0).getTime());
      open.push(fall);
      const fallen = fall.manager.create({
        name: "Fall",
        prompt: "Check the list",
        botId: "b1",
        schedule: { type: "daily", time: "01:30", weekdays: DAYS, timing: "flexible", windowEarlyMinutes: 15, windowLateMinutes: 15 },
      });
      const first = zonedTimeToUtc(2026, 11, 1, 1, 30, zone);
      expect(zonedParts(fallen.nominalRunAt!, zone)).toMatchObject({ month: 11, day: 1, hour: 1, minute: 30 });
      expect(Math.abs(fallen.nextRunAt! - fallen.nominalRunAt!)).toBeLessThanOrEqual(15 * MINUTE);
      expect(Math.abs(fallen.nextRunAt! - (fallen.nominalRunAt === first ? first + 60 * MINUTE : first))).toBeGreaterThan(15 * MINUTE);
    } finally {
      if (saved === undefined) delete process.env.TZ;
      else process.env.TZ = saved;
    }
  });
});
