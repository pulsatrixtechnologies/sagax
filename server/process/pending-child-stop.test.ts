// #3709: a child the spawn helper started gets its pid a moment after the
// call. Every stop that runs before the pid is there must still reach the
// child's whole process group, not the child alone.
//
// The window is made exact: the main thread is held after the start, so the
// helper has already started the child (and the child its own child) while
// the server has not read the pid yet; the stop then runs in that state.
import type { ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { ClaudeLoginController } from "../drivers/claude-login-auth.ts";
import { codexAccountEmail } from "../drivers/codex-identity.ts";
import { DeviceAuthController } from "../drivers/device-auth.ts";
import { LinkSignInController } from "../drivers/link-sign-in.ts";
import { runLoginShellProbe } from "../env-path.ts";
import { spawnCli } from "../procs.ts";
import { createRunCommand } from "../remote-support/remote-session-probe.ts";
import { spawnLocalWatch } from "../routines/routine-watch.ts";
import { startSpawnHelper, stopSpawnHelper } from "./spawn-helper.ts";

const posix = process.platform !== "win32";

/** Holds the main thread: the helper's reply with the pid stays unread. */
function holdMainThread(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

describe.runIf(posix)("a stop before the spawn helper has the pid (#3709)", { timeout: 15_000 }, () => {
  let dir: string;
  let pidFile: string;
  /** a shell line that starts a child of its own, notes its pid and waits */
  let line: string;
  let script: string;

  beforeAll(() => startSpawnHelper({ log: () => {} }));
  afterAll(() => stopSpawnHelper());

  const fresh = () => {
    dir = mkdtempSync(join(tmpdir(), "pending-stop-"));
    pidFile = join(dir, "grandchild");
    line = `sleep 30 & echo $! > '${pidFile}'; wait`;
    script = join(dir, "cli.sh");
    writeFileSync(script, `#!/bin/sh\n${line}\n`);
    chmodSync(script, 0o755);
  };

  afterEach(() => {
    // never leave the child's child behind, whatever the test saw
    if (existsSync(pidFile)) {
      const pid = Number(readFileSync(pidFile, "utf8").trim());
      if (pid > 1 && alive(pid)) process.kill(pid, "SIGKILL");
    }
    rmSync(dir, { recursive: true, force: true });
  });

  /** The child's child was running when the stop came, and is gone after it. */
  const expectGroupStopped = async () => {
    expect(existsSync(pidFile)).toBe(true);
    const grandchild = Number(readFileSync(pidFile, "utf8").trim());
    expect(await until(() => !alive(grandchild), 3_000)).toBe(true);
  };

  const startedCli = (): ChildProcess => {
    const child = spawnCli(script, [], { stdio: ["pipe", "pipe", "pipe"] });
    expect(child.pid).toBeUndefined();
    holdMainThread(800);
    expect(child.pid).toBeUndefined();
    return child;
  };

  it("device sign-in: a cancel stops the whole group", async () => {
    fresh();
    const controller = new DeviceAuthController({} as never, { cli: script, terminateTimeoutMs: 500 } as never);
    const child = startedCli();
    expect(await (controller as unknown as { stopChild(child: ChildProcess): Promise<boolean> }).stopChild(child)).toBe(true);
    await expectGroupStopped();
  });

  it("link sign-in: a cancel stops the whole group", async () => {
    fresh();
    const controller = new LinkSignInController({} as never, { cli: script, terminateTimeoutMs: 500 } as never);
    const child = startedCli();
    expect(await (controller as unknown as { stopChild(child: ChildProcess): Promise<boolean> }).stopChild(child)).toBe(true);
    await expectGroupStopped();
  });

  it("Claude sign-in: a cancel stops the whole group", async () => {
    fresh();
    const controller = new ClaudeLoginController({ cli: script, terminateTimeoutMs: 500 } as never);
    const child = startedCli();
    expect(await (controller as unknown as { stopChild(child: ChildProcess): Promise<boolean> }).stopChild(child)).toBe(true);
    await expectGroupStopped();
  });

  it("account identity read: its time limit stops the whole group", async () => {
    fresh();
    const read = codexAccountEmail(script, { PATH: process.env.PATH, HOME: dir, CODEX_HOME: join(dir, ".codex") }, 1);
    holdMainThread(800);
    expect(await read).toBeNull();
    await expectGroupStopped();
  });

  it("routine watch: an abort stops the whole group", async () => {
    fresh();
    const abort = new AbortController();
    const run = spawnLocalWatch(line, dir, { timeoutMs: 60_000, maxOutputBytes: 1_000, signal: abort.signal });
    holdMainThread(800);
    abort.abort();
    await expectGroupStopped();
    expect((await run).timedOut).toBe(true);
  });

  it("remote support command: an abort stops the whole group", async () => {
    fresh();
    const abort = new AbortController();
    const run = createRunCommand({ killGraceMs: 30_000, releaseMs: 500 })(["/bin/sh", "-c", line], 60_000, { signal: abort.signal });
    holdMainThread(800);
    abort.abort();
    await expectGroupStopped();
    await run;
  });

  it("login shell probe: its deadline stops the whole group", async () => {
    fresh();
    runLoginShellProbe("/bin/sh", 1, () => {}, ["-c", line]);
    holdMainThread(800);
    await expectGroupStopped();
  });
});
