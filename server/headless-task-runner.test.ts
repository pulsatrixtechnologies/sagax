import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { applyTeam, giveTask, readQueue, runnerPath, settleTask, waitTask, type HeadlessBot, type HeadlessTask } from "./cli/headless-cli.ts";
import { claimHeadlessTasks, createHeadlessTaskRunner, type HeadlessRunOutcome } from "./headless-task-runner.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function folder(bots: HeadlessBot[] = [{ name: "Ada" }, { name: "Bea" }]): string {
  const dir = mkdtempSync(join(tmpdir(), "sagax-headless-runner-"));
  dirs.push(dir);
  applyTeam(dir, bots);
  return dir;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("headless task runner", () => {
  it("runs a queued task once on its bot and settles it with the reply", async () => {
    const dir = folder();
    const given = giveTask(dir, "Ada", "Summarize the notes");
    const runs: HeadlessTask[] = [];
    const gate = deferred<HeadlessRunOutcome>();
    const runner = createHeadlessTaskRunner({
      dir,
      bootId: "boot-1",
      run: async (task, place) => {
        runs.push(task);
        place({ botId: "bot-ada", threadId: "thread-1" });
        return gate.promise;
      },
    });
    await runner.tick();
    // a second pass while it runs never takes it again
    await runner.tick();
    await runner.tick();
    expect(runs.map((task) => task.id)).toEqual([given.id]);
    expect(readQueue(dir)[0]).toMatchObject({ state: "running", runner: "boot-1", attempts: 1, botId: "bot-ada", threadId: "thread-1" });
    expect(existsSync(runnerPath(dir))).toBe(true);
    gate.resolve({ ok: true, text: "two pages" });
    await runner.idle();
    await expect(waitTask(dir, given.id, 0)).resolves.toMatchObject({ ok: true, state: "done", result: "two pages", bot: "Ada", threadId: "thread-1" });
    runner.stop();
    expect(existsSync(runnerPath(dir))).toBe(false);
  });

  it("fails a task with the reason: an unknown bot, an engine error, a throw", async () => {
    const dir = folder();
    const unknown = giveTask(dir, "Ada", "a");
    const engine = giveTask(dir, "Bea", "b");
    const runner = createHeadlessTaskRunner({
      dir,
      bootId: "boot-1",
      run: async (task) => {
        if (task.id === unknown.id) return { ok: false, reason: "No bot named Ada here." };
        throw new Error("engine crashed");
      },
    });
    await runner.tick();
    await runner.idle();
    await expect(waitTask(dir, unknown.id, 0)).resolves.toMatchObject({ ok: false, state: "failed", result: "No bot named Ada here." });
    await expect(waitTask(dir, engine.id, 0)).resolves.toMatchObject({ ok: false, state: "failed", result: "engine crashed" });
    runner.stop();
  });

  it("queues again what a stopped server left running, and fails it after too many stops", async () => {
    const dir = folder();
    const given = giveTask(dir, "Ada", "a");
    expect(claimHeadlessTasks(dir, "boot-1", 1).map((task) => task.id)).toEqual([given.id]);
    // the same start never takes it twice
    expect(claimHeadlessTasks(dir, "boot-1", 2)).toEqual([]);
    // a new start takes it again
    expect(claimHeadlessTasks(dir, "boot-2", 3).map((task) => task.attempts)).toEqual([2]);
    // a late settle from the old start changes nothing
    expect(settleTask(dir, given.id, "done", "late", "boot-1")).toBe(false);
    expect(readQueue(dir)[0]).toMatchObject({ state: "running", runner: "boot-2" });
    expect(claimHeadlessTasks(dir, "boot-3", 4, 3).map((task) => task.attempts)).toEqual([3]);
    expect(claimHeadlessTasks(dir, "boot-4", 5, 3)).toEqual([]);
    expect(readQueue(dir)[0]).toMatchObject({ state: "failed" });
    expect(readQueue(dir)[0]!.result).toMatch(/stopped while this task ran, 3 times/);
  });

  it("resumes after a restart: the next server runs the task to the end", async () => {
    const dir = folder();
    const given = giveTask(dir, "Ada", "a");
    const first = createHeadlessTaskRunner({ dir, bootId: "boot-1", run: () => new Promise<HeadlessRunOutcome>(() => {}) });
    await first.tick();
    first.stop(); // the server stopped mid turn
    const second = createHeadlessTaskRunner({ dir, bootId: "boot-2", run: async () => ({ ok: true, text: "finished" }) });
    await second.tick();
    await second.idle();
    await expect(waitTask(dir, given.id, 0)).resolves.toMatchObject({ ok: true, result: "finished" });
    expect(readQueue(dir)[0]).toMatchObject({ attempts: 2 });
    second.stop();
  });

  it("runs one turn at a time per bot, and bots side by side", async () => {
    const dir = folder();
    const a1 = giveTask(dir, "Ada", "1");
    const a2 = giveTask(dir, "Ada", "2");
    const b1 = giveTask(dir, "Bea", "3");
    const started: string[] = [];
    const gates = new Map<string, ReturnType<typeof deferred<HeadlessRunOutcome>>>();
    const runner = createHeadlessTaskRunner({
      dir,
      bootId: "boot-1",
      run: (task) => {
        started.push(task.id);
        const gate = deferred<HeadlessRunOutcome>();
        gates.set(task.id, gate);
        return gate.promise;
      },
    });
    await runner.tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(started).toEqual([a1.id, b1.id]);
    gates.get(a1.id)!.resolve({ ok: true, text: "one" });
    await expect.poll(() => started).toEqual([a1.id, b1.id, a2.id]);
    gates.get(a2.id)!.resolve({ ok: true, text: "two" });
    gates.get(b1.id)!.resolve({ ok: true, text: "three" });
    await runner.idle();
    expect(readQueue(dir).map((task) => task.result)).toEqual(["one", "two", "three"]);
    runner.stop();
  });

  it("applies the team at start and again when the team file changes", async () => {
    const dir = folder([{ name: "Ada" }]);
    const synced: string[][] = [];
    const runner = createHeadlessTaskRunner({ dir, bootId: "boot-1", syncTeam: (bots) => { synced.push(bots.map((bot) => bot.name)); }, run: async () => ({ ok: true, text: "" }) });
    await runner.tick();
    await runner.tick();
    expect(synced).toEqual([["Ada"]]);
    await new Promise((resolve) => setTimeout(resolve, 15));
    applyTeam(dir, [{ name: "Ada" }, { name: "Cy", title: "Writer" }]);
    await runner.tick();
    expect(synced).toEqual([["Ada"], ["Ada", "Cy"]]);
    runner.stop();
  });

  // #4128: a workspace backup copies the data folder while the server runs;
  // the beat and the queue, rewritten every second, failed the copy
  it("writes nothing while a backup holds it paused, and picks up again on resume", async () => {
    const dir = folder();
    const team = deferred<void>();
    const runs: string[] = [];
    const runner = createHeadlessTaskRunner({ dir, bootId: "boot-1", syncTeam: () => team.promise, run: async (task) => { runs.push(task.id); return { ok: true, text: "done" }; } });
    // a tick under way when the backup starts takes nothing once it pauses
    const queued = giveTask(dir, "Ada", "Draft the summary");
    const underWay = runner.tick();
    runner.pause();
    team.resolve();
    await underWay;
    expect(readQueue(dir)[0]).toMatchObject({ id: queued.id, state: "queued" });
    runner.resume();
    // beating on its timer, it takes the task
    runner.start(5);
    await vi.waitFor(() => expect(runs).toEqual([queued.id]));
    await runner.idle();
    // paused: no beat and no queue write, on its timer or when a tick is asked for
    runner.pause();
    const later = giveTask(dir, "Bea", "Check the totals");
    const beatBefore = readFileSync(runnerPath(dir), "utf8");
    const queueBefore = readFileSync(join(dir, "headless-tasks.json"), "utf8");
    await runner.tick();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(readFileSync(runnerPath(dir), "utf8")).toBe(beatBefore);
    expect(readFileSync(join(dir, "headless-tasks.json"), "utf8")).toBe(queueBefore);
    expect(runs).toEqual([queued.id]);
    // the beat file stays, so a short backup never reads as "no server"
    expect(existsSync(runnerPath(dir))).toBe(true);
    runner.resume();
    await vi.waitFor(() => expect(runs).toEqual([queued.id, later.id]));
    await runner.idle();
    expect(readQueue(dir).map((task) => task.state)).toEqual(["done", "done"]);
    runner.stop();
  });
});
