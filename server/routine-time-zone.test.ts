// Routines read daily times, interval windows and weekdays in the zone a
// person chose (Settings > Bot > Time Zone, server/bot-settings.ts), else in
// the host's, as before. Cron keeps the zone saved with it.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { defaultOrgTimeZone } from "./bot-settings.ts";
import { nextOccurrence, RoutineManager, setRoutineTimeZone } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => {
  setRoutineTimeZone(() => undefined);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

// 2026-10-01 is a Thursday.
const THURSDAY_NOON_UTC = Date.UTC(2026, 9, 1, 12, 0);

describe("routine time zone", () => {
  it("reads a daily time in the zone it is given", () => {
    const daily = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    // 09:00 in Tokyo already passed at 12:00 UTC (21:00 there): tomorrow's.
    expect(nextOccurrence(daily, THURSDAY_NOON_UTC, "Asia/Tokyo")).toBe(Date.UTC(2026, 9, 2, 0, 0));
    // 09:00 in Toronto is 13:00 UTC: later today.
    expect(nextOccurrence(daily, THURSDAY_NOON_UTC, "America/Toronto")).toBe(Date.UTC(2026, 9, 1, 13, 0));
    // Weekdays are the zone's own: Friday in Tokyo starts at 15:00 UTC Thursday.
    expect(nextOccurrence({ ...daily, weekdays: [5] }, THURSDAY_NOON_UTC, "Asia/Tokyo")).toBe(Date.UTC(2026, 9, 2, 0, 0));
  });

  it("uses the configured default when no zone is given, and the host's without one", () => {
    const daily = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    const host = nextOccurrence(daily, THURSDAY_NOON_UTC);
    setRoutineTimeZone(() => "Asia/Tokyo");
    expect(nextOccurrence(daily, THURSDAY_NOON_UTC)).toBe(Date.UTC(2026, 9, 2, 0, 0));
    setRoutineTimeZone(() => "Not/AZone");
    expect(nextOccurrence(daily, THURSDAY_NOON_UTC)).toBe(host);
  });

  it("keeps interval windows in the zone", () => {
    const anchorAt = Date.UTC(2026, 9, 1, 0, 0);
    // Every hour, 09:00 to 10:00 Toronto time only.
    const schedule = { type: "interval" as const, everyMinutes: 60, anchorAt, window: { start: "09:00", end: "10:00" } };
    expect(nextOccurrence(schedule, THURSDAY_NOON_UTC, "America/Toronto")).toBe(Date.UTC(2026, 9, 1, 13, 0));
  });

  it("schedules each routine in its person's zone and reschedules when it changes", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-routine-tz-"));
    dirs.push(dir);
    const zones: Record<string, string | undefined> = { "maus-1": "Asia/Tokyo" };
    const manager = new RoutineManager({
      file: join(dir, "routines.json"),
      now: () => THURSDAY_NOON_UTC,
      botState: () => "ready",
      createTask: () => ({ threadId: "thread-1" }),
      startTurn: async () => {},
      timeZoneFor: (routine) => (routine.botId ? zones[routine.botId] : undefined),
    });
    const routine = manager.create({ name: "Morning", prompt: "Brief me", botId: "maus-1", schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    expect(routine.nextRunAt).toBe(Date.UTC(2026, 9, 2, 0, 0));
    zones["maus-1"] = "America/Toronto";
    expect(manager.rescheduleWallClock()).toBe(1);
    expect(manager.listRoutines()[0]!.nextRunAt).toBe(Date.UTC(2026, 9, 1, 13, 0));
    expect(manager.rescheduleWallClock()).toBe(0);
  });
});

describe("organization default zone (2026-10-20 routines ran 4 h early)", () => {
  it("defaults to America/Toronto on a UTC host, else the env, else nothing", () => {
    expect(defaultOrgTimeZone("UTC", undefined)).toBe("America/Toronto");
    expect(defaultOrgTimeZone("Etc/UTC", undefined)).toBe("America/Toronto");
    expect(defaultOrgTimeZone("UTC", "Europe/Paris")).toBe("Europe/Paris");
    expect(defaultOrgTimeZone("UTC", "Not/AZone")).toBe("America/Toronto");
    expect(defaultOrgTimeZone("Asia/Tokyo", undefined)).toBeNull();
  });

  it("a daily 12:00 created by a client with no zone runs at 12:00 Toronto", () => {
    setRoutineTimeZone(() => defaultOrgTimeZone("UTC", undefined) ?? undefined);
    const daily = { type: "daily" as const, time: "12:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };
    // 2026-10-20 12:00 EDT = 16:00 UTC
    expect(nextOccurrence(daily, Date.UTC(2026, 9, 20, 5, 0))).toBe(Date.UTC(2026, 9, 20, 16, 0));
  });

  it("start() repairs a next run stored with the old UTC reading", () => {
    const dir = mkdtempSync(join(tmpdir(), "omb-routine-tz-"));
    dirs.push(dir);
    const now = Date.UTC(2026, 9, 20, 5, 0);
    const make = () => new RoutineManager({
      file: join(dir, "routines.json"), now: () => now, botState: () => "ready",
      createTask: () => ({ threadId: "t" }), startTurn: async () => {},
      timeZoneFor: () => "America/Toronto",
    });
    const first = make();
    const routine = first.create({ name: "Pause", prompt: "x", botId: "maus-1", schedule: { type: "daily", time: "12:00", weekdays: [0, 1, 2, 3, 4, 5, 6] } });
    // Simulate the persisted UTC-read value.
    (first as unknown as { routines: Array<{ id: string; nextRunAt: number }> }).routines.find((r) => r.id === routine.id)!.nextRunAt = Date.UTC(2026, 9, 20, 12, 0);
    (first as unknown as { save(): void }).save();
    const second = make();
    second.start(); second.stop();
    expect(second.listRoutines().find((r) => r.id === routine.id)!.nextRunAt).toBe(Date.UTC(2026, 9, 20, 16, 0));
  });
});
