import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RoutineManager } from "./routines.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const START = Date.parse("2026-11-08T12:00:00Z");
const HOUR = 3_600_000;

function harness() {
  let now = START;
  let task = 0;
  const prompts: string[] = [];
  const dir = mkdtempSync(join(tmpdir(), "omb-goal-"));
  dirs.push(dir);
  const manager = new RoutineManager({
    file: join(dir, "routines.json"),
    now: () => now,
    emit: () => {},
    botState: () => "ready",
    createTask: () => ({ threadId: `thread-${++task}` }),
    startTurn: async (_botId, _threadId, prompt) => { prompts.push(String(prompt)); },
  });
  return {
    manager,
    prompts,
    setNow: (value: number) => { now = value; },
    finish: (threadId: string, text: string) => {
      const base = { eventId: `e-${threadId}-${Math.random()}`, provider: "fake", threadId, createdAt: new Date(now).toISOString() } as const;
      manager.handleRuntimeEvent({ ...base, type: "item.completed", itemType: "assistant_text", text });
      manager.handleRuntimeEvent({ ...base, eventId: `${base.eventId}-done`, type: "turn.completed", ok: true });
    },
  };
}

describe("goal routines (#2696)", () => {
  it("tells the run its goal, follows the bot's next check and stops once reached", async () => {
    const h = harness();
    const routine = h.manager.create({
      name: "Backup to 100%", prompt: "Watch the backup job.", botId: "bot-1",
      schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      goal: "Backup job at 100%",
    });
    expect(h.manager.listRoutines()[0]!.goal).toMatchObject({ text: "Backup job at 100%", status: "active" });

    h.manager.runNow(routine.id); await h.manager.tick();
    expect(h.prompts[0]).toContain("<goal>Backup job at 100%</goal>");
    const first = h.manager.listRuns()[0]!;
    h.finish(first.threadId!, "Backup at 82%.\nGOAL_STATUS: in_progress: 82%\nNEXT_CHECK: in 3h");
    expect(h.manager.listRuns()[0]!.output).toBe("Backup at 82%.");
    const after = h.manager.listRoutines()[0]!;
    expect(after.goal).toMatchObject({ status: "active", progress: "82%", checks: 1 });
    expect(after.nextRunAt).toBe(START + 3 * HOUR);

    h.setNow(START + 3 * HOUR);
    await h.manager.tick();
    const second = h.manager.listRuns().find((run) => run.id !== first.id)!;
    h.finish(second.threadId!, "Done, 100%.\nGOAL_STATUS: achieved: 100%");
    const done = h.manager.listRoutines()[0]!;
    expect(done.goal).toMatchObject({ status: "achieved", progress: "100%", checks: 2 });
    expect(done.enabled).toBe(false);
    expect(done.nextRunAt).toBeNull();
  });

  it("never starts a run past the deadline and closes the routine with a final report", async () => {
    const h = harness();
    const routine = h.manager.create({
      name: "Deadline", prompt: "Watch.", botId: "bot-1",
      schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] },
      goal: { text: "Reach 100%", deadline: START + 2 * HOUR },
    });
    h.manager.runNow(routine.id); await h.manager.tick();
    const first = h.manager.listRuns()[0]!;
    // The bot asks to look again well after the deadline: clamped onto it.
    h.finish(first.threadId!, "78,95 %.\nGOAL_STATUS: in_progress: 78,95 %\nNEXT_CHECK: in 2d");
    expect(h.manager.listRoutines()[0]!.nextRunAt).toBe(START + 2 * HOUR);
    // The computer was asleep: it wakes an hour past the deadline.
    h.setNow(START + 3 * HOUR);
    await h.manager.tick();
    expect(h.prompts).toHaveLength(1);
    const done = h.manager.listRoutines()[0]!;
    expect(done.goal).toMatchObject({ status: "expired", expiredAt: START + 3 * HOUR });
    expect(done.enabled).toBe(false);
    expect(done.nextRunAt).toBeNull();
    const closing = h.manager.listRuns().find((run) => run.id !== first.id)!;
    expect(closing).toMatchObject({ status: "completed" });
    expect(closing.output).toContain("Last progress: 78,95 %");
    expect(closing.problems).toContain("deadline passed");
    expect(closing.threadId).toBeUndefined();
  });

  it("closes at the deadline even when the fallback cadence is due later", async () => {
    const h = harness();
    h.manager.create({
      name: "Weekly", prompt: "Watch.", botId: "bot-1",
      schedule: { type: "daily", time: "09:00", weekdays: [1] },
      goal: { text: "Reach 100%", deadline: START + HOUR },
    });
    h.setNow(START + 2 * HOUR);
    await h.manager.tick();
    expect(h.prompts).toHaveLength(0);
    expect(h.manager.listRoutines()[0]!.goal?.status).toBe("expired");
    expect(h.manager.listRuns()).toHaveLength(1);
  });

  it("a one-time goal whose bot named no next check looks again a day later", async () => {
    const h = harness();
    const routine = h.manager.create({
      name: "Once", prompt: "Watch.", botId: "bot-1",
      schedule: { type: "once", at: START + HOUR },
      goal: "Reach 100%",
    });
    h.setNow(START + HOUR);
    await h.manager.tick();
    const first = h.manager.listRuns().find((run) => run.routineId === routine.id)!;
    h.finish(first.threadId!, "At 40%.\nGOAL_STATUS: in_progress: 40%");
    const after = h.manager.listRoutines()[0]!;
    expect(after.goal).toMatchObject({ status: "active", progress: "40%" });
    expect(after.enabled).toBe(true);
    expect(after.nextRunAt).toBe(START + HOUR + 24 * HOUR);
  });

  it("keeps the progress when an update repeats the goal and clears it on null", () => {
    const h = harness();
    const routine = h.manager.create({ name: "G", prompt: "p", botId: "bot-1", schedule: { type: "daily", time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] }, goal: { text: "Reach 100%" } });
    h.manager.update(routine.id, { goal: { text: "Reach 100%" } });
    expect(h.manager.listRoutines()[0]!.goal?.status).toBe("active");
    h.manager.update(routine.id, { goal: null });
    expect(h.manager.listRoutines()[0]!.goal).toBeUndefined();
  });
});
