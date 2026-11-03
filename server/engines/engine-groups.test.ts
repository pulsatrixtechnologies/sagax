// An engine CLI's process group outlives a server that stops without closing
// it. The next start stops what an earlier run left, and only that.
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ListedProcess } from "../browser/browser-processes.ts";
import { orphanedEngineGroups, reapOrphanEngineGroups, recordedEngineGroups, resetEngineGroupsForTests } from "./engine-groups.ts";
import { killCliTree, spawnCli } from "../procs.ts";

const IDLE = "setInterval(() => {}, 1000)";

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const listed = (pgid: number, started = "s", zombie = false): ListedProcess => ({ ppid: 1, pgid, zombie, started });

describe("which recorded groups are leftovers", () => {
  it("stops the members of a group whose leader is gone", () => {
    const table = new Map([[501, listed(500)], [502, listed(500)], [600, listed(600)]]);
    expect(orphanedEngineGroups([{ pgid: 500, at: 0 }], table, 1)).toEqual([{ pgid: 500, members: [501, 502] }]);
  });

  it("stops a group whose leader still runs only when it is the process recorded", () => {
    const table = new Map([[500, listed(500, "Tue Oct 27 10:00:00 2026")], [501, listed(500)]]);
    expect(orphanedEngineGroups([{ pgid: 500, started: "Tue Oct 27 10:00:00 2026", at: 0 }], table, 1)).toHaveLength(1);
    // the pid went to another program since: never signalled
    expect(orphanedEngineGroups([{ pgid: 500, started: "Mon Oct 26 09:00:00 2026", at: 0 }], table, 1)).toEqual([]);
    // no start time was recorded: the leader cannot be told apart
    expect(orphanedEngineGroups([{ pgid: 500, at: 0 }], table, 1)).toEqual([]);
  });

  it("skips a group with nothing left, and the server itself", () => {
    const table = new Map([[700, listed(700, "x", true)], [42, listed(42)]]);
    expect(orphanedEngineGroups([{ pgid: 700, at: 0 }, { pgid: 42, at: 0 }], table, 42)).toEqual([]);
  });
});

describe.skipIf(process.platform === "win32")("at start", () => {
  const dirs: string[] = [];
  const pids: number[] = [];
  afterEach(() => {
    resetEngineGroupsForTests();
    for (const pid of pids.splice(0)) if (alive(pid)) process.kill(pid, "SIGKILL");
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("stops the sub-agents an earlier run's engine left behind", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-engine-groups-"));
    dirs.push(dir);
    // A stand-in engine in its own group: starts a helper, reports it, exits.
    // The helper stays, re-parented to init, as after a server crash.
    const leader = spawn(process.execPath, ["-e",
      `const c = require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(IDLE)}], { stdio: "ignore" }); console.log(c.pid); process.exit(0);`,
    ], { detached: true, stdio: ["ignore", "pipe", "ignore"] });
    const helper = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("helper did not report its pid")), 10_000);
      leader.stdout!.once("data", (chunk) => { clearTimeout(timer); resolve(Number(String(chunk).trim())); });
    });
    pids.push(helper);
    await new Promise((resolve) => leader.once("exit", resolve));
    expect(alive(helper)).toBe(true);

    const registry = join(dir, "engine-groups.json");
    writeFileSync(registry, JSON.stringify({ version: 1, groups: [{ pgid: leader.pid, at: Date.now() }] }));
    const lines: string[] = [];
    await expect(reapOrphanEngineGroups(registry, { graceMs: 2_000, log: (line) => lines.push(line) })).resolves.toBe(1);
    await expect.poll(() => alive(helper), { timeout: 5_000 }).toBe(false);
    expect(lines[0]).toMatch(/stopped 1 process group/);
    // what was stopped is no longer listed
    expect(JSON.parse(readFileSync(registry, "utf8")).groups).toEqual([]);
  }, 30_000);

  it("lists an engine's group while it runs, and forgets it once the group is gone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sagax-engine-groups-"));
    dirs.push(dir);
    await reapOrphanEngineGroups(join(dir, "engine-groups.json"));
    const child = spawnCli(process.execPath, ["-e", IDLE], { stdio: ["pipe", "pipe", "pipe"] });
    pids.push(child.pid!);
    expect(recordedEngineGroups()).toContain(child.pid);
    await expect.poll(() => (JSON.parse(readFileSync(join(dir, "engine-groups.json"), "utf8")).groups as Array<{ pgid: number }>).map((group) => group.pgid)).toContain(child.pid);
    await killCliTree(child);
    await expect.poll(() => recordedEngineGroups().includes(child.pid!), { timeout: 10_000 }).toBe(false);
  }, 30_000);
});
