// "Only when I'm here" routines (server/routines/routine-away.ts): the decision, the
// count, the report, the solo server's beat, and the scheduler end to end
// (no run while away, one report on return, a one-time routine waits).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { PRESENCE_AWAY_AFTER_MS, PRESENCE_OFFLINE_AFTER_MS } from "../../shared/presence.ts";
import {
  awayDecision,
  awayReportDue,
  awaySkipsDetail,
  LocalAwayTracker,
  loadAwaySkips,
  recordAwaySkip,
  verdictFromPresence,
  type AwayVerdict,
  type RoutineAwaySkips,
} from "./routine-away.ts";
import { RoutineManager, type Routine } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("routine away rules", () => {
  it("is off by default: a routine without the switch always runs", () => {
    expect(awayDecision({ schedule: { type: "cron" } }, "away")).toBe("run");
    expect(awayDecision({ onlyWhenPresent: false, schedule: { type: "daily" } }, "away")).toBe("run");
  });

  it("skips a recurring occurrence and holds a one-time routine while away; runs when present or unknown", () => {
    expect(awayDecision({ onlyWhenPresent: true, schedule: { type: "interval" } }, "away")).toBe("skip");
    expect(awayDecision({ onlyWhenPresent: true, schedule: { type: "once" } }, "away")).toBe("hold");
    expect(awayDecision({ onlyWhenPresent: true, schedule: { type: "cron" } }, "present")).toBe("run");
    // no signal never silently stops work
    expect(awayDecision({ onlyWhenPresent: true, schedule: { type: "cron" } }, "unknown")).toBe("run");
  });

  it("counts skips in one spell, and a reported spell starts over", () => {
    let skips = recordAwaySkip(undefined, 1_000);
    skips = recordAwaySkip(skips, 2_000);
    expect(skips).toEqual({ count: 2, firstAt: 1_000, lastAt: 2_000 });
    expect(recordAwaySkip({ ...skips, reportedAt: 3_000 }, 4_000)).toEqual({ count: 1, firstAt: 4_000, lastAt: 4_000 });
  });

  it("reports once, only when the person is back", () => {
    const skips: RoutineAwaySkips = { count: 3, firstAt: 1, lastAt: 2 };
    expect(awayReportDue({ awaySkips: skips }, "away")).toBe(false);
    expect(awayReportDue({ awaySkips: skips }, "unknown")).toBe(false);
    expect(awayReportDue({ awaySkips: skips }, "present")).toBe(true);
    expect(awayReportDue({ awaySkips: { ...skips, reportedAt: 5 } }, "present")).toBe(false);
    expect(awaySkipsDetail("Morning digest", skips)).toBe("Morning digest: 3 runs were skipped while you were away");
  });

  it("loads only a well formed record", () => {
    expect(loadAwaySkips({ count: 2, firstAt: 1, lastAt: 2, reportedAt: 3 })).toEqual({ count: 2, firstAt: 1, lastAt: 2, reportedAt: 3 });
    expect(loadAwaySkips({ count: 0, firstAt: 1, lastAt: 2 })).toBeUndefined();
    expect(loadAwaySkips({ count: 1, firstAt: -1, lastAt: 2 })).toBeUndefined();
    expect(loadAwaySkips("nope")).toBeUndefined();
  });

  it("reads organization presence: online is here, away and offline are away", () => {
    expect(verdictFromPresence("online")).toBe("present");
    expect(verdictFromPresence("away")).toBe("away");
    expect(verdictFromPresence("offline")).toBe("away");
    expect(verdictFromPresence(undefined)).toBe("unknown");
  });

  it("reads a solo server's beats: unknown before the first, then idle time, lock and silence", () => {
    const tracker = new LocalAwayTracker();
    expect(tracker.verdict(0)).toBe("unknown");
    tracker.beat({ idleMs: 0, systemIdle: "active" }, 1_000);
    expect(tracker.verdict(1_000 + 60_000)).toBe("present");
    expect(tracker.verdict(1_000 + PRESENCE_AWAY_AFTER_MS + 1)).toBe("away");
    tracker.beat({ idleMs: 0, systemIdle: "locked" }, 2_000);
    expect(tracker.verdict(2_000)).toBe("away");
    tracker.beat({ idleMs: PRESENCE_AWAY_AFTER_MS + 1 }, 3_000);
    expect(tracker.verdict(3_000)).toBe("away");
    tracker.beat({ idleMs: 0 }, 4_000);
    expect(tracker.verdict(4_000 + PRESENCE_OFFLINE_AFTER_MS + 1)).toBe("away");
  });
});

