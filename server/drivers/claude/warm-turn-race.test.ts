// #3703: a person's message sent while a pre-warm of the same conversation
// is still starting its engine must always end in a reply or a readable
// error. The composer's pre-warm (a typing warm, then its cache prime) and
// the turn can each relaunch the thread's process at the same moment.
import { chmodSync, existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ensureDirs } from "../../config.ts";
import type { ProviderInstance } from "../../contracts.ts";
import { spawnHelperPid, startSpawnHelper, stopSpawnHelper } from "../../process/spawn-helper.ts";
import { recordEvents, type EventRecorder } from "../../testing/events.ts";
import { removeTempDir } from "../../testing/cleanup.ts";
import { ClaudeDriver } from "../claude.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "testing", "fake-claude-cli.ts");

describe("a turn racing a pre-warm of the same thread (#3703)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  beforeEach(async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-claude-race-"));
    instance = await ClaudeDriver.create({
      instanceId: "claude-race",
      displayName: "Claude Race",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: "acceptEdits" },
    });
    recorder = recordEvents(instance.adapter);
  });

  afterEach(async () => {
    delete process.env.FAKE_CLAUDE_LAUNCH_LOG;
    delete process.env.FAKE_CLAUDE_PROMPTS;
    recorder?.stop();
    await instance?.dispose();
    await removeTempDir(scratch);
  });

  const launches = (path: string): Array<{ pid: number }> => existsSync(path)
    ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { pid: number })
    : [];
  const alive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  it("answers the turn when a warm with another spawn contract relaunches the process at the same time", async () => {
    const launchLog = join(scratch, "launches.jsonl");
    process.env.FAKE_CLAUDE_LAUNCH_LOG = launchLog;
    const threadId = "t-race";
    // The conversation was opened: a warm process is up.
    await instance.adapter.sendTurn({ threadId, text: "", warmOnly: true, system: "opened" });
    // The person types (a warm whose contract differs, e.g. its cache prime)
    // and sends before that warm is up (a turn whose contract differs again).
    const window = new AbortController();
    const warming = instance.adapter.sendTurn({ threadId, text: "", warmOnly: true, warmSignal: window.signal, system: "typing" });
    const sent = await instance.adapter.sendTurn({ threadId, text: "hello", system: "turn" });
    await warming;
    const done = await recorder.until((event) => event.type === "turn.completed" && event.turnId === sent.turnId, 15_000);
    expect(done).toMatchObject({ ok: true });
    // The reply came from the process the turn runs on; no process the
    // driver no longer tracks is left behind.
    window.abort();
    instance.adapter.releaseWarmSession?.(threadId);
    await expect.poll(() => launches(launchLog).filter((row) => alive(row.pid)).length, { timeout: 10_000 }).toBe(0);
  });

  // #4049: with the spawn helper on (the Linux server), a process that fails
  // to start (its folder was deleted) left the first message's write
  // unanswered, so the thread's launch slot was never released and every
  // later message on the thread waited forever.
  describe.runIf(process.platform !== "win32")("on the spawn helper", () => {
    beforeAll(() => startSpawnHelper());
    afterAll(() => stopSpawnHelper());

    it("tells the start error and answers the next message on the same thread", async () => {
      expect(spawnHelperPid()).toBeGreaterThan(0);
      const threadId = "t-start-failed";
      const failed = await withTimeout(instance.adapter.sendTurn({ threadId, text: "hello", cwd: join(scratch, "deleted-folder") }));
      expect(failed).not.toBe("timed out");
      await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === (failed as { turnId: string }).turnId, 10_000))
        .resolves.toMatchObject({ ok: false });
      const next = await withTimeout(instance.adapter.sendTurn({ threadId, text: "hello again", cwd: scratch }));
      expect(next).not.toBe("timed out");
      await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === (next as { turnId: string }).turnId, 15_000))
        .resolves.toMatchObject({ ok: true });
    });
  });
});

const withTimeout = <T>(work: Promise<T>, ms = 10_000): Promise<T | "timed out"> => {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([work, new Promise<"timed out">((resolve) => { timer = setTimeout(() => resolve("timed out"), ms); })])
    .finally(() => clearTimeout(timer));
};
