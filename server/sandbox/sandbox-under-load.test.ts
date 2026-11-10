// #3440: many bots of one person in turns at once, against one server
// environment. Their commands ran past the environment's few places and were
// refused ("too many commands are running in this environment"), and a failed
// plugin copy said only "copy failed" and was sent again whole at the next
// turn of every bot. A bot's turn waits for its own copy, so the copy must
// not wait behind the other bots' commands either.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PluginCopyFailures, pluginCopyFailures, syncPluginsToSandbox, type SandboxPluginExec } from "./sandbox-plugins.ts";
import { SANDBOX_EXEC_SLOTS, SandboxExecQueue } from "./sandbox-exec-queue.ts";
import { MAX_CONCURRENT_EXECS, SandboxService } from "./sandboxd-core.ts";
import type { ExecRequest } from "./sandboxd-docker.ts";
import { FakeDocker } from "../testing/fake-docker.ts";
import { inProcessSandboxdClient } from "../testing/in-process-sandboxd.ts";
import { SandboxdRequestError } from "./user-sandbox-client.ts";
import { UserSandboxManager } from "./user-sandbox-manager.ts";
import { sandboxdConfigFromEnv } from "./user-sandbox-spec.ts";
import { callUserSandboxTool, type ToolExec } from "./user-sandbox-tools.ts";
import { createSyncPluginFoldersForTurn } from "../index-leaves/syncPluginFoldersForTurn.ts";
import { createSyncPluginsForTurn, PLUGIN_SYNC_EXEC_SLOTS, withPluginSyncSlot } from "../index-leaves/syncPluginsForTurn.ts";

const ALICE = "pr_00000000-0000-4000-8000-00000000000a";
const tick = (ms: number) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The environment: every command takes a little time, and the tests see how
 * many run at once and in what order they started. */
class SlowDocker extends FakeDocker {
  running = 0;
  peak = 0;
  started: Array<"command" | "copy"> = [];
  delayMs = 5;
  override async exec(name: string, exec: ExecRequest, maxBytes?: number, stdin?: Buffer) {
    // the provisioner's own reads (usage, disk) are not a person's commands
    if (exec.Cmd[0] !== "timeout") return super.exec(name, exec, maxBytes, stdin);
    this.running += 1;
    this.peak = Math.max(this.peak, this.running);
    this.started.push(exec.Env.some((entry) => entry.startsWith("SAGAX_DEST=") || entry.startsWith("SAGAX_PATH=")) ? "copy" : "command");
    try {
      await tick(this.delayMs);
      return await super.exec(name, exec, maxBytes, stdin);
    } finally {
      this.running -= 1;
    }
  }
}

let dir: string;
let docker: SlowDocker;
let service: SandboxService;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "sbx-load-"));
  docker = new SlowDocker();
  service = new SandboxService(docker, sandboxdConfigFromEnv({ SAGAX_SANDBOX_IMAGE: "sagax-sandbox:test" }));
  await service.installEgressPolicy();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function pluginFolder(name: string, bytes: number): { name: string; dir: string } {
  const folder = join(dir, name);
  mkdirSync(join(folder, ".claude-plugin"), { recursive: true });
  writeFileSync(join(folder, ".claude-plugin", "plugin.json"), JSON.stringify({ name }));
  // random bytes do not compress: the archive takes several commands
  writeFileSync(join(folder, "payload.bin"), randomBytes(bytes));
  return { name, dir: folder };
}

