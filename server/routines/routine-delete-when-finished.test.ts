import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { scheduleHasKnownEnd } from "../../shared/routines.ts";
import { RoutineManager } from "./routines.ts";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function harness(start: number) {
  let now = start;
  let task = 0;
  const started: string[] = [];
  const deleted: string[] = [];
  const manager = new RoutineManager({
    file: (() => {
      const dir = mkdtempSync(join(tmpdir(), "omb-delete-finished-"));
      dirs.push(dir);
      mkdirSync(dir, { recursive: true });
      return join(dir, "routines.json");
    })(),
    now: () => now,
    emit: (payload) => {
      if (payload.kind === "routine.deleted") deleted.push(String(payload.routineId));
    },
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${++task}` }),
    startTurn: async (_botId, threadId) => { started.push(threadId); },
  });
  return {
    manager,
    started,
    deleted,
    setNow: (value: number) => { now = value; },
    finish: (threadId: string, ok = true) => manager.handleRuntimeEvent({
      eventId: `done-${threadId}`,
      provider: "fake",
      threadId,
      createdAt: new Date().toISOString(),
      type: "turn.completed",
      ok,
    }),
  };
}

describe("scheduleHasKnownEnd", () => {
  it("is true for once and for an interval with endsAt", () => {
    expect(scheduleHasKnownEnd({ type: "once" })).toBe(true);
    expect(scheduleHasKnownEnd({ type: "interval", endsAt: 2 })).toBe(true);
    expect(scheduleHasKnownEnd({ type: "interval" })).toBe(false);
    expect(scheduleHasKnownEnd({ type: "daily" })).toBe(false);
    expect(scheduleHasKnownEnd({ type: "cron" })).toBe(false);
    expect(scheduleHasKnownEnd({ type: "webhook" })).toBe(false);
  });
});

describe("deleteWhenFinished (#1648)", () => {
  const start = Date.parse("2026-10-31T12:00:00Z");

  it("is off by default and ignored on a schedule with no known end", () => {
    const h = harness(start);
    const open = h.manager.create({
      name: "Hourly", prompt: "Report", botId: "bot-1",
      schedule: { type: "interval", everyMinutes: 60, anchorAt: start },
      deleteWhenFinished: true,
    });
    expect(open.deleteWhenFinished).toBeUndefined();
    const once = h.manager.create({
      name: "Once", prompt: "Do it", botId: "bot-1",
      schedule: { type: "once", at: start + 60_000 },
      deleteWhenFinished: true,
    });
    expect(once.deleteWhenFinished).toBe(true);
  });

  it("deletes a one-time routine after its scheduled run settles, including a failed run", async () => {
    const h = harness(start);
    const routine = h.manager.create({
      name: "Once", prompt: "Do it", botId: "bot-1",
      schedule: { type: "once", at: start + 60_000 },
      deleteWhenFinished: true,
    });
    h.setNow(start + 60_000);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
    expect(h.manager.listRoutines().some((row) => row.id === routine.id)).toBe(true);
    h.finish(h.started[0]!, false);
    expect(h.deleted).toContain(routine.id);
    expect(h.manager.listRoutines().some((row) => row.id === routine.id)).toBe(false);
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  it("waits while a run is still queued or running", async () => {
    const h = harness(start);
    const routine = h.manager.create({
      name: "Once", prompt: "Do it", botId: "bot-1",
      schedule: { type: "once", at: start + 60_000 },
      deleteWhenFinished: true,
    });
    h.setNow(start + 60_000);
    await h.manager.tick();
    expect(h.manager.listRuns()[0]?.status).toBe("running");
    expect(h.deleted).toHaveLength(0);
    h.finish(h.started[0]!);
    expect(h.deleted).toContain(routine.id);
  });

  it("does not delete a paused one-time routine that never ran", () => {
    const h = harness(start);
    const routine = h.manager.create({
      name: "Once", prompt: "Do it", botId: "bot-1",
      schedule: { type: "once", at: start + 60_000 },
      deleteWhenFinished: true,
    });
    h.manager.update(routine.id, { enabled: false });
    expect(h.deleted).toHaveLength(0);
    expect(h.manager.listRoutines().some((row) => row.id === routine.id)).toBe(true);
  });

  it("does not delete an auto-paused recurring routine that still has future runs", async () => {
    const h = harness(start);
    const routine = h.manager.create({
      name: "Digest", prompt: "Summarize", botId: "bot-1",
      schedule: { type: "interval", everyMinutes: 15, anchorAt: start, endsAt: start + 24 * 60 * 60_000 },
      deleteWhenFinished: true,
      autoPauseAfter: 1,
    });
    h.setNow(routine.nextRunAt!);
    await h.manager.tick();
    h.finish(h.started[0]!, false);
    expect(h.manager.listRoutines().find((row) => row.id === routine.id)?.enabled).toBe(false);
    expect(h.deleted).toHaveLength(0);
  });

  it("deletes an interval after endsAt once the last run settles", async () => {
    // Create before the anchor so the first (and only) slot is still in the future.
    const h = harness(start - 60_000);
    const endsAt = start + 5 * 60_000;
    const routine = h.manager.create({
      name: "Burst", prompt: "Check", botId: "bot-1",
      schedule: { type: "interval", everyMinutes: 60, anchorAt: start, endsAt },
      deleteWhenFinished: true,
    });
    expect(routine.nextRunAt).toBe(start);
    h.setNow(start);
    await h.manager.tick();
    expect(h.started).toHaveLength(1);
    expect(h.manager.listRoutines().find((row) => row.id === routine.id)?.nextRunAt ?? null).toBeNull();
    expect(h.deleted).toHaveLength(0);
    h.finish(h.started[0]!);
    expect(h.deleted).toContain(routine.id);
    expect(h.manager.listRuns().filter((run) => run.routineId === routine.id)).toHaveLength(1);
  });

  it("keeps an interval with a later endsAt until that cutoff is exhausted", async () => {
    const h = harness(start - 60_000);
    const endsAt = start + 2 * 60 * 60_000;
    const routine = h.manager.create({
      name: "Burst", prompt: "Check", botId: "bot-1",
      schedule: { type: "interval", everyMinutes: 60, anchorAt: start, endsAt },
      deleteWhenFinished: true,
    });
    h.setNow(start);
    await h.manager.tick();
    h.finish(h.started[0]!);
    expect(h.deleted).toHaveLength(0);
    expect(h.manager.listRoutines().find((row) => row.id === routine.id)?.nextRunAt).toBe(start + 60 * 60_000);
  });
});