describe("RoutineManager with Only when I'm here", () => {
  function harness(start: number) {
    const dir = mkdtempSync(join(tmpdir(), "sagax-routine-away-"));
    dirs.push(dir);
    let now = start;
    let verdict: AwayVerdict = "present";
    const started: string[] = [];
    const reported: Array<{ routine: Routine; skips: RoutineAwaySkips }> = [];
    let task = 0;
    const manager = new RoutineManager({
      file: join(dir, "routines.json"),
      now: () => now,
      botState: () => "ready",
      createTask: () => ({ threadId: `thread-${++task}` }),
      startTurn: async (_botId, threadId) => { started.push(threadId); },
      presence: () => verdict,
      onAwaySkipsReported: (routine, skips) => reported.push({ routine, skips }),
    });
    return {
      manager, started, reported,
      setNow: (value: number) => { now = value; },
      setVerdict: (value: AwayVerdict) => { verdict = value; },
      file: join(dir, "routines.json"),
    };
  }
  const start = Date.parse("2026-10-16T08:00:00Z");
  const every15 = { type: "interval" as const, everyMinutes: 15, anchorAt: start };

  it("is off unless chosen, and a routine without it runs while the person is away", async () => {
    const h = harness(start);
    const routine = h.manager.create({ name: "Digest", prompt: "Summarize", botId: "bot-1", schedule: every15 });
    expect(routine.onlyWhenPresent).toBeUndefined();
    h.setVerdict("away");
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
  });

  it("creates no run while away, counts the skips, reports once on return and forgets on dismiss", async () => {
    const h = harness(start);
    const routine = h.manager.create({ name: "Digest", prompt: "Summarize", botId: "bot-1", schedule: every15, onlyWhenPresent: true });
    expect(routine.onlyWhenPresent).toBe(true);
    h.setVerdict("away");
    let at = routine.nextRunAt!;
    for (let index = 0; index < 3; index++) {
      h.setNow(at);
      await h.manager.tick();
      at = h.manager.listRoutines()[0]!.nextRunAt!;
    }
    expect(h.started).toHaveLength(0);
    expect(h.manager.listRuns()).toHaveLength(0);
    expect(h.manager.listRoutines()[0]!.awaySkips).toMatchObject({ count: 3 });
    expect(h.reported).toHaveLength(0);

    // back: reported once, kept until dismissed; no burst of catch-up runs
    h.setVerdict("present");
    h.setNow(at - 60_000);
    await h.manager.tick();
    await h.manager.tick();
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0]!.skips).toMatchObject({ count: 3, reportedAt: at - 60_000 });
    expect(h.started).toHaveLength(0);
    // survives a restart
    const reloaded = new RoutineManager({ file: h.file, now: () => at, botState: () => "ready", createTask: () => null, startTurn: async () => {} });
    expect(reloaded.listRoutines()[0]!.awaySkips).toMatchObject({ count: 3, reportedAt: at - 60_000 });

    expect(h.manager.clearAwaySkips(routine.id)!.awaySkips).toBeUndefined();
    h.setNow(at);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
  });

  it("holds a one-time routine while away and runs it on return", async () => {
    const h = harness(start);
    const routine = h.manager.create({ name: "Once", prompt: "Do it", botId: "bot-1", schedule: { type: "once", at: start + 60_000 }, onlyWhenPresent: true });
    h.setVerdict("away");
    h.setNow(start + 60_000);
    await h.manager.tick();
    expect(h.started).toHaveLength(0);
    expect(h.manager.listRoutines()[0]!.nextRunAt).toBe(start + 60_000);
    // back 13 hours later: it runs rather than being written off as missed
    h.setVerdict("present");
    h.setNow(start + 13 * 60 * 60_000);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
    expect(h.manager.listRuns()[0]!.status).not.toBe("missed");
    expect(routine.id).toBe(h.manager.listRuns()[0]!.routineId);
  });

  it("switching the option off forgets what it skipped", async () => {
    const h = harness(start);
    const routine = h.manager.create({ name: "Digest", prompt: "Summarize", botId: "bot-1", schedule: every15, onlyWhenPresent: true });
    h.setVerdict("away");
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    expect(h.manager.listRoutines()[0]!.awaySkips?.count).toBe(1);
    const updated = h.manager.update(routine.id, { onlyWhenPresent: false });
    expect(updated?.onlyWhenPresent).toBeUndefined();
    expect(updated?.awaySkips).toBeUndefined();
  });
});