describe("one person's environment under many bots at once (#3440)", () => {
  it("the server's line has the environment's own number of places", () => {
    expect(SANDBOX_EXEC_SLOTS).toBe(MAX_CONCURRENT_EXECS);
  });

  it("runs every command of fifteen bots while their plugin copies run, refuses none, and keeps the copies to two places", async () => {
    const manager = new UserSandboxManager({ client: inProcessSandboxdClient(service), instance: "default", stateFile: join(dir, "deletions.json") });
    await manager.exec(ALICE, { argv: ["true"] });
    docker.started = [];
    docker.peak = 0;
    const plugin = pluginFolder("flow", 1024 * 1024);
    const bots = Array.from({ length: 15 }, (_, index) => `bot-${index}`);
    // every bot's turn copies while every bot runs commands, through the
    // person's two copy places as in syncPluginsForTurn
    const slots = new Map();
    let copying = 0;
    let copyPeak = 0;
    const copies = bots.map((bot) => syncPluginsToSandbox([plugin], {
      exec: (input) => withPluginSyncSlot(slots, ALICE, async () => {
        copying += 1;
        copyPeak = Math.max(copyPeak, copying);
        try { return await manager.exec(ALICE, input, bot); } finally { copying -= 1; }
      }),
    }, "/workspace/sagax-plugins", { failures: new PluginCopyFailures(), scope: ALICE }));
    const commands = bots.flatMap((bot) => [0, 1, 2].map(() => manager.exec(ALICE, { argv: ["bash", "-lc", "echo ok"] }, bot)));
    const ran = await Promise.allSettled(commands);
    const refused = ran.filter((row) => row.status === "rejected").map((row) => String((row as PromiseRejectedResult).reason?.message));
    expect(refused).toEqual([]);
    expect(ran.every((row) => row.status === "fulfilled" && row.value.exitCode === 0)).toBe(true);
    const copied = await Promise.all(copies);
    expect(copied.every((row) => row.copied.includes("flow") && row.skipped.length === 0)).toBe(true);
    // never more at once than the environment runs, so it never refused one,
    // and the copies never held more than two places
    expect(docker.peak).toBeLessThanOrEqual(MAX_CONCURRENT_EXECS);
    expect(copyPeak).toBeLessThanOrEqual(PLUGIN_SYNC_EXEC_SLOTS);
    expect(docker.started.filter((kind) => kind === "command").length).toBe(45);
  }, 30_000);

  it("a bot's command that waits for its own turn's copy runs soon while the person's other bots keep the environment busy", async () => {
    const manager = new UserSandboxManager({ client: inProcessSandboxdClient(service), instance: "default", stateFile: join(dir, "deletions.json") });
    await manager.exec(ALICE, { argv: ["true"] });
    docker.delayMs = 40;
    // ten bots keep every place of the environment taken, command after command
    let busy = true;
    const loops = Array.from({ length: 10 }, async (_, index) => {
      while (busy) await manager.exec(ALICE, { argv: ["bash", "-lc", "echo ok"] }, `bot-${index}`);
    });
    await tick(100);
    const plugins = ["one", "two", "three"].map((name) => ({ ...pluginFolder(name, 1024), scope: "org" }));
    const bot = { id: "bot-new" };
    const host = {
      userSandbox: manager,
      pluginSyncedGenerations: new Map(),
      pluginSyncInFlight: new Map(),
      pluginSyncSlots: new Map(),
      reportBackgroundError: () => undefined,
      store: { bot: (id: string) => (id === bot.id ? bot : null) },
      scopedPluginFolders: () => plugins,
      samePerson: () => true,
      effectiveBotOwner: () => ALICE,
      skillsLibraryEnabled: () => false,
      cfg: {},
      personalSkills: { enabled: () => [] },
      syncPluginsToSandbox,
      syncPluginFoldersForTurn: undefined as unknown,
    };
    host.syncPluginFoldersForTurn = createSyncPluginFoldersForTurn(() => host);
    const syncPluginsForTurn = createSyncPluginsForTurn(() => host);
    // a new turn of a bot: its first tools/call waits for its copy, then runs
    const started = Date.now();
    const call = (async () => {
      await syncPluginsForTurn(ALICE, "turn-1", bot.id);
      return manager.exec(ALICE, { argv: ["bash", "-lc", "echo ok"] }, bot.id);
    })();
    const outcome = await Promise.race([call.then((result) => result.exitCode), tick(8_000).then(() => "still waiting")]);
    const elapsed = Date.now() - started;
    busy = false;
    await Promise.allSettled([call, ...loops]);
    expect(outcome).toBe(0);
    expect(elapsed).toBeLessThan(8_000);
    expect(docker.peak).toBeLessThanOrEqual(MAX_CONCURRENT_EXECS);
  }, 30_000);

  it("a command that cannot get a place in time says so plainly, and nothing ran", async () => {
    const queue = new SandboxExecQueue({ slots: 1 });
    const held = await queue.acquire("k", 1000, () => new Error("unused"));
    await expect(queue.acquire("k", 20, (load) => new Error(`busy ${load.active} ${load.waiting}`))).rejects.toThrow("busy 1 0");
    held();
    const next = await queue.acquire("k", 20, () => new Error("unused"));
    next();
    expect(queue.load("k")).toEqual({ active: 0, waiting: 0 });
  });

  it("the environment's own refusal for being busy waits and sends again instead of failing the command", async () => {
    let refusals = 2;
    const base = inProcessSandboxdClient(service);
    const client = { ...base, exec: async (key: string, input: Parameters<typeof base.exec>[1]) => {
      if (refusals > 0) { refusals -= 1; throw new SandboxdRequestError(429, "busy", "too many commands are running in this environment"); }
      return base.exec(key, input);
    } };
    const manager = new UserSandboxManager({ client, instance: "default", stateFile: join(dir, "deletions.json"), sleep: async () => {} });
    expect((await manager.exec(ALICE, { argv: ["true"] })).exitCode).toBe(0);
    expect(refusals).toBe(0);
  });
});

