import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

function harness(dir = mkdtempSync(join(tmpdir(), "omb-goal-"))) {
  let now = START;
  let task = 0;
  const prompts: string[] = [];
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
    dir,
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

describe("the /goal line (#4098)", () => {
  const DAILY = { type: "daily" as const, time: "09:00", weekdays: [0, 1, 2, 3, 4, 5, 6] };

  it("a goal input lands as the line, and the run reads its instructions without it", async () => {
    const h = harness();
    const routine = h.manager.create({ name: "G", prompt: "Watch the backup job.", botId: "bot-1", schedule: DAILY, goal: { text: "Backup job at 100%", deadline: START + 48 * HOUR } });
    expect(h.manager.listRoutines()[0]!.prompt).toBe(`/goal Backup job at 100%\n/deadline ${new Date(START + 48 * HOUR).toISOString()}\n\nWatch the backup job.`);
    h.manager.runNow(routine.id); await h.manager.tick();
    expect(h.prompts[0]).toContain("<goal>Backup job at 100%</goal>");
    expect(h.prompts[0]).toContain("Watch the backup job.");
    expect(h.prompts[0]).not.toMatch(/^\/goal /m);
    expect(h.prompts[0]).not.toMatch(/^\/deadline /m);
  });

  it("reads the goal from the instructions' line and keeps its progress when only the line moves", async () => {
    const h = harness();
    const routine = h.manager.create({ name: "G", prompt: "/goal Reach 100%\n\nWatch the job.", botId: "bot-1", schedule: DAILY });
    expect(h.manager.listRoutines()[0]!.goal).toEqual({ text: "Reach 100%", status: "active" });
    h.manager.runNow(routine.id); await h.manager.tick();
    h.finish(h.manager.listRuns()[0]!.threadId!, "At 40%.\nGOAL_STATUS: in_progress: 40%");
    expect(h.manager.listRoutines()[0]!.goal).toMatchObject({ progress: "40%", checks: 1 });

    h.manager.update(routine.id, { prompt: "Watch the job.\nReport the percentage.\n\n/goal Reach 100%" });
    expect(h.manager.listRoutines()[0]!.goal).toMatchObject({ text: "Reach 100%", status: "active", progress: "40%", checks: 1 });

    h.manager.update(routine.id, { prompt: "/goal Reach 95%\nWatch the job." });
    expect(h.manager.listRoutines()[0]!.goal).toEqual({ text: "Reach 95%", status: "active" });

    h.manager.update(routine.id, { prompt: "Watch the job." });
    expect(h.manager.listRoutines()[0]!.goal).toBeUndefined();
  });

  it("a goal only by its line still runs with the goal block", async () => {
    const h = harness();
    const routine = h.manager.create({ name: "G", prompt: "/goal Inbox at zero", botId: "bot-1", schedule: DAILY });
    h.manager.runNow(routine.id); await h.manager.tick();
    expect(h.manager.listRuns()[0]!.status).toBe("running");
    expect(h.prompts[0]).toContain("<goal>Inbox at zero</goal>");
    expect(h.prompts[0]).not.toMatch(/^\/goal /m);
  });

  it("writes a stored goal into its line once at load, its progress and revision kept", () => {
    const first = harness();
    const routine = first.manager.create({ name: "G", prompt: "Watch the job.", botId: "bot-1", schedule: DAILY, goal: "Reach 100%" });
    // A file from before the line: the goal is stored beside instructions that do not say it.
    const file = join(first.dir, "routines.json");
    const disk = JSON.parse(readFileSync(file, "utf8")) as { routines: Array<Record<string, unknown>> };
    disk.routines[0]!.prompt = "Watch the job.";
    disk.routines[0]!.goal = { text: "Reach\n100%", status: "active", checks: 3, progress: "78,95 %", stalled: 1 };
    writeFileSync(file, JSON.stringify(disk));

    const loaded = harness(first.dir).manager.listRoutines()[0]!;
    expect(loaded.prompt).toBe("/goal Reach 100%\n\nWatch the job.");
    expect(loaded.goal).toEqual({ text: "Reach 100%", status: "active", checks: 3, progress: "78,95 %", stalled: 1 });
    expect(loaded.updatedAt).toBe(routine.updatedAt);
    const saved = JSON.parse(readFileSync(file, "utf8")) as { routines: Array<{ prompt: string }> };
    expect(saved.routines[0]!.prompt).toBe("/goal Reach 100%\n\nWatch the job.");

    // Idempotent: a second load changes nothing.
    const again = harness(first.dir).manager.listRoutines()[0]!;
    expect(again.prompt).toBe(loaded.prompt);
    expect(again.goal).toEqual(loaded.goal);
  });
});
