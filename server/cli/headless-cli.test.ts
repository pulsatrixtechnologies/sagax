import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyTeam, giveTask, parseTeamFile, readQueue, RUNNER_FRESH_MS, runnerAlive, runnerPath, settleTask, updateQueue, waitTask, withQueueLock } from "./headless-cli.ts";

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe("headless team commands", () => {
  it("applies a team from a file, queues a task, and waits without a window", async () => {
    const parsed = parseTeamFile(JSON.stringify({ bots: [{ name: "Ada", title: "Lead" }, { name: "Bea" }] }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const dir = mkdtempSync(join(tmpdir(), "sagax-headless-"));
    dirs.push(dir);
    expect(applyTeam(dir, parsed.bots)).toEqual({ ok: true, bots: 2 });
    const given = giveTask(dir, "Ada", "Summarize the notes");
    expect(given.state).toBe("queued");
    const pending = waitTask(dir, given.id, 30, async () => {});
    settleTask(dir, given.id, "done", "two pages");
    await expect(pending).resolves.toEqual({ ok: true, id: given.id, state: "done", result: "two pages", bot: "Ada" });
    settleTask(dir, given.id, "failed", "blocked");
    await expect(waitTask(dir, given.id, 10, async () => {})).resolves.toMatchObject({ ok: false, state: "failed" });
    await expect(waitTask(dir, "missing", 0, async () => {})).resolves.toMatchObject({ state: "not_found" });
    expect(() => giveTask(dir, "Nobody", "hi")).toThrow(/applied team/);
    writeFileSync(join(dir, "nope.json"), "not json");
    expect(parseTeamFile("not json").ok).toBe(false);
  });

  it("refuses a task before any team, and matches the bot name without case", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-headless-"));
    dirs.push(dir);
    expect(() => giveTask(dir, "Ada", "hi")).toThrow(/team apply/);
    applyTeam(dir, [{ name: "Ada" }]);
    const given = giveTask(dir, "ada", "hi");
    expect(readQueue(dir).find((task) => task.id === given.id)?.bot).toBe("Ada");
  });

  it("says no server runs instead of waiting in silence", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-headless-"));
    dirs.push(dir);
    applyTeam(dir, [{ name: "Ada" }]);
    const given = giveTask(dir, "Ada", "hi");
    let clock = 1_000;
    const result = await waitTask(dir, given.id, 60_000, async (ms) => { clock += ms; }, { requireRunner: true, noRunnerGraceMs: 1_000, now: () => clock });
    expect(result).toMatchObject({ ok: false, state: "no_server" });
    expect((result as { error: string }).error).toMatch(/No Sagax server is running/);
    expect(clock).toBeLessThan(5_000);
  });

  it("keeps waiting while a server beats, and a timeout says where the task is", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-headless-"));
    dirs.push(dir);
    applyTeam(dir, [{ name: "Ada" }]);
    const given = giveTask(dir, "Ada", "hi");
    let clock = Date.now();
    const beat = () => writeFileSync(runnerPath(dir), JSON.stringify({ pid: process.pid, at: clock }));
    beat();
    const result = await waitTask(dir, given.id, 20_000, async (ms) => { clock += ms; beat(); }, { requireRunner: true, now: () => clock });
    expect(result).toEqual({ ok: false, id: given.id, state: "timeout", current: "queued" });
    expect(runnerAlive(dir, clock)).toBe(true);
    expect(runnerAlive(dir, clock + RUNNER_FRESH_MS + 1)).toBe(false);
  });

  it("takes over a lock a dead process left, and keeps every task", () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-headless-"));
    dirs.push(dir);
    applyTeam(dir, [{ name: "Ada" }]);
    const first = giveTask(dir, "Ada", "one");
    const lock = join(dir, "headless-tasks.lock");
    writeFileSync(lock, "999999");
    utimesSync(lock, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
    updateQueue(dir, (tasks) => { tasks[0]!.state = "running"; });
    const second = giveTask(dir, "Ada", "two");
    expect(readQueue(dir).map((task) => [task.id, task.state])).toEqual([[first.id, "running"], [second.id, "queued"]]);
    expect(withQueueLock(dir, () => 7)).toBe(7);
  });
});