describe("a plugin copy that fails (#3440)", () => {
  const failing = (answer: (input: { argv: string[]; env?: Record<string, string> }) => { exitCode: number | null; stdout: string; stderr: string; timedOut?: boolean } | Error) => {
    const target: SandboxPluginExec & { calls: number } = {
      calls: 0,
      exec: async (input) => {
        target.calls += 1;
        const result = answer(input);
        if (result instanceof Error) throw result;
        return result;
      },
    };
    return target;
  };

  it("says why, and is not sent again whole at the next turn while its content is the same", async () => {
    let now = 1_000_000;
    const failures = new PluginCopyFailures(() => now);
    const plugin = pluginFolder("flow", 600 * 1024);
    const target = failing((input) => input.env?.SAGAX_CONTENT_B64_0
      ? { exitCode: 2, stdout: "", stderr: "base64: write error: No space left on device\n" }
      : { exitCode: 0, stdout: "", stderr: "" });
    const first = await syncPluginsToSandbox([plugin], target, "/workspace/sagax-plugins", { failures, scope: ALICE });
    expect(first.copied).toEqual([]);
    expect(first.skipped[0]!.reason).toMatch(/^copy failed \(part 1 of \d+: exit 2: base64: write error: No space left on device\)/);

    // the next turn: no command at all for that plugin, and the reason is kept
    const calls = target.calls;
    const second = await syncPluginsToSandbox([plugin], target, "/workspace/sagax-plugins", { failures, scope: ALICE });
    expect(target.calls).toBe(calls);
    expect(second.skipped).toEqual([]);
    expect(second.deferred?.[0]?.reason).toContain("No space left on device");

    // after the wait it is tried again
    now += 61_000;
    await syncPluginsToSandbox([plugin], target, "/workspace/sagax-plugins", { failures, scope: ALICE });
    expect(target.calls).toBeGreaterThan(calls);

    // a changed plugin is tried at once
    const again = target.calls;
    writeFileSync(join(plugin.dir, "changed.txt"), "v2");
    await syncPluginsToSandbox([plugin], target, "/workspace/sagax-plugins", { failures, scope: ALICE });
    expect(target.calls).toBeGreaterThan(again);
  });

  it("keeps the environment's reason when a command did not run, and still copies the next plugin", async () => {
    const failures = new PluginCopyFailures();
    const broken = pluginFolder("broken", 1024);
    const fine = pluginFolder("fine", 1024);
    const target = failing((input) => input.env?.SAGAX_DEST?.endsWith("/broken") && !input.env.SAGAX_DIGEST
      ? new Error("the server environment did not run the command: error dialing backend: i/o timeout")
      : { exitCode: 0, stdout: "", stderr: "" });
    const result = await syncPluginsToSandbox([broken, fine], target, "/workspace/sagax-plugins", { failures, scope: ALICE });
    expect(result.copied).toEqual(["fine"]);
    expect(result.skipped[0]!.reason).toContain("error dialing backend: i/o timeout");
  });

  it("names the time limit, a missing exit status and an unpack's own reason", async () => {
    const plugin = pluginFolder("flow", 1024);
    const timedOut = failing((input) => input.env?.SAGAX_CONTENT_B64_0 ? { exitCode: 124, stdout: "", stderr: "", timedOut: true } : { exitCode: 0, stdout: "", stderr: "" });
    expect((await syncPluginsToSandbox([plugin], timedOut, "/workspace/sagax-plugins")).skipped[0]!.reason).toBe("copy failed (part 1 of 1: no answer within 60 s)");
    const lost = failing((input) => input.env?.SAGAX_DIGEST ? { exitCode: null, stdout: "", stderr: "" } : { exitCode: 0, stdout: "", stderr: "" });
    expect((await syncPluginsToSandbox([plugin], lost, "/workspace/sagax-plugins")).skipped[0]!.reason).toBe("unpack failed (no exit status)");
    const unpack = failing((input) => input.env?.SAGAX_DIGEST ? { exitCode: 3, stdout: "", stderr: "the archive holds a link or a device\n" } : { exitCode: 0, stdout: "", stderr: "" });
    expect((await syncPluginsToSandbox([plugin], unpack, "/workspace/sagax-plugins")).skipped[0]!.reason).toBe("unpack failed: the archive holds a link or a device");
  });

  it("a bot's failed command into that plugin's folder says why the plugin is missing", async () => {
    const scope = `${ALICE}-note`;
    pluginCopyFailures.failed(`${scope}\n/workspace/sagax-plugins`, "flow", "d1", "copy failed (part 1 of 3: exit 1: disk full)");
    const exec: ToolExec = {
      exec: async () => ({ exitCode: 2, stdout: "", stderr: "python3: can't open file '/workspace/sagax-plugins/flow/run.py'", truncated: false, timedOut: false }),
      overQuota: async () => false,
      commandNote: (command) => pluginCopyFailures.noteForCommand(scope, command),
    };
    const result = await callUserSandboxTool("run_command", { command: "python3 /workspace/sagax-plugins/flow/run.py" }, exec);
    expect(result.isError).toBe(true);
    expect(result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n")).toContain("its last copy failed (copy failed (part 1 of 3: exit 1: disk full))");
    pluginCopyFailures.succeeded(`${scope}\n/workspace/sagax-plugins`, "flow");
    expect(pluginCopyFailures.noteForCommand(scope, "python3 /workspace/sagax-plugins/flow/run.py")).toBeNull();
  });
});
