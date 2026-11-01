// Claude driver contract tests, run against the scripted fake CLI in
// server/testing/fake-claude-cli.ts — the driver must normalize the
// stream-json protocol into canonical events, keep argv hygiene (prompt
// over stdin, secrets stripped), and broker permission asks.
//
// These used to be POSIX-only: the fake CLI is a shebang script Windows
// cannot exec, and the broker is a unix socket. Both now go through
// resolveCliSpawn / permissionSocketPath, so they run everywhere.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingHttpHeaders } from "node:http";
import { connect, createServer as createNetServer, type AddressInfo, type Socket } from "node:net";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_MARK, ENDED_MARK, INTERRUPTED_MARK, voiceCallTurn } from "../testing/voice-call-turns.ts";

import { DATA_DIR, ensureDirs, instanceConfigs, NATIVE_DIR } from "../config.ts";
import { TurnAuthenticationRefusedError, type ProviderInstance } from "../contracts.ts";
import { recordEvents, type EventRecorder } from "../testing/events.ts";
import { contextFullMessage, contextRenewedNotice } from "../context-renewal.ts";
import {
  autoCompactWindow,
  brokerSocketCandidates,
  claudeCliSupports,
  claudeCliUpdate,
  CLAUDE_AUTO_ALLOWED_TOOLS,
  claudeHookSettings,
  claudeLimitMessage,
  ClaudeDriver,
  createPermissionBroker,
  hookTokenFile,
  instanceClaudeAllowRules,
  remoteSupportDenyRules,
  parseClaudeCliVersion,
  permissionSocketPath,
  readClaudeAuthSettings,
  claudeCostSnapshot,
  restoredCostBase,
  STEERED_CONTINUATION_GRACE_MS,
  sumNativeTurnResults,
  turnCostFromRunningTotal,
  type ClaudeConfig,
  ONE_SHOT_SYSTEM_PROMPT,
  oneShotIsolationArgs,
} from "./claude.ts";
import { CLAUDE_ORG_TOOLS, CLAUDE_UNUSED_TOOLS } from "./host-tools.ts";
import { AUTO_ALLOWLIST_COPY, claudeLaunchLevel } from "../testing/claude-level.ts";
import { removeTempDir } from "../testing/cleanup.ts";
import { rebuiltSessionNotice } from "../resume-recovery.ts";
import { BASH_MAX_TIMEOUT_MS } from "../system-prompt.ts";
import { ephemeralWorkspaceTokenPath } from "../workspace-backup-policy.ts";
import * as procs from "../procs.ts";
import * as localInject from "./local-inject.ts";

const FAKE_CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "testing", "fake-claude-cli.ts");
/** The process that played the latest turn a FAKE_CLAUDE_DUMP recorded. */
const dumpedPid = (dump: string): number => JSON.parse(readFileSync(dump, "utf8")).pid;

/** Thread ids for the four ask-id-collision tests. Each must truncate to a
 * unique 8-char tag so no two tests share a broker socket/pipe name. */
const COLLISION_THREAD_IDS = ["t-dup-1", "t-dup-2", "t-dup-3", "t-dup-4"];

/** Connect to a broker socket and resolve once the connection is live. */
function connectSocket(path: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let retriesLeft = 20;
    const tryConnect = () => {
      const conn = connect(path);
      const onConnect = () => {
        conn.removeListener("error", onError);
        resolve(conn);
      };
      const onError = (error: NodeJS.ErrnoException) => {
        conn.removeListener("connect", onConnect);
        conn.destroy();
        // A Windows named pipe can briefly disappear while the server creates
        // its next pipe instance for another simultaneous client.
        if (process.platform === "win32" && error.code === "ENOENT" && retriesLeft-- > 0) {
          setTimeout(tryConnect, 25);
          return;
        }
        reject(error);
      };
      conn.once("connect", onConnect);
      conn.once("error", onError);
    };
    tryConnect();
  });
}

/** Returns a function that resolves, in order, with each `\n`-delimited JSON
 * message the broker writes back on `conn` — one call per expected answer. */
function answerQueue(conn: ReturnType<typeof connect>) {
  const waiters: Array<(msg: any) => void> = [];
  let buf = "";
  conn.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      waiters.shift()?.(JSON.parse(line));
    }
  });
  return () => new Promise<any>((resolve) => waiters.push(resolve));
}

const CONTROL_PLANE_FIXTURE = {
  SAGAX_CLOUD_READY_TOKEN: "ready-should-not-leak", SAGAX_CLOUD_BOOTSTRAP: "bootstrap-should-not-leak",
  SAGAX_LICENSE_KEY: "license-should-not-leak", SAGAX_INSTALLATION_CREDENTIAL: "fleet-should-not-leak",
};


/** The launch wording of the volatile half in a new process's first message (claude.ts withVolatileNote). */
const LAUNCH_NOTE = /^<system-reminder>\nThis part of your instructions changes from turn to turn/;

describe("instanceClaudeAllowRules", () => {
  it("reads a JSON list or one rule per line, trimmed and deduplicated", () => {
    expect(instanceClaudeAllowRules({ SAGAX_CLAUDE_ALLOW: '["Bash(claude plugin marketplace add a/b)", "Read"]' }))
      .toEqual(["Bash(claude plugin marketplace add a/b)", "Read"]);
    expect(instanceClaudeAllowRules({ SAGAX_CLAUDE_ALLOW: " Bash(git status)\n\nBash(git status)\nmcp__ogb\n" }))
      .toEqual(["Bash(git status)", "mcp__ogb"]);
  });

  it("is empty when unset, blank or unreadable", () => {
    expect(instanceClaudeAllowRules({})).toEqual([]);
    expect(instanceClaudeAllowRules({ SAGAX_CLAUDE_ALLOW: "  " })).toEqual([]);
    expect(instanceClaudeAllowRules({ SAGAX_CLAUDE_ALLOW: "[1, 2]" })).toEqual([]);
    expect(instanceClaudeAllowRules({ SAGAX_CLAUDE_ALLOW: "[not json" })).toEqual([]);
  });

  it("drops a rule that is not a tool name with an optional pattern", () => {
    expect(instanceClaudeAllowRules({ SAGAX_CLAUDE_ALLOW: '["Bash(ls)", "rm -rf /", "Bash(\\u0007)", "", "Bash"]' }))
      .toEqual(["Bash(ls)", "Bash"]);
  });
});

describe("ClaudeDriver.decodeConfig", () => {
  it("quotes hook paths as shell data rather than JSON strings", () => {
    const settings = claudeHookSettings("/tmp/it's $SAGAX_HOOK_TEST `literal`/helper.ts") as { PostToolUse: Array<{ hooks: Array<{ command: string }> }> };
    const command = settings.PostToolUse[0]!.hooks[0]!.command;
    if (process.platform === "win32") {
      expect(command).toBe('"%SAGAX_HOOK_NODE%" "%SAGAX_HOOK_HELPER%"');
    } else {
      expect(command).toContain("'/tmp/it'\\''s $SAGAX_HOOK_TEST `literal`/helper.ts'");
    }
  });

  it("hooks failed tool calls too, so a timed-out command can be given a hint", () => {
    expect(Object.keys(claudeHookSettings("/tmp/helper.ts"))).toContain("PostToolUseFailure");
    // nothing observes Stop, and the CLI would wait for the helper on every turn
    expect(Object.keys(claudeHookSettings("/tmp/helper.ts"))).not.toContain("Stop");
  });

  it("keeps the engine waiting only on hooks whose answer it needs", () => {
    type Entry = Array<{ matcher: string; hooks: Array<{ async?: boolean }> }>;
    const settings = claudeHookSettings("/tmp/helper.ts") as Record<string, Entry>;
    // recording only: background, the model goes on (~180 ms a tool call)
    expect(settings.PostToolUse![0]!.hooks[0]!.async).toBe(true);
    expect(settings.PreCompact![0]!.hooks[0]!.async).toBe(true);
    // the timeout hint and the post-compaction context are answers: synchronous
    expect(settings.PostToolUseFailure![0]!.hooks[0]!.async).toBeUndefined();
    expect(settings.SessionStart![0]!.hooks[0]!.async).toBeUndefined();
    // a fresh or resumed session never waits on the helper
    expect(settings.SessionStart![0]!.matcher).toBe("compact");
  });

  it("keeps the per-turn hook token where workspace backups never look", () => {
    const path = relative(DATA_DIR, hookTokenFile("thread", "bot")).replaceAll("\\", "/");
    expect(ephemeralWorkspaceTokenPath(path)).toBe(true);
    expect(ephemeralWorkspaceTokenPath(path.split("/")[0]!)).toBe(true);
  });

  it("defaults to the claude binary with acceptEdits", () => {
    expect(ClaudeDriver.decodeConfig({})).toEqual({ cli: "claude", permissionMode: "acceptEdits" });
    expect(ClaudeDriver.decodeConfig(undefined)).toEqual({ cli: "claude", permissionMode: "acceptEdits" });
  });

  it("bills a steered continuation's native results as one turn", () => {
    // usage is per native turn and adds up; total_cost_usd is the CLI's
    // running total for the process, so the latest figure stands
    const first = { ok: true, stopReason: "end_turn", cost: 0.01, usage: { input: 12, output: 5, cachedInput: 2 } };
    expect(sumNativeTurnResults(null, first)).toEqual(first);
    expect(sumNativeTurnResults(first, { ok: true, stopReason: "end_turn", cost: 0.03, usage: { input: 3, output: 4 } }))
      .toEqual({ ok: true, stopReason: "end_turn", cost: 0.03, usage: { input: 15, output: 9, cachedInput: 2 } });
    // a failed half fails the turn; a figure missing on one side leaves the other's alone
    expect(sumNativeTurnResults(first, { ok: false, stopReason: null, cost: null }))
      .toEqual({ ok: false, stopReason: "end_turn", cost: 0.01, usage: first.usage });
    expect(sumNativeTurnResults({ ok: true, stopReason: null, cost: null }, { ok: true, stopReason: null, cost: null }))
      .toEqual({ ok: true, stopReason: null, cost: null });
  });

  it("accepts the three known permission modes", () => {
    for (const permissionMode of ["acceptEdits", "auto", "bypassPermissions"] as const) {
      expect(ClaudeDriver.decodeConfig({ permissionMode }).permissionMode).toBe(permissionMode);
    }
  });

  it("books a turn's share of the CLI's running cost total", () => {
    // a process's first turn has no earlier total: its figure is its own
    expect(turnCostFromRunningTotal(1.5822674, null)).toBe(1.5822674);
    // later turns book the growth — the incident's two consecutive totals
    expect(turnCostFromRunningTotal(1.7255570000000002, 1.5822674)).toBe(0.1432896);
    // without the float noise of subtracting two totals
    expect(turnCostFromRunningTotal(0.03, 0.02)).toBe(0.01);
    expect(turnCostFromRunningTotal(0.02, 0.02)).toBe(0);
    expect(turnCostFromRunningTotal(null, 0.02)).toBeNull();
    // a total below the earlier one cannot be the same count: never negative
    expect(turnCostFromRunningTotal(0.004, 0.02)).toBe(0.004);
  });

  it("finds the running cost the CLI restored for a resumed session", () => {
    // Real frames (2.1.282). modelUsage counts [input, cache read, cache
    // write, output] per model for the whole session; usage is the turn's own.
    const opus = (total: number, tokens: [number, number, number, number]) => claudeCostSnapshot(total, {
      "claude-opus-5-5": { inputTokens: tokens[0], cacheReadInputTokens: tokens[1], cacheCreationInputTokens: tokens[2], outputTokens: tokens[3], costUSD: total },
    })!;
    const earlier = [
      opus(1.5822674, [18, 776097, 103347, 30010]),
      opus(1.7255570000000002, [24, 1167845, 107739, 31499]),
      opus(3.2557024000000006, [34, 1682172, 227804, 54835]),
      opus(4.3538464, [36, 1682172, 353781, 59351]),
    ];
    // This resumed launch restored the 3.2557 state, not the later 4.3538 one.
    const resumed = opus(4.212299000000001, [60, 3542515, 254587, 73343]);
    expect(restoredCostBase(earlier, resumed, { input: 26, cacheRead: 1860343, cacheWrite: 26783, output: 18508 })).toBe(3.2557024000000006);
    // A fresh session restored nothing; a side call on another model (a
    // title from Haiku) is in modelUsage but not in the turn's usage.
    const fresh = claudeCostSnapshot(0.20990999999999999, {
      "claude-haiku-4-5-20251001": { inputTokens: 978, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 10, costUSD: 0.001028 },
      "claude-sonnet-5": { inputTokens: 2, cacheReadInputTokens: 0, cacheCreationInputTokens: 52057, outputTokens: 65, costUSD: 0.208882 },
    })!;
    expect(restoredCostBase([], fresh, { input: 2, cacheRead: 0, cacheWrite: 52057, output: 65 })).toBe(0);
    // An interrupted turn's work was restored but never reported: measure
    // from the latest known state inside the new counts, so that work is
    // booked once, with this turn.
    const beforeInterrupt = opus(0.8265352, [20, 559016, 79339, 3997]);
    const afterInterrupt = opus(3.0735268, [86, 4211334, 254837, 9611]);
    expect(restoredCostBase([beforeInterrupt], afterInterrupt, { input: 48, cacheRead: 2873716, cacheWrite: 142479, output: 3805 })).toBe(0.8265352);
    // No known state at all: the whole figure.
    expect(restoredCostBase([], resumed, { input: 26, cacheRead: 1860343, cacheWrite: 26783, output: 18508 })).toBe(0);
    expect(claudeCostSnapshot(null, {})).toBeNull();
  });

  it("matches a resumed turn split over two models by the sum of its growth", () => {
    // States A=2 ($0.01) and A=3 ($0.02); the resume restored the first, and
    // the turn used one input token on each of A and B. Its usage counts both.
    const state = (total: number, models: Record<string, number>) => claudeCostSnapshot(total, Object.fromEntries(
      Object.entries(models).map(([model, input]) => [model, { inputTokens: input, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, costUSD: 0 }]),
    ))!;
    const earlier = [state(0.01, { A: 2 }), state(0.02, { A: 3 })];
    expect(restoredCostBase(earlier, state(0.03, { A: 3, B: 1 }), { input: 2, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(0.01);
  });

  it("measures from the latest known state, not the highest total", () => {
    // A resume that went back to an older state leaves a later state with a
    // lower total (4.3538 then 4.2123 in a real session). With no exact fit,
    // the latest state inside the new counts is the start.
    const state = (total: number, input: number) => claudeCostSnapshot(total, {
      A: { inputTokens: input, cacheReadInputTokens: 0, cacheCreationInputTokens: 0, outputTokens: 0, costUSD: total },
    })!;
    const earlier = [state(0.05, 5), state(0.03, 4)];
    expect(restoredCostBase(earlier, state(0.06, 8), { input: 1, cacheRead: 0, cacheWrite: 0, output: 0 })).toBe(0.03);
  });

  it("throws on an invalid permissionMode (registry downgrades this to a shadow)", () => {
    expect(() => ClaudeDriver.decodeConfig({ permissionMode: "yolo" })).toThrow(/permissionMode/);
  });

  it("normalizes and deduplicates built-in tool lists", () => {
    expect(
      ClaudeDriver.decodeConfig({
        tools: [" Read ", "WebFetch", "Read"],
        disallowedTools: [" Bash(git *) ", "Bash(git *)"],
      }),
    ).toMatchObject({
      tools: ["Read", "WebFetch"],
      disallowedTools: ["Bash(git *)"],
    });
    expect(ClaudeDriver.decodeConfig({ tools: [] }).tools).toEqual([]);
  });

  it.each([
    ["tools", "Read"],
    ["tools", ["Read", " "]],
    ["disallowedTools", [42]],
  ])("rejects invalid %s configuration", (field, value) => {
    expect(() => ClaudeDriver.decodeConfig({ [field]: value })).toThrow(new RegExp(field));
  });

  it.skipIf(process.platform !== "win32")("names permission pipes per harness process", () => {
    expect(permissionSocketPath("thread-abc")).toMatch(
      new RegExp(`^\\\\\\\\\\.\\\\pipe\\\\openmausbot-perm-${process.pid}-thre[0-9a-f]{4}$`),
    );
  });

  it("keeps threads whose ids share a prefix on distinct sockets", () => {
    // the truncated prefix agrees; only the digest separates them — without
    // it, Windows pipes for these two threads would collide and race
    expect(permissionSocketPath("t-perm-dup-1")).not.toBe(permissionSocketPath("t-perm-dup-2"));
  });

  it("advertises per-bot local CUA but rejects legacy bypass turns without a mode", async () => {
    const bypass = await ClaudeDriver.create({
      instanceId: "claude-bypass",
      displayName: "Claude Bypass",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: "bypassPermissions" },
    });
    expect(bypass.adapter.capabilities.localComputerMcp).toBe(true);
    await expect(
      bypass.adapter.sendTurn({
        threadId: "t-bypass-local",
        text: "click",
        integrations: {
          localComputer: {
            command: "/cua-driver",
            args: ["mcp"],
            env: {},
            platform: "linux",
            scope: "local-computer",
          },
        },
      }),
    ).rejects.toThrow(/interactive approval broker/);
    // Settings may sign this account in and out on a hosted server.
    expect(bypass.startAuthentication).toBeTypeOf("function");
    expect(bypass.signOut).toBeTypeOf("function");
    await bypass.dispose();
  });

  it("gives each collision test a distinct broker pipe path", () => {
    const paths = COLLISION_THREAD_IDS.map((threadId) => permissionSocketPath(threadId));
    expect(new Set(paths).size).toBe(COLLISION_THREAD_IDS.length);
  });

  it("gives two bots distinct broker pipes even if they ever share a threadId (#1017)", () => {
    // A delegated child turn should never be able to collide with its
    // parent's still-open broker on the shared driver-level socket table —
    // whatever the reason a threadId is reused, namespacing by bot rules
    // the collision out by construction.
    const sharedThreadId = "t-shared-by-parent-and-child";
    const parentPath = permissionSocketPath(sharedThreadId, "bot-chief");
    const childPath = permissionSocketPath(sharedThreadId, "bot-cliff");
    expect(parentPath).not.toBe(childPath);
  });

  it("disposes its account controller while a logout is running", async () => {
    const home = mkdtempSync(join(tmpdir(), "omb-claude-logout-dispose-"));
    const cli = join(home, "fake-logout.mjs");
    const pidPath = join(home, "logout-pid");
    writeFileSync(cli, [
      "#!/usr/bin/env node",
      'import { writeFileSync } from "node:fs";',
      'import { join } from "node:path";',
      'if (process.argv.slice(2).join(" ") !== "auth logout") process.exit(2);',
      'writeFileSync(join(process.env.HOME, "logout-pid"), String(process.pid));',
      'setInterval(() => {}, 1000);',
    ].join("\n"), { mode: 0o700 });
    const instance = await ClaudeDriver.create({
      instanceId: "claude-logout-dispose", displayName: "Fixture", enabled: true,
      config: { cli, permissionMode: "acceptEdits" },
      environment: { HOME: home, USERPROFILE: home, CLAUDE_CONFIG_DIR: join(home, ".claude") },
    });
    const pending = instance.signOut!().catch(() => {});
    let pid: number | undefined;
    const alive = (value: number) => { try { process.kill(value, 0); return true; } catch { return false; } };
    try {
      await expect.poll(() => existsSync(pidPath), { timeout: 2500 }).toBe(true);
      pid = Number(readFileSync(pidPath, "utf8"));
      await instance.dispose();
      expect(alive(pid)).toBe(false);
      await expect(instance.signOut!()).rejects.toThrow("provider was removed");
    } finally {
      if (pid !== undefined && alive(pid)) {
        if (process.platform === "win32") process.kill(pid, "SIGKILL");
        else process.kill(-pid, "SIGKILL");
      }
      await pending;
      await instance.dispose();
      await removeTempDir(home);
    }
  }, 60_000);

  it("keeps the deterministic path as the first broker candidate", () => {
    const candidates = brokerSocketCandidates("t-candidates");
    expect(candidates[0]).toBe(permissionSocketPath("t-candidates"));
    if (process.platform === "win32") {
      // pipes are never unlinkable, so a held name needs fresh fallbacks
      expect(candidates.length).toBeGreaterThan(1);
      expect(new Set(candidates).size).toBe(candidates.length);
    } else {
      // macOS has a small Unix-socket path limit, so a deep HOME needs a
      // short fallback under the OS temp root.
      expect(candidates).toHaveLength(2);
      expect(candidates[1]).toMatch(/omb-perm-[0-9a-f]{16}\.sock$/);
      expect(candidates[1]).not.toBe(candidates[0]);
    }
  });

  // Windows can't listen on filesystem socket paths at all (EACCES), so the
  // unbindable-first-candidate unit runs on POSIX; the fake-CLI e2e below
  // covers the real pipe fallback on Windows CI.
  it.skipIf(process.platform === "win32")(
    "binds the next candidate when the first is unbindable, and asks round-trip on it",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "omb-broker-fallback-"));
      const held = join(dir, "held.sock");
      // a directory squats the path the way a hung child holds a pipe:
      // unlink fails, listen fails — the broker must move on, not go dark
      mkdirSync(held);
      const free = join(dir, "free.sock");
      const asks: Array<{ id: string }> = [];
      const broker = await createPermissionBroker({
        socketPaths: [held, free],
        onAsk: (ask) => asks.push(ask),
        onResolve: () => {},
      });
      try {
        expect(broker.socketPath).toBe(free);
        const conn = connect(free);
        await new Promise<void>((resolve, reject) => {
          conn.on("connect", resolve);
          conn.on("error", reject);
        });
        const answered = new Promise<{ behavior: string }>((resolve) => {
          let buf = "";
          conn.on("data", (c) => {
            buf += c;
            const nl = buf.indexOf("\n");
            if (nl !== -1) resolve(JSON.parse(buf.slice(0, nl)));
          });
        });
        conn.write(JSON.stringify({ t: "ask", id: "ask-fb", tool: "Bash", input: { command: "echo hi" } }) + "\n");
        await expect.poll(() => asks.length).toBe(1);
        expect(broker.answer("ask-fb", "allow")).toBe(true);
        expect(await answered).toMatchObject({ behavior: "allow" });
        conn.end();
      } finally {
        broker.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );

  it.skipIf(process.platform === "win32")(
    "keeps a large non-ASCII ask whole across socket reads",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "omb-broker-utf8-"));
      const socketPath = join(dir, "broker.sock");
      const asks: Array<{ input: unknown }> = [];
      const broker = await createPermissionBroker({
        socketPaths: [socketPath],
        onAsk: (ask) => asks.push(ask),
        onResolve: () => {},
      });
      try {
        // A Write ask carries the whole file, so one line spans many reads,
        // and most read boundaries fall inside a three-byte character.
        const content = "中文ok€".repeat(150_000);
        const conn = connect(socketPath);
        await new Promise<void>((resolve, reject) => {
          conn.on("connect", resolve);
          conn.on("error", reject);
        });
        conn.write(JSON.stringify({ t: "ask", id: "ask-utf8", tool: "Write", input: { file_path: "notes.md", content } }) + "\n");
        await expect.poll(() => asks.length, { timeout: 20_000 }).toBe(1);
        const received = (asks[0]!.input as { content: string }).content;
        expect(received.includes("\uFFFD")).toBe(false);
        expect(received === content).toBe(true);
        conn.destroy();
      } finally {
        broker.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it.skipIf(process.platform === "win32")(
    "rejects instead of returning an occupied path when every candidate is unavailable",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "omb-broker-unavailable-"));
      const heldOne = join(dir, "held-one.sock");
      const heldTwo = join(dir, "held-two.sock");
      mkdirSync(heldOne);
      mkdirSync(heldTwo);
      try {
        await expect(
          createPermissionBroker({
            socketPaths: [heldOne, heldTwo],
            onAsk: () => {},
            onResolve: () => {},
          }),
        ).rejects.toThrow(/could not bind a local socket/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  );
});

describe("ClaudeDriver turns (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const create = async (
    mode?: string,
    environment: Record<string, string> = {},
    config: Partial<ClaudeConfig> = {},
  ) => {
    if (mode) process.env.FAKE_CLAUDE_MODE = mode;
    instance = await ClaudeDriver.create({
      instanceId: "claude-test",
      displayName: "Claude Test",
      environment,
      enabled: true,
      config: {
        ...config,
        cli: config.cli ?? FAKE_CLI,
        permissionMode: config.permissionMode ?? "acceptEdits",
      },
    });
    recorder = recordEvents(instance.adapter);
  };

  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-claude-test-"));
  });

  it("refuses an unsupported native selection before launching, even with instance tools and Full access", async () => {
    const dump = join(scratch, "scope-refused.json"); process.env.FAKE_CLAUDE_DUMP = dump;
    await create("echo", {}, { tools: ["Read"], disallowedTools: ["Write"] });
    await expect(instance.adapter.sendTurn({ threadId: "scope-refused", text: "Must not run", toolScope: { allow: ["native:Read", "native:Write"] }, approvalMode: "full", guestConfined: true })).rejects.toThrow(/native tool selection.*not supported/i);
    expect(existsSync(dump)).toBe(false);
  });

  it("gates every eligible MCP mount while preserving guest and instance restrictions", async () => {
    const dump = join(scratch, "scope-mcp.json"); process.env.FAKE_CLAUDE_DUMP = dump;
    await create("echo", { FAKE_CLAUDE_VERSION: "2.1.284" }, { tools: ["Read"], disallowedTools: ["Write"] });
    await instance.adapter.sendTurn({ threadId: "scope-mcp", text: "Fixture", approvalMode: "ask", guestConfined: true, toolScope: { allow: ["native:*", "mcp:agents:list_bots"] }, integrations: {
      agents: { command: "node", args: ["agents"], env: {} }, browser: { command: "node", args: ["browser"], env: {} },
    } });
    await recorder.until((event) => event.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--restricted");
    expect(seen.argv[seen.argv.indexOf("--disallowedTools") + 1]).toBe("Write");
    expect(seen.mcpConfig.mcpServers).not.toHaveProperty("browser");
    expect(JSON.parse(seen.mcpConfig.mcpServers.agents.env.SAGAX_GATE_TOOL_SCOPE)).toEqual({ allow: ["native:*", "mcp:agents:list_bots"] });
  });

  it("never inherits native MCP servers when a bot has an explicit selection: the selection wins", async () => {
    // The person's own Claude MCP servers are on by default on a solo server
    // (claudeUserMcpEnabled, #1282); a turn with a tool selection still gets
    // only the selected servers, under a strict MCP config.
    const dump = join(scratch, "scope-inherited-mcp.json"); process.env.FAKE_CLAUDE_DUMP = dump;
    await create();
    await instance.adapter.sendTurn({ threadId: "scope-inherited-mcp", text: "Runs with the selection only", mcpFromUserConfig: true, toolScope: { allow: ["native:*"] } });
    await expect.poll(() => existsSync(dump), { timeout: 15_000 }).toBe(true);
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).toContain("--strict-mcp-config");
  });

  afterEach(async () => {
    delete process.env.FAKE_CLAUDE_MODE;
    delete process.env.FAKE_CLAUDE_AUTO_UNAVAILABLE_MODELS;
    delete process.env.FAKE_CLAUDE_DUMP;
    delete process.env.FAKE_CLAUDE_PROMPTS;
    delete process.env.FAKE_CLAUDE_COMPACT;
    delete process.env.FAKE_CLAUDE_COLD_MS;
    delete process.env.FAKE_CLAUDE_FIRST_TOKEN_MS;
    delete process.env.FAKE_CLAUDE_LAUNCH_LOG;
    delete process.env.FAKE_CLAUDE_TOKEN_MS;
    delete process.env.FAKE_CLAUDE_VOICE_REPLY;
    delete process.env.FAKE_CLAUDE_TRANSIENTS;
    delete process.env.FAKE_CLAUDE_PARTIAL_FAILS;
    delete process.env.FAKE_CLAUDE_STATE;
    delete process.env.FAKE_CLAUDE_RETRY_SCALE;
    delete process.env.FAKE_CLAUDE_TEXT_HANG;
    delete process.env.FAKE_CLAUDE_STEER_GRACE_SCALE;
    delete process.env.FAKE_CLAUDE_STEER_SILENCE_SCALE;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.XAI_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.BOX_TOKEN;
    delete process.env.OPENCODE_API_KEY;
    delete process.env.SAGAX_TTS_KEY;
    for (const name of Object.keys(CONTROL_PLANE_FIXTURE)) delete process.env[name];
    delete process.env.SAGAX_CLAUDE_SESSION_IDLE_MS;
    delete process.env.SAGAX_CLAUDE_SESSION_IDLE_MIN_MS;
    recorder?.stop();
    await instance?.dispose();
    await removeTempDir(scratch);
  });

  // Security: a saved workspace Anthropic key was written over every Claude
  // instance's environment, so a router instance's host received it as
  // x-api-key beside the router's own Bearer token, or the turn went to the
  // workspace URL instead of the router.
  it.each([
    ["without a workspace URL", { key: "sk-ant-workspace-secret" }],
    ["with a workspace URL", { key: "sk-ant-workspace-secret", url: "http://127.0.0.1:9" }],
  ])("sends a router instance's turn to its own host with only its own token (%s)", async (_label, anthropic) => {
    const seen: IncomingHttpHeaders[] = [];
    const router = createHttpServer((request, response) => {
      seen.push(request.headers);
      request.resume();
      response.end("{}");
    });
    await new Promise<void>((resolve) => router.listen(0, "127.0.0.1", resolve));
    try {
      const base = `http://127.0.0.1:${(router.address() as AddressInfo).port}`;
      const map = instanceConfigs({
        anthropic,
        instances: {
          claude: { driver: "claudeAgent" },
          router: { driver: "claudeAgent", environment: { ANTHROPIC_BASE_URL: base, ANTHROPIC_AUTH_TOKEN: "router-token" } },
        },
      });
      // The workspace key reaches only the API instance (claudeApi), never a
      // subscription Claude or a router that has its own host and token.
      expect(map.claudeApi?.environment).toMatchObject({ ANTHROPIC_API_KEY: "sk-ant-workspace-secret" });
      expect(map.claude?.environment?.ANTHROPIC_API_KEY).toBeUndefined();
      expect(map.router?.environment?.ANTHROPIC_API_KEY).toBeUndefined();
      process.env.FAKE_CLAUDE_ROUTER_PING = "1";
      await create(undefined, map.router!.environment as Record<string, string>);
      await instance.adapter.sendTurn({ threadId: "t-router", text: "hi", model: "claude-sonnet-5" });
      await recorder.until((e) => e.type === "turn.completed");
      expect(seen).toHaveLength(1);
      expect(seen[0]!.authorization).toBe("Bearer router-token");
      expect(seen[0]!["x-api-key"]).toBeUndefined();
      expect(JSON.stringify(seen)).not.toContain("sk-ant-workspace-secret");
    } finally {
      delete process.env.FAKE_CLAUDE_ROUTER_PING;
      await new Promise((resolve) => router.close(resolve));
    }
  });

  it("lists its slash commands in the turn's folder and isolation without a model call", async () => {
    await create();
    const commands = join(scratch, "commands.json");
    const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "shared", "fixtures", "claude-initialize-commands.json"), "utf8"));
    writeFileSync(commands, JSON.stringify(fixture.response.response.commands));
    const dump = join(scratch, "commands-dump.json");
    const prompts = join(scratch, "prompts.jsonl");
    process.env.FAKE_CLAUDE_COMMANDS = commands;
    process.env.FAKE_CLAUDE_COMMANDS_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    try {
      const listed = await instance.listCommands?.({ cwd: scratch, botId: "b1" }) ?? [];
      expect(listed.map((command) => command.name)).toContain("pulsatrix-flow:using-px-flow");
      expect(listed.find((command) => command.name === "mcp__github__review_pr")?.group).toBe("mcp");
      const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; cwd: string };
      expect(realpathSync(seen.cwd)).toBe(realpathSync(scratch));
      expect(seen.argv).toEqual(expect.arrayContaining(["-p", "--input-format", "stream-json", "--strict-mcp-config", "--setting-sources", "project"]));
      expect(seen.argv).not.toContain("--model");
      // no user message, so no turn and no model call
      expect(existsSync(prompts)).toBe(false);
      expect((seen as unknown as { env: Record<string, string | null> }).env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
    } finally {
      delete process.env.FAKE_CLAUDE_COMMANDS;
      delete process.env.FAKE_CLAUDE_COMMANDS_DUMP;
    }
  });

  it("lists a speaker's commands from their own subscription, with their claude.ai connectors", async () => {
    await create();
    const dump = join(scratch, "commands-dump.json");
    const login = join(scratch, "principals", "p1", "claude");
    process.env.FAKE_CLAUDE_COMMANDS_DUMP = dump;
    try {
      await instance.listCommands?.({ cwd: scratch, botId: "b1", access: { via: "subscription", identity: "subscription:p1", claudeConfigDir: login }, claudeAiConnectors: true });
      const own = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string | null> };
      expect(own.env.CLAUDE_CONFIG_DIR).toBe(login);
      // a turn keeping the connectors drops both switches; the listing too
      expect(own.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBeNull();
      expect(own.argv).not.toContain("--strict-mcp-config");
      expect(own.argv).toEqual(expect.arrayContaining(["--setting-sources", "project"]));
      // a key is not an account: the server's own directory lists
      await instance.listCommands?.({ cwd: scratch, botId: "b1", access: { via: "speaker-key", identity: "speaker-key:p1:abc", environment: { ANTHROPIC_API_KEY: "sk-ant-test-fake" } } });
      const keyed = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; env: Record<string, string | null> };
      expect(keyed.env.CLAUDE_CONFIG_DIR).not.toBe(login);
      expect(keyed.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
      expect(keyed.argv).toContain("--strict-mcp-config");
    } finally {
      delete process.env.FAKE_CLAUDE_COMMANDS_DUMP;
    }
  });

  const launchLines = (path: string): Array<{ pid: number; at: number }> => existsSync(path)
    ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { pid: number; at: number })
    : [];
  const processAlive = (pid: number) => {
    try { process.kill(pid, 0); return true; } catch { return false; }
  };

  it("warms a call without a turn, reuses that process, and does not warm twice", async () => {
    await create("voice");
    expect(instance.adapter.capabilities.warmSession).toBe(true);
    const launches = join(scratch, "launches.jsonl");
    const prompts = join(scratch, "prompts.jsonl");
    process.env.FAKE_CLAUDE_LAUNCH_LOG = launches;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    const warm = { threadId: "t-warm", text: "", keepWarm: true, warmOnly: true };
    const first = await instance.adapter.sendTurn(warm);
    expect(first.reused).toBeUndefined();
    await expect.poll(() => launchLines(launches).length, { timeout: 5_000 }).toBe(1);
    expect(instance.adapter.hasSession("t-warm")).toBe(false);
    expect(recorder.events.some((event) => event.type === "turn.started")).toBe(false);
    expect(existsSync(prompts)).toBe(false);
    const second = await instance.adapter.sendTurn(warm);
    expect(second.reused).toBe(true);
    expect(launchLines(launches)).toHaveLength(1);
    const spoken = await instance.adapter.sendTurn({ threadId: "t-warm", text: "hello", keepWarm: true });
    expect(spoken.reused).toBe(true);
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === spoken.turnId);
    expect(launchLines(launches)).toHaveLength(1);
    expect(readFileSync(prompts, "utf8").trim().split("\n").filter(Boolean)).toHaveLength(1);
    expect(recorder.events.filter((event) => event.type === "turn.started")).toHaveLength(1);
  });

  it("pays the cold start at process boot, so a warmed first turn does not", async () => {
    await create("voice");
    process.env.FAKE_CLAUDE_COLD_MS = "400";
    process.env.FAKE_CLAUDE_FIRST_TOKEN_MS = "50";
    const coldStarted = Date.now();
    const cold = await instance.adapter.sendTurn({ threadId: "t-cold", text: "hello", keepWarm: true });
    await recorder.until((event) => event.type === "content.delta" && event.turnId === cold.turnId);
    const coldMs = Date.now() - coldStarted;
    expect(cold.reused).toBeUndefined();
    expect(coldMs).toBeGreaterThanOrEqual(350);

    const warmed = await instance.adapter.sendTurn({ threadId: "t-warmed", text: "", keepWarm: true, warmOnly: true });
    expect(warmed.reused).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 500));
    const warmStarted = Date.now();
    const spoken = await instance.adapter.sendTurn({ threadId: "t-warmed", text: "hello", keepWarm: true });
    await recorder.until((event) => event.type === "content.delta" && event.turnId === spoken.turnId);
    const warmMs = Date.now() - warmStarted;
    expect(spoken.reused).toBe(true);
    expect(warmMs).toBeLessThan(300);
  });

  it("does not spawn when the warm is already cancelled", async () => {
    await create("voice");
    const launches = join(scratch, "launches.jsonl");
    process.env.FAKE_CLAUDE_LAUNCH_LOG = launches;
    const signal = new AbortController();
    signal.abort();
    const started = await instance.adapter.sendTurn({ threadId: "t-aborted", text: "", keepWarm: true, warmOnly: true, warmSignal: signal.signal });
    expect(started.reused).toBeUndefined();
    expect(existsSync(launches)).toBe(false);
  });

  it("closes the idle process when the call ends, and the next turn starts another", async () => {
    await create("voice");
    const launches = join(scratch, "launches.jsonl");
    process.env.FAKE_CLAUDE_LAUNCH_LOG = launches;
    const signal = new AbortController();
    await instance.adapter.sendTurn({ threadId: "t-hangup", text: "", keepWarm: true, warmOnly: true, warmSignal: signal.signal });
    await expect.poll(() => launchLines(launches).length, { timeout: 5_000 }).toBe(1);
    const pid = launchLines(launches)[0]!.pid;
    expect(processAlive(pid)).toBe(true);
    signal.abort();
    await expect.poll(() => processAlive(pid), { timeout: 5_000 }).toBe(false);
    const again = await instance.adapter.sendTurn({ threadId: "t-hangup", text: "hello", keepWarm: true });
    expect(again.reused).toBeUndefined();
    await expect.poll(() => launchLines(launches).length, { timeout: 5_000 }).toBe(2);
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === again.turnId);
  });

  it("releaseWarmSession closes an idle warm process and leaves a running turn", async () => {
    await create("voice");
    const launches = join(scratch, "launches.jsonl");
    process.env.FAKE_CLAUDE_LAUNCH_LOG = launches;
    await instance.adapter.sendTurn({ threadId: "t-release", text: "", keepWarm: true, warmOnly: true });
    await expect.poll(() => launchLines(launches).length, { timeout: 5_000 }).toBe(1);
    const pid = launchLines(launches)[0]!.pid;
    instance.adapter.releaseWarmSession?.("t-release");
    await expect.poll(() => processAlive(pid), { timeout: 5_000 }).toBe(false);
    const running = await instance.adapter.sendTurn({ threadId: "t-running", text: "hello", keepWarm: true });
    await expect.poll(() => launchLines(launches).length, { timeout: 5_000 }).toBe(2);
    const runningPid = launchLines(launches)[1]!.pid;
    instance.adapter.releaseWarmSession?.("t-running");
    expect(processAlive(runningPid)).toBe(true);
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === running.turnId);
  });

  it("sessionBytes reads the saved session file a resume would load", async () => {
    const account = join(scratch, "claude-stale-account");
    const id = "0b5c2f0e-1d3a-4c8e-9b7f-2a6d4e8f1c3b";
    mkdirSync(join(account, "projects", "-some-cwd"), { recursive: true });
    writeFileSync(join(account, "projects", "-some-cwd", `${id}.jsonl`), "x".repeat(4_321));
    await create(undefined, {}, { configDir: account });
    expect(instance.adapter.sessionBytes?.("t-stale", id)).toBe(4_321);
    // Unknown, malformed or non-string cursors: nothing to report.
    expect(instance.adapter.sessionBytes?.("t-stale", "1f0e0e0e-0000-4000-8000-000000000000")).toBeUndefined();
    expect(instance.adapter.sessionBytes?.("t-stale", "../../etc/passwd")).toBeUndefined();
    expect(instance.adapter.sessionBytes?.("t-stale", 42)).toBeUndefined();
  });

  it("normalizes a full turn into the canonical event sequence", async () => {
    await create();
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-happy", text: "hi", model: "claude-sonnet-5" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    expect(types).toEqual([
      "turn.started",
      "session.started",
      "content.delta",
      "item.completed", // assistant_text
      "item.started", // tool tu-1
      "thread.token-usage.updated",
      "item.completed", // tool tu-1 result
      "turn.completed",
    ]);
    expect(recorder.events.every((e) => e.turnId === turnId && e.provider === "claudeAgent")).toBe(true);
    // the chip names the tool; the command it ran rides beside it
    expect(recorder.events.find((e) => e.type === "item.started")).toMatchObject({ title: "Bash", summary: "echo hi" });
    expect(recorder.events.find((e) => e.type === "item.started")).toMatchObject({ input: expect.stringContaining("echo hi") });
    expect(recorder.events.find((e) => e.type === "item.completed" && e.itemType === "tool")).toMatchObject({ output: expect.stringContaining('"text": "hi"') });

    const usage = recorder.events.find((e) => e.type === "thread.token-usage.updated")!;
    expect(usage).toMatchObject({ input: 12, output: 5, cachedInput: 2 }); // input + cache_read, cache_read named
    const done = recorder.events.at(-1)!;
    // usage on the settle is the turn total from the result message, so
    // the harness has one figure to bank per turn
    expect(done).toMatchObject({ type: "turn.completed", ok: true, cost: 0.01, usage: { input: 12, output: 5, cachedInput: 2 } });
    expect(instance.adapter.hasSession("t-happy")).toBe(false);
  });

  it("names the files a Write or Edit call writes, and none for a shell call", async () => {
    process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify([
      { name: "Write", input: { file_path: "/work/report.md", content: "# Report" }, output: "ok" },
      { name: "Bash", input: { command: "ls" }, output: "report.md" },
    ]);
    try {
      await create();
      await instance.adapter.sendTurn({ threadId: "t-files", text: "write it", model: "claude-sonnet-5" });
      await recorder.until((e) => e.type === "turn.completed");
      const started = recorder.events.filter((e) => e.type === "item.started");
      expect(started[0]).toMatchObject({ title: "Write", files: ["/work/report.md"] });
      expect(started[1]).toMatchObject({ title: "Bash" });
      expect(started[1]).not.toHaveProperty("files");
    } finally {
      delete process.env.FAKE_CLAUDE_TOOL_CALLS;
    }
  });

  it("turns an Artifact publish into a visible page card, never leaking the host path", async () => {
    const htmlPath = join(scratch, "report.html");
    writeFileSync(htmlPath, "<p>Hi</p>");
    process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify([
      {
        name: "Artifact",
        input: { action: "publish", file_path: htmlPath },
        output: JSON.stringify({
          url: "https://claude.ai/code/artifact/abc",
          title: "Report",
          path: htmlPath,
        }),
      },
    ]);
    try {
      await create();
      await instance.adapter.sendTurn({ threadId: "t-artifact", text: "publish it", model: "claude-sonnet-5" });
      await recorder.until((e) => e.type === "turn.completed");
      const pages = recorder.events.filter((e: any) => e.type === "item.completed" && e.itemType === "assistant_text" && typeof e.text === "string" && e.text.includes("```artifact"));
      expect(pages).toHaveLength(1);
      expect(pages[0]).toMatchObject({
        text: "```artifact\n{\"title\":\"Report\",\"url\":\"https://claude.ai/code/artifact/abc\"}\n```\n\n```widget\n<p>Hi</p>\n```",
      });
      expect((pages[0] as any).text).not.toContain(htmlPath);
      expect(recorder.events.some((e) => e.type === "item.started" && (e as any).title === "Artifact")).toBe(true);
    } finally {
      delete process.env.FAKE_CLAUDE_TOOL_CALLS;
    }
  });

  it("skips Artifact list results and invented URLs", async () => {
    process.env.FAKE_CLAUDE_TOOL_CALLS = JSON.stringify([
      { name: "Artifact", input: { action: "list" }, output: JSON.stringify({ artifacts: [{ title: "A", url: "https://claude.ai/x" }] }) },
      { name: "Artifact", input: { action: "publish" }, output: JSON.stringify({ title: "Nope", url: "javascript:alert(1)" }) },
    ]);
    try {
      await create();
      await instance.adapter.sendTurn({ threadId: "t-artifact-skip", text: "list them", model: "claude-sonnet-5" });
      await recorder.until((e) => e.type === "turn.completed");
      expect(recorder.events.some((e: any) => e.type === "item.completed" && e.itemType === "assistant_text" && typeof e.text === "string" && e.text.includes("```artifact"))).toBe(false);
    } finally {
      delete process.env.FAKE_CLAUDE_TOOL_CALLS;
    }
  });

  it("streams partial-message text deltas without re-emitting the whole message", async () => {
    await create("stream");
    await instance.adapter.sendTurn({ threadId: "t-stream", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const deltas = recorder.events.filter((e) => e.type === "content.delta");
    const text = deltas.filter((d: any) => d.streamKind === "assistant_text");
    // two streamed chunks, and NO third full-text fallback delta after them
    expect(text.map((d: any) => d.delta)).toEqual(["hello from ", "fake claude"]);
    // subagent narration (parent_tool_use_id) never surfaces
    expect(text.some((d: any) => d.delta.includes("SUBAGENT"))).toBe(false);
    // reasoning streams on its own kind
    expect(deltas.some((d: any) => d.streamKind === "reasoning_text" && d.delta === "hmm")).toBe(true);
    // the settled message still lands exactly once
    const settled = recorder.events.filter((e: any) => e.type === "item.completed" && e.itemType === "assistant_text");
    expect(settled).toHaveLength(1);
    expect((settled[0] as any).text).toBe("hello from fake claude");
  });

  it("passes on a running tool's heartbeat as tool activity, so a long tool is not taken for a stall", async () => {
    await create("tool-heartbeat");
    await instance.adapter.sendTurn({ threadId: "t-heartbeat", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const types = recorder.events.map((e) => e.type);
    const beat = types.indexOf("item.updated");
    expect(recorder.events[beat]).toMatchObject({ itemType: "tool" });
    expect(beat).toBeGreaterThan(types.indexOf("item.started"));
    expect(beat).toBeLessThan(types.lastIndexOf("item.completed"));
  });

  it("turns a signed-out CLI into a setup error, not a bot reply", async () => {
    // issue #674: the CLI answers a signed-out turn with "Please run /login",
    // a command this app has no terminal to run. Relaying it as assistant
    // text left the user in a dead end; `setup: true` is what the chat reads
    // to offer the sign-in card instead.
    const dump = join(scratch, "signed-out-session.json"); process.env.FAKE_CLAUDE_DUMP = dump;
    await create("not-logged-in");
    await instance.adapter.sendTurn({ threadId: "t-auth", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const failure = recorder.events.find((e: any) => e.type === "runtime.error") as any;
    expect(failure).toMatchObject({
      message: expect.stringMatching(/^Claude's sign-in has expired\. Reconnect Claude/),
      setup: true,
    });
    expect(failure.message).toContain("Not logged in");
    // the CLI's instruction must not also land as something the bot said
    expect(recorder.events.some((e: any) => e.type === "item.completed" && e.itemType === "assistant_text")).toBe(false);
    expect(recorder.events.some((e: any) => e.type === "content.delta")).toBe(false);
    // the same vocabulary codex and the ACP engines settle an unauthenticated
    // turn with — not the CLI's "stop_sequence", which says nothing
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "auth_required" });
    // the pooled process is retired: a CLI left retrying its shared OAuth
    // refresh would block other Claude bots (port de OpenMausBot #2867)
    const pid = dumpedPid(dump);
    await expect.poll(() => {
      try { process.kill(pid, 0); return false; } catch { return true; }
    }, { timeout: 7_000 }).toBe(true);
  });

  it("reports a synthetic sign-out refusal for recovery only after its process has stopped", async () => {
    const dump = join(scratch, "recover-signed-out-session.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await create("not-logged-in");
    await expect(instance.adapter.sendTurn({ threadId: "t-auth-recovery", text: "hi", startupRecovery: true }))
      .rejects.toBeInstanceOf(TurnAuthenticationRefusedError);
    expect(() => process.kill(dumpedPid(dump), 0)).toThrow();
    expect(recorder.events.some(event => event.type === "runtime.error" || event.type === "turn.completed")).toBe(false);
  });

  it("keeps a sign-out after model activity as an ordinary failed turn", async () => {
    await create("not-logged-in", { FAKE_CLAUDE_AUTH_AFTER_WORK: "1" });
    await expect(instance.adapter.sendTurn({ threadId: "t-auth-work", text: "hi", startupRecovery: true })).resolves.toHaveProperty("turnId");
    expect(await recorder.until(event => event.type === "turn.completed"))
      .toMatchObject({ ok: false, stopReason: "auth_required" });
    expect(recorder.events.find(event => event.type === "runtime.error"))
      .toMatchObject({ message: expect.stringMatching(/^Claude's sign-in has expired\. Reconnect Claude/), setup: true });
  });

  it("recovers a later sign-out in a retained process without counting earlier turns as new work", async () => {
    const dump = join(scratch, "retained-sign-out.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await create("happy", { FAKE_CLAUDE_AUTH_AFTER_TURN: "1" });
    const turn = { threadId: "t-auth-retained", text: "hi", startupRecovery: true };
    const first = await instance.adapter.sendTurn(turn);
    await recorder.until(event => event.type === "turn.completed" && event.turnId === first.turnId);
    const pid = dumpedPid(dump);
    await expect(instance.adapter.sendTurn({ ...turn, text: "again" })).rejects.toBeInstanceOf(TurnAuthenticationRefusedError);
    expect(dumpedPid(dump)).toBe(pid);
    expect(() => process.kill(pid, 0)).toThrow();
  });

  it("#1768: a subscription sign-out still settles auth_required after one shared-refresh retry", async () => {
    // The person's login home is shared across Claude bots. A concurrent
    // OAuth refresh can leave this process with a revoked grant; Sagax
    // renews once under the single flight, then fails visibly when the
    // CLI still has no sign-in (the real provider revoked it).
    const login = join(scratch, "principals", "pr_race", "claude");
    mkdirSync(login, { recursive: true });
    writeFileSync(join(login, ".credentials.json"), JSON.stringify({
      claudeAiOauth: { accessToken: `sk-ant-oat01-${"r".repeat(30)}`, refreshToken: `sk-ant-ort01-${"r".repeat(30)}`, expiresAt: Date.now() - 60_000 },
    }));
    const dump = join(scratch, "subscription-auth-race.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await create("not-logged-in");
    await instance.adapter.sendTurn({
      threadId: "t-auth-race",
      text: "hi",
      access: { via: "subscription", identity: "subscription:pr_race", claudeConfigDir: login },
    });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.find((event) => event.type === "runtime.error")).toMatchObject({
      message: expect.stringMatching(/^Claude's sign-in has expired\. Reconnect Claude/), setup: true,
    });
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "auth_required" });
    await expect.poll(() => {
      try { process.kill(dumpedPid(dump), 0); return false; } catch { return true; }
    }, { timeout: 7_000 }).toBe(true);
  });

  it("settles an outdated CLI as update_required without emitting an assistant reply", async () => {
    const message = "API Error: 400 Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required. Run 'claude update'.";
    await create("api-error", { FAKE_CLAUDE_API_ERROR: message });
    await instance.adapter.sendTurn({ threadId: "t-update", text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events).toContainEqual(expect.objectContaining({
      type: "runtime.error", message, setup: true, claudeUpdate: true,
    }));
    expect(recorder.events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(false);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "update_required" });
  });

  // Pesto on 2.1.295 (Oct 9-10): the CLI said "You've hit your weekly limit",
  // and the turn was relayed as that reply and settled as "stop_sequence".
  it("settles a turn its account's weekly limit refused as quota, saying when it resets, with no reply", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3 * 86_400;
    const weekly = { status: "rejected", resetsAt, rateLimitType: "seven_day", overageStatus: "rejected", isUsingOverage: false };
    await create("usage-limit", { FAKE_CLAUDE_RATE_LIMIT: JSON.stringify(weekly) });
    await instance.adapter.sendTurn({ threadId: "t-weekly", text: "Hey talk to @Tango" });
    await recorder.until((event) => event.type === "turn.completed");
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toEqual([expect.objectContaining({ message: claudeLimitMessage({ window: "seven_day", resetsAt }), limitResetsAt: resetsAt * 1000 })]);
    expect((errors[0] as any).message).toMatch(/^This Claude account has reached its weekly limit, which resets .+\. Until then, /);
    expect(errors[0]).not.toHaveProperty("setup");
    expect(errors[0]).not.toHaveProperty("claudeUpdate");
    expect(recorder.events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(false);
    expect(recorder.events.some((event) => event.type === "content.delta")).toBe(false);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "quota" });
  });

  it("settles a turn whose model's extra-usage credits ran out as quota, without holding the engine", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 11 * 86_400;
    const credits = { status: "rejected", resetsAt, overageDisabledReason: "out_of_credits", isUsingOverage: false, errorCode: "credits_required" };
    await create("usage-limit", { FAKE_CLAUDE_RATE_LIMIT: JSON.stringify(credits) });
    await instance.adapter.sendTurn({ threadId: "t-credits", text: "continue" });
    await recorder.until((event) => event.type === "turn.completed");
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toEqual([expect.objectContaining({ message: claudeLimitMessage({ window: null, resetsAt, credits: true }), limitScope: "model" })]);
    expect((errors[0] as any).message).toContain("those credits are used up");
    expect(errors[0]).not.toHaveProperty("limitResetsAt");
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "quota" });
  });

  // Pesto on 2.1.272 (Oct 8-9): the CLI's rate_limit_event refused the
  // account's week while the call's error said "does not support this model".
  // The person was offered the update, took it, and met the same refusal.
  it("names the weekly limit behind an older CLI's update request, and offers no update", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 86_400;
    await create("api-error", {
      FAKE_CLAUDE_API_ERROR: "API Error: 400 Claude Code 2.1.272 does not support this model; version 2.1.280 or newer is required. Run 'claude update'.",
      FAKE_CLAUDE_RATE_LIMIT: JSON.stringify({ status: "rejected", resetsAt, rateLimitType: "seven_day", isUsingOverage: false }),
    });
    await instance.adapter.sendTurn({ threadId: "t-weekly-old-cli", text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.filter((event) => event.type === "runtime.error")).toEqual([
      expect.objectContaining({ message: claudeLimitMessage({ window: "seven_day", resetsAt }) }),
    ]);
    expect(recorder.events.some((event) => event.type === "runtime.error" && (event.claudeUpdate || event.setup))).toBe(false);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "quota" });
  });

  // Quill 2 (Sep 26): 97% of the week used, and a model the CLI was too old
  // for. Near a limit is not past it: the update is still what to offer.
  it("still offers the update to an account near, not past, its limit", async () => {
    const message = "API Error: 400 Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required. Run 'claude update'.";
    await create("api-error", {
      FAKE_CLAUDE_API_ERROR: message,
      FAKE_CLAUDE_RATE_LIMIT: JSON.stringify({ status: "allowed_warning", resetsAt: Math.floor(Date.now() / 1000) + 86_400, rateLimitType: "seven_day", utilization: 0.97 }),
    });
    await instance.adapter.sendTurn({ threadId: "t-near-limit", text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.filter((event) => event.type === "runtime.error")).toEqual([
      expect.objectContaining({ message, setup: true, claudeUpdate: true }),
    ]);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason: "update_required" });
  });

  it.each([
    // 2.1.295 on Cloud: no terminal_reason, so the result's only stop token is its synthetic message's "stop_sequence"
    [{ FAKE_CLAUDE_API_ERROR: "Credit balance is too low", FAKE_CLAUDE_API_ERROR_KIND: "billing_error", FAKE_CLAUDE_API_ERROR_STATUS: "402", FAKE_CLAUDE_NO_TERMINAL_REASON: "1" },
      'Your Claude account is out of credits (Claude says: "Credit balance is too low"). Add credits with Claude, then run it again.', "stop_sequence"],
    [{ FAKE_CLAUDE_API_ERROR: "API Error: Repeated 529 Overloaded errors. The API is at capacity — this is usually temporary. Try again in a moment.", FAKE_CLAUDE_API_ERROR_KIND: "overloaded" },
      'Claude is overloaded right now (Claude says: "Repeated 529 Overloaded errors"). This is usually temporary, so try again in a few minutes.', "api_error"],
    [{ FAKE_CLAUDE_API_ERROR: "There's an issue with the selected model (claude-fixture). It may not exist or you may not have access to it.", FAKE_CLAUDE_API_ERROR_KIND: "model_not_found", FAKE_CLAUDE_NO_TERMINAL_REASON: "1" },
      "There's an issue with the selected model (claude-fixture). It may not exist or you may not have access to it.", "stop_sequence"],
  ])("shows an api-error frame as one plain error row in Claude's real cause, never a reply or a bare stop token (%#)", async (environment, message, stopReason) => {
    await create("api-error", environment);
    await instance.adapter.sendTurn({ threadId: "t-api-error-words", text: "hi" });
    await recorder.until((event) => event.type === "turn.completed");
    expect(recorder.events.filter((event) => event.type === "runtime.error")).toEqual([expect.objectContaining({ message })]);
    expect(recorder.events.filter((event) => event.type === "runtime.error")[0]).not.toHaveProperty("setup");
    expect(recorder.events.some((event) => event.type === "item.completed" && event.itemType === "assistant_text")).toBe(false);
    expect(recorder.events.some((event) => event.type === "content.delta")).toBe(false);
    expect(recorder.events.some((event) => event.type === "thread.token-usage.updated" && event.contextTokens === 0)).toBe(false);
    expect(recorder.events.at(-1)).toMatchObject({ type: "turn.completed", ok: false, stopReason });
  });

  // JC 2026-10-29 (0.8.16): "Autocompact is thrashing … use /clear to start
  // fresh" reached the chat in the middle of a tool-heavy turn. The turn goes
  // on in a fresh session instead, and the person never reads those words.
  it("goes on in a fresh session when Claude's context keeps refilling, without the CLI's words", async () => {
    const dump = join(scratch, "thrash.json");
    await create("happy", { FAKE_CLAUDE_DUMP: dump });
    const turn = await instance.adapter.sendTurn({
      threadId: "t-thrash", text: "Check the ports [fake:context-thrash]", resumeCursor: "fixture-full-session",
      recoveryText: "Earlier: the person asked about this VM.\nCheck the ports [fake:context-thrash]",
    });
    const done = await recorder.until((event) => event.type === "turn.completed" && event.turnId === turn.turnId);
    expect(done).toMatchObject({ ok: true });
    const errors = recorder.events.filter((event) => event.type === "runtime.error");
    expect(errors).toEqual([]);
    const said = JSON.stringify(recorder.events);
    expect(said).not.toMatch(/Autocompact is thrashing|\/clear/);
    expect(recorder.events.filter((event) => event.type === "runtime.notice")).toEqual([expect.objectContaining({ message: contextRenewedNotice("Claude Code") })]);
    expect(recorder.events.filter((event) => event.type === "turn.completed")).toHaveLength(1);
    const started = recorder.events.filter((event) => event.type === "session.started");
    expect(started).toHaveLength(2);
    expect(started[1]).toMatchObject({ rebuilt: true });
    // the fresh launch resumes nothing and carries the conversation and the step already taken
    const fresh = JSON.parse(readFileSync(dump, "utf8"));
    expect(fresh.argv).not.toContain("--resume");
    const prompt = JSON.stringify(fresh.prompt);
    expect(prompt).toContain("Earlier: the person asked about this VM.");
    expect(prompt).toContain("ran out of context space");
    expect(prompt).toContain("nmap -p- 192.0.2.10");
    expect(prompt).toContain("22/tcp open ssh");
  });

  it("says a second overflow in plain words, then starts the next turn fresh", async () => {
    const dump = join(scratch, "thrash-again.json");
    process.env.FAKE_CLAUDE_THRASH_AGAIN = "1";
    try {
      await create("happy", { FAKE_CLAUDE_DUMP: dump });
      const turn = await instance.adapter.sendTurn({ threadId: "t-thrash-again", text: "Find the keys [fake:context-thrash]" });
      await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === turn.turnId))
        .resolves.toMatchObject({ ok: false, stopReason: "context_full" });
      expect(recorder.events.filter((event) => event.type === "runtime.error")).toEqual([expect.objectContaining({ message: contextFullMessage("Claude") })]);
      expect(JSON.stringify(recorder.events.filter((event) => event.type === "runtime.error"))).not.toMatch(/Autocompact|\/clear/);
      // two launches: the turn's own and one fresh session, never a loop
      expect(recorder.events.filter((event) => event.type === "session.started")).toHaveLength(2);
    } finally {
      delete process.env.FAKE_CLAUDE_THRASH_AGAIN;
    }
    const last = recorder.events.filter((event) => event.type === "session.started").at(-1) as { sessionId: string };
    const retry = await instance.adapter.sendTurn({
      threadId: "t-thrash-again", text: "Find the keys", resumeCursor: last.sessionId,
      recoveryText: "Earlier: find the keys on the server.\nFind the keys",
    });
    await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === retry.turnId)).resolves.toMatchObject({ ok: true });
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--resume");
    expect(JSON.stringify(seen.prompt)).toContain("Earlier: find the keys on the server.");
  });

  it("retires an outdated child before retry while preserving a healthy pooled session", async () => {
    await create(undefined, {
      FAKE_CLAUDE_API_ERROR: "Claude Code 2.1.268 does not support this model; version 2.1.280 or newer is required.",
    });
    const healthyDump = join(scratch, "healthy-session.json");
    process.env.FAKE_CLAUDE_DUMP = healthyDump;
    const healthy = await instance.adapter.sendTurn({ threadId: "t-update-healthy", text: "keep this session" });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === healthy.turnId);
    const healthyPid = dumpedPid(healthyDump);

    process.env.FAKE_CLAUDE_MODE = "api-error";
    const outdatedDump = join(scratch, "outdated-session.json");
    process.env.FAKE_CLAUDE_DUMP = outdatedDump;
    const resumeCursor = "fixture-update-session";
    const outdated = await instance.adapter.sendTurn({ threadId: "t-update-retry", text: "try the model", resumeCursor });
    await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === outdated.turnId))
      .resolves.toMatchObject({ ok: false, stopReason: "update_required" });
    const outdatedPid = JSON.parse(readFileSync(outdatedDump, "utf8")).pid;

    // Only a new child sees this synthetic replacement runtime. An old
    // pooled child keeps api-error mode, just as it keeps its loaded code
    // after the executable on disk has been updated externally.
    process.env.FAKE_CLAUDE_MODE = "happy";
    const retryDump = join(scratch, "updated-session.json");
    process.env.FAKE_CLAUDE_DUMP = retryDump;
    const retry = await instance.adapter.sendTurn({ threadId: "t-update-retry", text: "retry explicitly", resumeCursor });
    await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === retry.turnId))
      .resolves.toMatchObject({ ok: true });
    const replacement = JSON.parse(readFileSync(retryDump, "utf8"));
    expect(replacement.pid).not.toBe(outdatedPid);
    expect(replacement.argv).toContain("--resume");
    expect(replacement.argv).toContain(resumeCursor);

    const continued = await instance.adapter.sendTurn({ threadId: "t-update-healthy", text: "continue normally" });
    await expect(recorder.until((event) => event.type === "turn.completed" && event.turnId === continued.turnId))
      .resolves.toMatchObject({ ok: true });
    expect(dumpedPid(healthyDump)).toBe(healthyPid);
    expect(JSON.parse(readFileSync(retryDump, "utf8")).pid).toBe(replacement.pid);
    expect(recorder.events.some((event) => event.type === "turn.retrying")).toBe(false);
  });

  it("adds the instance's standing allow rules to the private settings file", async () => {
    process.env.SAGAX_CLAUDE_ALLOW = '["Bash(claude plugin marketplace add acme/marketplace)"]';
    try {
      const dump = join(scratch, "dump-allow.json");
      await create(undefined, { FAKE_CLAUDE_DUMP: dump });
      await instance.adapter.sendTurn({ threadId: "t-allow", text: "hi" });
      await recorder.until((e) => e.type === "turn.completed");
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.settings.permissions).toEqual({ allow: ["Bash(claude plugin marketplace add acme/marketplace)"], deny: remoteSupportDenyRules() });
      expect(seen.argv[seen.argv.indexOf("--setting-sources") + 1]).toBe("project");
    } finally {
      delete process.env.SAGAX_CLAUDE_ALLOW;
    }
  });

  it("never gives the instance's allow rules to a guest's confined turn", async () => {
    process.env.SAGAX_CLAUDE_ALLOW = '["Bash(claude plugin marketplace add acme/marketplace)"]';
    try {
      await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" });
      const folder = mkdtempSync(join(scratch, "guest-allow-"));
      const dump = join(scratch, "dump-guest-allow.json");
      process.env.FAKE_CLAUDE_DUMP = dump;
      await instance.adapter.sendTurn({ threadId: "t-guest-allow", text: "hello", approvalMode: "ask", guestConfined: true, cwd: folder });
      await recorder.until((e) => e.type === "turn.completed");
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.settings.permissions.allow).toBeUndefined();
      expect(seen.settings.permissions.deny).toEqual(expect.arrayContaining(["Bash"]));
    } finally {
      delete process.env.SAGAX_CLAUDE_ALLOW;
    }
  });

  // Pending-safe guard for the organization mode host-tool denial (PR #17):
  // a standing allow rule only ever lands in permissions.allow and never
  // removes a tool from --disallowedTools, so deny keeps winning.
  it("never lets the instance's allow rules reopen a denied tool", async () => {
    process.env.SAGAX_CLAUDE_ALLOW = '["Bash(claude plugin marketplace add acme/marketplace)", "Read", "Edit"]';
    try {
      await create(undefined, {}, { disallowedTools: ["Bash", "Read", "Write", "Edit"] });
      const dump = join(scratch, "dump-allow-deny.json");
      process.env.FAKE_CLAUDE_DUMP = dump;
      await instance.adapter.sendTurn({ threadId: "t-allow-deny", text: "hi" });
      await recorder.until((e) => e.type === "turn.completed");
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.argv[seen.argv.indexOf("--disallowedTools") + 1]).toBe(["Bash", "Read", "Write", "Edit", ...CLAUDE_UNUSED_TOOLS].join(","));
      expect(Object.keys(seen.settings.permissions)).toEqual(["allow", "deny"]);
      expect(seen.settings.permissions.deny).toEqual(remoteSupportDenyRules());
      expect(seen.settings.permissions.allow).toEqual(["Bash(claude plugin marketplace add acme/marketplace)", "Read", "Edit"]);
    } finally {
      delete process.env.SAGAX_CLAUDE_ALLOW;
    }
  });

  it("runs a guest's turn on a Cloud home with no command-running tool and no read outside its folder", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" });
    expect(instance.adapter.capabilities.guestTurns).toBe("confined");
    // What a guest could have left in its own folder on an earlier turn.
    // Inside the scratch folder: its removal waits for the CLI to let go of it (Windows).
    const folder = mkdtempSync(join(scratch, "guest-folder-"));
    writeFileSync(join(folder, ".mcp.json"), JSON.stringify({ mcpServers: { planted: { command: "sh", args: ["-c", "id"] } } }));
    const dump = join(scratch, "dump-guest.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-guest", text: "hello", approvalMode: "ask", guestConfined: true, cwd: folder,
      integrations: { browser: { command: process.execPath, args: ["fixture-browser"], env: {} } } });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8")) as { argv: string[]; settings: any; mcpConfig: any };
    const after = (flag: string) => seen.argv[seen.argv.indexOf(flag) + 1];
    expect(seen.argv).toContain("--restricted");
    expect(after("--tools")).toBe("Read,Grep,Glob,Edit,Write,WebSearch");
    expect(after("--permission-mode")).toBe("default");
    expect(seen.settings.permissions).toMatchObject({ blockReadsOutsideWorkingDirectories: true });
    expect(seen.settings.permissions.deny).toEqual(expect.arrayContaining(["Bash", "PowerShell", "WebFetch"]));
    // The folder's own servers never mount, and the browser (it can open a
    // file: address) asks the owner before every call.
    expect(Object.keys(seen.mcpConfig.mcpServers)).not.toContain("planted");
    expect(after("--allowedTools").split(",")).not.toContain("mcp__browser");
    expect(recorder.events.find((e) => e.type === "turn.completed")).toMatchObject({ ok: true });
  });

  it("stops a guest's turn when the CLI kept a shell, and refuses one too old to confine it", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284", FAKE_CLAUDE_KEEP_BASH: "1" });
    await instance.adapter.sendTurn({ threadId: "t-kept", text: "hello", approvalMode: "ask", guestConfined: true, confinedWhy: "This routine was made before this update." });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.stringify(recorder.events)).toContain("kept its shell, so it can't run this turn. Update Claude Code. This routine was made before this update.");
    expect(recorder.events.find((e) => e.type === "turn.completed")).toMatchObject({ ok: false });
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.250" });
    const refused = await instance.adapter.sendTurn({ threadId: "t-old", text: "hello", approvalMode: "ask", guestConfined: true })
      .then(() => recorder.until((e) => e.type === "turn.completed").then((event) => JSON.stringify(event) + JSON.stringify(recorder.events)), (error: unknown) => String(error));
    expect(refused).toContain("too old to run this turn without a shell");
  });

  it("keeps a workspace Anthropic key set on purpose while still dropping one from the parent env", async () => {
    await create(undefined, { ANTHROPIC_API_KEY: "sk-ant-workspace-fixture" });
    const dump = join(scratch, "dump-workspace-key.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
    await instance.adapter.sendTurn({ threadId: "t-workspace-key", text: "hello" });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.ANTHROPIC_API_KEY).toBe("sk-ant-workspace-fixture");
  });

  it("slice 4: an owner key reaches the CLI over the workspace key, and a subscription runs from the person's directory with no key", async () => {
    await create(undefined, { ANTHROPIC_API_KEY: "sk-ant-workspace-fixture" });
    const dump = join(scratch, "dump-owner-key.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-owner-key", text: "hello", access: { via: "owner-key", identity: "owner-key:pr_a:fp", environment: { ANTHROPIC_API_KEY: "sk-ant-test-alice-key-0001" } } });
    await recorder.until((e) => e.type === "turn.completed" && e.threadId === "t-owner-key");
    expect(JSON.parse(readFileSync(dump, "utf8")).env.ANTHROPIC_API_KEY).toBe("sk-ant-test-alice-key-0001");
    const personal = join(scratch, "principals", "pr_a", "claude");
    mkdirSync(personal, { recursive: true });
    const subDump = join(scratch, "dump-subscription.json");
    process.env.FAKE_CLAUDE_DUMP = subDump;
    await instance.adapter.sendTurn({ threadId: "t-subscription", text: "hello", access: { via: "subscription", identity: "subscription:pr_a", claudeConfigDir: personal } });
    await recorder.until((e) => e.type === "turn.completed" && e.threadId === "t-subscription");
    const seen = JSON.parse(readFileSync(subDump, "utf8"));
    expect(seen.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(realpathSync(seen.env.CLAUDE_CONFIG_DIR)).toBe(realpathSync(personal));
  });

  it("runs a teammate's reply resuming a person's turn in the same process, with the new token and depth", async () => {
    await create();
    const dump = join(scratch, "dump-continuation.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const send = async (token: string, depth: string, switches: string, volatile: string) => {
      const before = recorder.events.filter((e) => e.type === "turn.completed").length;
      await instance.adapter.sendTurn({
        threadId: "t-continue", text: "hello", system: `stable${volatile}`, systemStable: "stable", systemVolatile: volatile,
        integrations: { agents: { command: process.execPath, args: ["/fake/agents-proxy.js"], env: { SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: token, SAGAX_TURN_DEPTH: depth, SAGAX_ROUTE_MESSAGES: switches, SAGAX_OWN_THREAD_CREATION: switches } } },
      });
      await recorder.until(() => recorder.events.filter((e) => e.type === "turn.completed").length > before);
      const seen = JSON.parse(readFileSync(dump, "utf8")) as { pid: number; mcpConfig: { mcpServers: { agents: { env: Record<string, string> } } } };
      const env = seen.mcpConfig.mcpServers.agents.env;
      return { pid: seen.pid, token: readFileSync(env.SAGAX_COMMS_TOKEN_FILE!, "utf8"), depth: readFileSync(env.SAGAX_TURN_DEPTH_FILE!, "utf8") };
    };
    const person = await send("token-person", "0", "1", " plan: choose a computer");
    const reply = await send("token-reply", "1", "0", " plan: no computer this turn");
    expect(reply.pid).toBe(person.pid);
    expect(reply.token).toBe("token-reply");
    expect(reply.depth).toBe("1");
    const next = await send("token-next", "0", "1", " plan: choose a computer");
    expect(next.pid).toBe(person.pid);
    expect(next.depth).toBe("0");
  });

  it.each([
    ["plain agents server", undefined],
    ["agents server behind the tool gate", { allow: ["native:*", "mcp:agents:*"] }],
  ])("keeps one process when person and teammate turns alternate (%s)", async (_label, toolScope) => {
    // 2026-10-28: since #1443 a teammate's turn one hop away mounts the agents
    // server too, with SAGAX_PEER_HOP=1. Each switch between a person's turn
    // and a teammate's reply relaunched the CLI ("spawn contract changed"):
    // the hop flag, and behind the tool gate every per-turn value carried in
    // SAGAX_GATE_UPSTREAM, were part of the contract.
    await create();
    const dump = join(scratch, `dump-alternate-${toolScope ? "gated" : "plain"}.json`);
    process.env.FAKE_CLAUDE_DUMP = dump;
    const threadId = `t-alternate-${toolScope ? "gated" : "plain"}`;
    const send = async (n: number) => {
      const teammate = n % 2 === 1;
      const before = recorder.events.filter((e) => e.type === "turn.completed").length;
      await instance.adapter.sendTurn({
        threadId, text: "hello", ...(toolScope ? { toolScope } : {}),
        integrations: { agents: { command: process.execPath, args: ["/fake/agents-proxy.js"], env: {
          SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: `token-${n}`, SAGAX_TURN_DEPTH: teammate ? "1" : "0",
          SAGAX_PEER_HOP: teammate ? "1" : "0", SAGAX_ROUTE_MESSAGES: teammate ? "0" : "1", SAGAX_OWN_THREAD_CREATION: teammate ? "0" : "1",
        } } },
      });
      await recorder.until(() => recorder.events.filter((e) => e.type === "turn.completed").length > before);
      return (JSON.parse(readFileSync(dump, "utf8")) as { pid: number }).pid;
    };
    const pids: number[] = [];
    for (let n = 0; n < 6; n += 1) pids.push(await send(n));
    const launches = new Set(pids).size;
    console.log(`[measure] ${_label}: ${launches} launch(es) for 6 alternating turns`);
    expect(launches).toBe(1);
  });

  it("relaunches a teammate-only process for a person's turn that needs the peer tools", async () => {
    await create();
    const dump = join(scratch, "dump-peer-hop.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const send = async (hop: string, token: string) => {
      const before = recorder.events.filter((e) => e.type === "turn.completed").length;
      await instance.adapter.sendTurn({
        threadId: "t-peer-hop", text: "hello",
        integrations: { agents: { command: process.execPath, args: ["/fake/agents-proxy.js"], env: { SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: token, SAGAX_TURN_DEPTH: hop, SAGAX_PEER_HOP: hop } } },
      });
      await recorder.until(() => recorder.events.filter((e) => e.type === "turn.completed").length > before);
      return (JSON.parse(readFileSync(dump, "utf8")) as { pid: number }).pid;
    };
    const teammate = await send("1", "t1");
    const person = await send("0", "t2");
    expect(person).not.toBe(teammate);
  });

  it("relaunches when a turn needs agents tools the live process was launched without", async () => {
    await create();
    const dump = join(scratch, "dump-switches.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const send = async (switches: string) => {
      const before = recorder.events.filter((e) => e.type === "turn.completed").length;
      await instance.adapter.sendTurn({
        threadId: "t-switches", text: "hello",
        integrations: { agents: { command: process.execPath, args: ["/fake/agents-proxy.js"], env: { SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: `t${switches}`, SAGAX_TURN_DEPTH: "0", SAGAX_ROUTE_MESSAGES: switches } } },
      });
      await recorder.until(() => recorder.events.filter((e) => e.type === "turn.completed").length > before);
      return (JSON.parse(readFileSync(dump, "utf8")) as { pid: number }).pid;
    };
    const without = await send("0");
    const needs = await send("1");
    expect(needs).not.toBe(without);
  });

  it("slice 4: a turn under another identity never reuses the retained process", async () => {
    await create(undefined, { ANTHROPIC_API_KEY: "sk-ant-workspace-fixture" });
    const dump = join(scratch, "dump-identity.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const send = async (identity: string, key: string) => {
      const before = recorder.events.filter((e) => e.type === "turn.completed").length;
      await instance.adapter.sendTurn({ threadId: "t-identity", text: "hello", access: { via: "owner-key", identity, environment: { ANTHROPIC_API_KEY: key } } });
      await recorder.until(() => recorder.events.filter((e) => e.type === "turn.completed").length > before);
      return JSON.parse(readFileSync(dump, "utf8")) as { pid: number; env: Record<string, string> };
    };
    const first = await send("owner-key:pr_a:fp1", "sk-ant-test-alice-key-0001");
    const second = await send("owner-key:pr_b:fp2", "sk-ant-test-erin-key-00002");
    expect(second.pid).not.toBe(first.pid);
    expect(second.env.ANTHROPIC_API_KEY).toBe("sk-ant-test-erin-key-00002");
  });

  it("never lets another bot on the thread reuse the process that holds a session allow on the person's computer", async () => {
    await create();
    const dump = join(scratch, "dump-bot-grant.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const localComputer = { command: "/cua-driver", args: ["mcp"], env: {}, platform: "linux" as const, scope: "local-computer" as const };
    const send = async (botId: string) => {
      const before = recorder.events.filter((e) => e.type === "turn.completed").length;
      await instance.adapter.sendTurn({ threadId: "t-bot-grant", botId, text: "hello", approvalMode: "ask", integrations: { localComputer } });
      await recorder.until(() => recorder.events.filter((e) => e.type === "turn.completed").length > before);
      return JSON.parse(readFileSync(dump, "utf8")) as { pid: number };
    };
    const alice = await send("bot-alice");
    const bob = await send("bot-bob");
    // the rules Claude keeps for "Always allow this session" live in the
    // process: a fresh one keeps none of them
    expect(bob.pid).not.toBe(alice.pid);
  });

  it("hands a hosted tenant's CLI the hosted model token but none of the operator's control-plane secrets", async () => {
    // server/hosted-models.ts delivers the model token as the provider key.
    await create(undefined, { ANTHROPIC_API_KEY: "omb_workspace_fixture", ANTHROPIC_AUTH_TOKEN: "omb_workspace_fixture" });
    const dump = join(scratch, "dump-hosted.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    Object.assign(process.env, CONTROL_PLANE_FIXTURE);
    await instance.adapter.sendTurn({ threadId: "t-hosted-env", text: "hello" });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.ANTHROPIC_API_KEY).toBe("omb_workspace_fixture");
    expect(seen.env.ANTHROPIC_AUTH_TOKEN).toBe("omb_workspace_fixture");
    for (const name of Object.keys(CONTROL_PLANE_FIXTURE)) expect(seen.env[name]).toBeUndefined();
  });

  it("keeps user and system prompts off argv and strips identity env vars", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
    // workspace credentials the harness may hold (env-injected at boot by
    // the desktop shell) must never ride into the CLI child
    process.env.XAI_API_KEY = "xai-should-not-leak";
    process.env.BOX_TOKEN = "box-should-not-leak";
    process.env.SAGAX_TTS_KEY = "tts-should-not-leak";

    await instance.adapter.sendTurn({ threadId: "t-hygiene", text: "the secret prompt", system: "You are Testy." });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(JSON.stringify(seen.argv)).not.toContain("the secret prompt");
    expect(JSON.stringify(seen.argv)).not.toContain("You are Testy.");
    expect(seen.prompt).toMatchObject({ type: "user", message: { role: "user", content: "the secret prompt" } });
    expect(seen.argv).toContain("--append-system-prompt-file");
    expect(seen.systemPrompt).toBe("You are Testy.");
    expect(existsSync(seen.argv[seen.argv.indexOf("--append-system-prompt-file") + 1])).toBe(false);
    expect(seen.argv).toContain("--session-id");
    expect(seen.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(seen.env.CLAUDECODE).toBeUndefined();
    expect(seen.env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(seen.env.XAI_API_KEY).toBeUndefined();
    expect(seen.env.BOX_TOKEN).toBeUndefined();
    expect(seen.env.SAGAX_TTS_KEY).toBeUndefined();
  });

  it("per-bot Ask restores the broker on a legacy bypass instance", async () => {
    await create(undefined, {}, { permissionMode: "bypassPermissions" });
    const dump = join(scratch, "ask-overrides-bypass.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-ask-overrides-bypass",
      text: "go",
      approvalMode: "ask",
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--permission-mode");
    expect(seen.argv[seen.argv.indexOf("--permission-mode") + 1]).toBe("default");
    expect(seen.argv).toContain("--permission-prompt-tool");
  });

  it.each(["claude-sonnet-5", "claude-fable-5"])("reapplies Full, Auto, and Ask on the same resumed %s conversation", async (model) => {
    await create(undefined, {}, { permissionMode: "bypassPermissions" });
    const dump = join(scratch, "approval-transitions.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    for (const [approvalMode, nativeMode] of [["full", "bypassPermissions"], ["auto", "acceptEdits"], ["edits", "acceptEdits"], ["ask", "default"]] as const) {
      const { turnId } = await instance.adapter.sendTurn({
        threadId: "t-mode-transitions",
        text: "hello",
        model,
        approvalMode,
        resumeCursor: "11111111-1111-4111-8111-111111111111",
      });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.argv[seen.argv.indexOf("--model") + 1]).toBe(model);
      expect(seen.argv[seen.argv.indexOf("--permission-mode") + 1]).toBe(nativeMode);
      expect(seen.argv.includes("--permission-prompt-tool")).toBe(approvalMode !== "full");
      expect(seen.argv).toContain("--resume");
    }
  });

  it("maps Full to bypassPermissions on an organization server and still denies the host tools", async () => {
    await create();
    const dump = join(scratch, "org-full.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-org-full", text: "hello", approvalMode: "full", withholdHostTools: true });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    const denied = String(seen.argv[seen.argv.indexOf("--disallowedTools") + 1]).split(",");
    for (const tool of ["Bash", "Read", "Write", "Edit", "WebFetch"]) expect(denied).toContain(tool);
    // and names its built-ins: the allowlist, nothing a newer CLI adds
    expect(seen.argv[seen.argv.indexOf("--tools") + 1]).toBe(CLAUDE_ORG_TOOLS.join(","));
  });

  it("keeps only the allowlisted built-ins of an owner's selection on an organization server, and the selection as is on a solo one", async () => {
    await create(undefined, {}, { tools: ["Bash", "WebSearch", "Agent", "SomeFutureTool"] });
    const dump = join(scratch, "org-selected.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const org = await instance.adapter.sendTurn({ threadId: "t-org-selected", text: "hello", withholdHostTools: true });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === org.turnId);
    let seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--tools") + 1]).toBe("WebSearch,Agent");
    const solo = await instance.adapter.sendTurn({ threadId: "t-solo-selected", text: "hello" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === solo.turnId);
    seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--tools") + 1]).toBe("Bash,WebSearch,Agent,SomeFutureTool");
  });

  it("passes no --tools on a solo server without a selection", async () => {
    await create();
    const dump = join(scratch, "solo-default.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-solo-default", text: "hello" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--tools");
    expect(String(seen.argv[seen.argv.indexOf("--disallowedTools") + 1]).split(",")).not.toContain("Bash");
  });

  it("hands a stricter level to the running CLI so its next tool call asks (#1373)", async () => {
    const log = join(scratch, "permission-modes.log");
    await create("hang", { FAKE_CLAUDE_PERMISSION_LOG: log });
    // nothing running: the next turn launches at its own level
    expect(await instance.adapter.applyApprovalMode!("t-live-ask", "ask")).toBe(true);
    await instance.adapter.sendTurn({ threadId: "t-live-ask", text: "go", approvalMode: "auto" });
    await recorder.until((e) => e.type === "session.started" || e.type === "turn.started");
    expect(await instance.adapter.applyApprovalMode!("t-live-ask", "ask")).toBe(true);
    expect(await instance.adapter.applyApprovalMode!("t-live-ask", "edits")).toBe(true);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual(["default", "acceptEdits"]);
    // Full and Custom never change during a turn
    expect(await instance.adapter.applyApprovalMode!("t-live-ask", "full")).toBe(false);
    await instance.adapter.interruptTurn("t-live-ask");
  });

  it("reports a level the CLI refused, so the harness stops the turn (#1373)", async () => {
    await create("hang", { FAKE_CLAUDE_REFUSE_PERMISSION_MODE: "1" });
    await instance.adapter.sendTurn({ threadId: "t-live-refused", text: "go", approvalMode: "edits" });
    await recorder.until((e) => e.type === "session.started" || e.type === "turn.started");
    expect(await instance.adapter.applyApprovalMode!("t-live-refused", "ask")).toBe(false);
    await instance.adapter.interruptTurn("t-live-refused");
  });

  it("keeps questions answerable in per-bot Full access", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-full-question", text: "go", approvalMode: "full" });
    const conn = await connectSocket(permissionSocketPath("t-full-question"));
    try {
      conn.write(JSON.stringify({ t: "ask", kind: "question", id: "full-question", tool: "ask_user", input: { question: "Which account?" } }) + "\n");
      const opened = await recorder.until((e) => e.type === "request.opened");
      expect(opened).toMatchObject({ requestType: "question" });
      expect(await instance.adapter.respondToRequest("t-full-question", (opened as { requestId: string }).requestId, { behavior: "answer", message: "Work" })).toBe("answered");
    } finally {
      conn.destroy();
    }
  });

  it("flattens ask_user choices a model sends as {label, description} rows", async () => {
    // The ask_user schema says strings, but MiniMax M3 (through the
    // Anthropic-compatible endpoint) answers with AskUserQuestion-shaped
    // rows. Passed through as-is they were persisted on the card and the
    // chat view could not draw them, blanking the window on every open.
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-object-choices", text: "go" });
    const conn = await connectSocket(permissionSocketPath("t-object-choices"));
    try {
      conn.write(JSON.stringify({
        t: "ask",
        kind: "question",
        id: "object-choices",
        tool: "ask_user",
        input: {
          question: "Email the Persun COGS breakdown with PDF template now?",
          choices: [
            { label: "Yes, email it now", description: "Generate the PDF and send it." },
            { label: "No, skip the email", description: "Leave it as file-only." },
          ],
        },
      }) + "\n");
      const opened = await recorder.until((e) => e.type === "request.opened") as { requestId: string; choices?: unknown };
      expect(opened.choices).toEqual(["Yes, email it now", "No, skip the email"]);
      expect(await instance.adapter.respondToRequest("t-object-choices", opened.requestId, { behavior: "answer", message: "No, skip the email" })).toBe("answered");
    } finally {
      conn.destroy();
    }
  });

  it("draws a multiSelect ask_user as a checkbox question card", async () => {
    // In Full access the CLI has no permission prompt tool, so its own
    // AskUserQuestion never reaches the card; ask_user is the only way a
    // bot can ask, and it must still be able to take several picks.
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-multi-ask", text: "go", approvalMode: "full" });
    const conn = await connectSocket(permissionSocketPath("t-multi-ask"));
    try {
      const questions = [{ question: "Which fruits?", multiSelect: true, options: [{ label: "Apple" }, { label: "Cherry" }] }];
      conn.write(JSON.stringify({
        t: "ask", kind: "question", id: "multi-ask", tool: "ask_user",
        input: { question: "Which fruits?", choices: ["Apple", "Cherry"], questions },
      }) + "\n");
      const opened = await recorder.until((e) => e.type === "request.opened") as { requestId: string; questions?: unknown; choices?: unknown };
      expect(opened.questions).toEqual(questions);
      // a multi-pick question has no honest one-tap fallback
      expect(opened.choices).toBeUndefined();
      expect(await instance.adapter.respondToRequest("t-multi-ask", opened.requestId, { behavior: "answer", message: "Apple, Cherry" })).toBe("answered");
    } finally {
      conn.destroy();
    }
  });

  it("turns Claude's own AskUserQuestion into a question card, not an approval", async () => {
    // The CLI routes AskUserQuestion through --permission-prompt-tool like
    // any other tool use. Left as a permission it offers Deny / Always allow
    // / Allow once over a question, and answering it "allow" throws the
    // answer away — so the ask has to arrive as a question with its options.
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-structured-ask", text: "go" });
    const conn = await connectSocket(permissionSocketPath("t-structured-ask"));
    try {
      conn.write(JSON.stringify({
        t: "ask",
        kind: "question",
        id: "structured-ask",
        tool: "AskUserQuestion",
        input: {
          questions: [{
            question: "Which model should this bot run on?",
            header: "Model",
            options: [{ label: "Opus 5", description: "What it had before." }, { label: "Sonnet 5" }],
          }],
        },
      }) + "\n");
      const opened = await recorder.until((e) => e.type === "request.opened") as {
        requestType: string;
        summary: string;
        requestId: string;
        questions?: { question: string; header?: string; options: { label: string }[] }[];
        choices?: string[];
      };
      expect(opened.requestType).toBe("question");
      expect(opened.summary).toBe("Which model should this bot run on?");
      expect(opened.questions?.[0]).toMatchObject({ question: "Which model should this bot run on?", header: "Model" });
      // flat labels too, so the phone companions can still answer
      expect(opened.choices).toEqual(["Opus 5", "Sonnet 5"]);
      expect(
        await instance.adapter.respondToRequest("t-structured-ask", opened.requestId, {
          behavior: "answer",
          message: "The user answered your questions.\n\nQ: Which model should this bot run on?\nA: Opus 5",
        }),
      ).toBe("answered");
    } finally {
      conn.destroy();
    }
  });

  it("never lets a PERMISSION take its buttons or its summary from a nested questions[]", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-lbl", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = await connectSocket(permissionSocketPath("t-perm-lbl"));
    // A permission ask whose arguments happen to carry `questions`. The
    // companion renders card.options AS the decision and maps every label
    // that is not "Allow" to a denial, so model-authored labels here mean
    // both buttons deny while "Always allow" writes a real grant first.
    conn.write(
      JSON.stringify({
        t: "ask",
        id: "ask-lbl",
        tool: "mcp__x__wire",
        input: {
          questions: [{ question: "Send the payroll export?", options: [{ label: "Yes" }, { label: "No" }] }],
          to: "acct-9",
          amount: 4200,
        },
      }) + "\n",
    );

    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "permission" });
    expect((opened as { choices?: string[] }).choices).toBeUndefined();
    // and the arguments a person is actually deciding on are still shown
    expect((opened as { summary: string }).summary).toContain("acct-9");
    expect((opened as { summary: string }).summary).toContain("4200");

    conn.end();
    await instance.adapter.interruptTurn("t-perm-lbl");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("still shows an unknown permission tool's raw arguments — they are the whole decision", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-raw", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = await connectSocket(permissionSocketPath("t-perm-raw"));
    conn.write(
      JSON.stringify({ t: "ask", id: "ask-raw", tool: "mcp__x__wire", input: { amount: 4200, to: "acct-9" } }) + "\n",
    );

    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({ requestType: "permission", summary: '{"amount":4200,"to":"acct-9"}' });
    expect((opened as { choices?: string[] }).choices).toBeUndefined();

    conn.end();
    await instance.adapter.interruptTurn("t-perm-raw");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("answers to unknown or already-resolved asks resolve `unavailable` — typed, never a throw", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-2", text: "go" });
    await expect(instance.adapter.respondToRequest("t-perm-2", "never-asked", { behavior: "allow" })).resolves.toBe("unavailable");
    // and a thread with no turn at all is the same answer
    await expect(instance.adapter.respondToRequest("no-such-thread", "x", { behavior: "deny" })).resolves.toBe("unavailable");
    await instance.adapter.interruptTurn("t-perm-2");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("sends attached images as native blocks before text without logging their bytes", async () => {
    await create();
    const dump = join(scratch, "dump-images.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 5, 6, 7]);
    const pngPath = join(scratch, "one.png");
    const jpegPath = join(scratch, "two.jpg");
    writeFileSync(pngPath, png);
    writeFileSync(jpegPath, jpeg);

    await instance.adapter.sendTurn({
      threadId: "t-native-images",
      text: "describe both",
      images: [
        { path: pngPath, mime: "image/png", bytes: png.length },
        { path: jpegPath, mime: "image/jpeg", bytes: jpeg.length },
      ],
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.prompt).toEqual({
      type: "user",
      message: {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: png.toString("base64") },
          },
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
          },
          { type: "text", text: "describe both" },
        ],
      },
    });

    const nativeLog = readFileSync(join(NATIVE_DIR, "t-native-images.ndjson"), "utf8");
    expect(nativeLog).not.toContain(png.toString("base64"));
    expect(nativeLog).not.toContain(jpeg.toString("base64"));
    const outgoing = nativeLog
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      .filter((row) => row.dir === "out" && row.source === "claude.sdk.message")
      .at(-1);
    expect(outgoing.msg.message.content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "[image data: 12 base64 chars]" },
      },
      {
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: "[image data: 12 base64 chars]" },
      },
      { type: "text", text: "describe both" },
    ]);
  });

  it("launches with a Windows-sized system prompt without putting it on argv", async () => {
    await create();
    const dump = join(scratch, "dump-long-system.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const system = `room instructions\n${"context-0123456789".repeat(8_000)}`;

    await instance.adapter.sendTurn({ threadId: "t-long-system", text: "review this", system });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.systemPrompt).toBe(system);
    expect(JSON.stringify(seen.argv)).not.toContain("room instructions");
    expect(JSON.stringify(seen.argv).length).toBeLessThan(8_000);
  });

  it("uses instance credentials when launching an injected local model", async () => {
    await create(undefined, { UNSLOTH_STUDIO_AUTH_TOKEN: "unsloth-secret" });
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-local-model",
      text: "hi",
      model: "unsloth::local-model",
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--model") + 1]).toBe("local-model");
    expect(seen.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8888");
    expect(seen.env.ANTHROPIC_AUTH_TOKEN).toBe("unsloth-secret");
  });

  it("injects a leftover API id when a local host is serving that model", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL) => {
      if (String(url).includes(":8888")) {
        return new Response(JSON.stringify({ data: [{ id: "orcarouter/Qwen3.8-27B-Uncensored-GGUF" }] }), { status: 200 });
      }
      return new Response("nope", { status: 500 });
    }) as typeof fetch;
    try {
      await create(undefined, { UNSLOTH_STUDIO_AUTH_TOKEN: "unsloth-secret" });
      const dump = join(scratch, "dump-leftover.json");
      process.env.FAKE_CLAUDE_DUMP = dump;

      await instance.adapter.sendTurn({
        threadId: "t-leftover-local",
        text: "hi",
        model: "orcarouter/Qwen3.8-27B-Uncensored-GGUF",
      });
      await recorder.until((e) => e.type === "turn.completed");

      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.argv[seen.argv.indexOf("--model") + 1]).toBe("orcarouter/Qwen3.8-27B-Uncensored-GGUF");
      expect(seen.env.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8888");
      expect(seen.env.ANTHROPIC_AUTH_TOKEN).toBe("unsloth-secret");
      expect(seen.env.ANTHROPIC_API_KEY).toBe("unsloth-secret");
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it.each(["ask", "auto"] as const)("pre-allows the agents comms proxy while retaining native %s approval", async (approvalMode) => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-agents",
      text: "hi",
      approvalMode,
      integrations: {
        agents: {
          command: process.execPath,
          args: ["/fake/agents-proxy.js"],
          env: { SAGAX_HARNESS_URL: "http://127.0.0.1:1", SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: "tok", SAGAX_TURN_DEPTH: "0" },
        },
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.agents).toMatchObject({
      alwaysLoad: true,
      args: ["/fake/agents-proxy.js"],
      env: { SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: "tok" },
    });
    // the config goes in a private file, never on argv, where `ps` would
    // show the comms token to every other user on the machine
    expect(JSON.stringify(seen.argv)).not.toContain("tok");
    const allowed = seen.argv[seen.argv.indexOf("--allowedTools") + 1];
    expect(allowed).toContain("mcp__agents");
    expect(seen.argv[seen.argv.indexOf("--permission-mode") + 1]).toBe(approvalMode === "auto" ? "acceptEdits" : "default");
    expect(seen.argv).toContain("--permission-prompt-tool");
    expect(seen.mcpConfig.mcpServers.ogb.alwaysLoad).toBe(true);
  });

  it.each([
    ["an ordinary turn", {}, {}, "1"],
    ["a guest's confined turn", { guestConfined: true, approvalMode: "ask" }, {}, undefined],
    ["an instance tool list without ToolSearch", {}, { tools: ["Read"] }, undefined],
  ] as const)("asks the agents proxy to defer rare tools only where tool search exists: %s", async (_label, turnExtra, config, expected) => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" }, config as Partial<ClaudeConfig>);
    const dump = join(scratch, "defer-dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-defer", text: "hi", ...turnExtra,
      integrations: { agents: { command: process.execPath, args: ["/fake/agents-proxy.js"], env: { SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: "tok" } } },
    });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.agents.env.SAGAX_DEFER_RARE_TOOLS).toBe(expected);
    // Tool search on where the turn can search (not the CLI's "auto", which
    // sends every schema on a large window and flips later), and the whole
    // catalog listed by family on every non-compact turn.
    expect(seen.env.ENABLE_TOOL_SEARCH).toBe(expected === "1" ? "true" : undefined);
    expect(seen.mcpConfig.mcpServers.agents.env.SAGAX_MERGED_TOOLS).toBe("1");
  });

  it("keeps tool search off and the catalog unmerged on a compact prompt", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" });
    const dump = join(scratch, "compact-dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-compact-search", text: "hi",
      compactPrompt: { agents: { core: "default", pinned: [] }, pinned: {} },
      integrations: { agents: { command: process.execPath, args: ["/fake/agents-proxy.js"], env: { SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: "tok" } } },
    } as Parameters<typeof instance.adapter.sendTurn>[0]);
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.ENABLE_TOOL_SEARCH).toBe("false");
    expect(seen.mcpConfig.mcpServers.agents.env.SAGAX_MERGED_TOOLS).toBeUndefined();
  });

  // The harness hands the same per-session bearer to every turn; rewriting
  // the file each time cost an fsync on the event loop. A rotated bearer
  // must still be on disk before the CLI reads it.
  it("rewrites the hook token file only when the bearer changes", async () => {
    await create();
    const threadId = "t-hook-token";
    const file = hookTokenFile(threadId, "b-hook");
    const turn = async (token: string) => {
      const { turnId } = await instance.adapter.sendTurn({
        threadId, botId: "b-hook", text: "hi",
        integrations: { hooks: { url: "http://127.0.0.1:1/hooks", token } },
      });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId);
    };

    await turn("bearer-one");
    const saved = statSync(file).ino;
    await turn("bearer-one");
    expect(statSync(file).ino).toBe(saved);
    expect(readFileSync(file, "utf8")).toBe("bearer-one");

    await turn("bearer-two");
    expect(readFileSync(file, "utf8")).toBe("bearer-two");
    if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it("keeps the session alive when only the volatile half of the prompt changed", async () => {
    await create();
    const dump = join(scratch, "volatile.json");
    const prompts = join(scratch, "volatile-prompts.jsonl");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;

    await instance.adapter.sendTurn({
      threadId: "t-volatile",
      text: "one",
      system: "You are Testy.\n\nYour memory:\nlikes tea",
      systemStable: "You are Testy.",
      systemVolatile: "Your memory:\nlikes tea",
    });
    await recorder.until((e) => e.type === "turn.completed");
    const firstPid = JSON.parse(readFileSync(dump, "utf8")).pid;

    recorder.events.length = 0;
    await instance.adapter.sendTurn({
      threadId: "t-volatile",
      text: "two",
      system: "You are Testy.\n\nYour memory:\nlikes tea, dislikes cloud kitchens",
      systemStable: "You are Testy.",
      systemVolatile: "Your memory:\nlikes tea, dislikes cloud kitchens",
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // Same process: a memory edit used to change the spawn contract, which
    // relaunched the CLI and made the provider re-cache the whole session.
    expect(seen.pid).toBe(firstPid);
    // and the model still learns what changed, inside this turn
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(sent).toHaveLength(2);
    // a new process gets the volatile half in its first message, not its prompt file
    expect(sent[0].message.content).toMatch(LAUNCH_NOTE);
    expect(sent[0].message.content).toContain("likes tea");
    expect(sent[0].message.content.endsWith("one")).toBe(true);
    expect(sent[1].message.content).toContain("dislikes cloud kitchens");
    // the user's own words stay last, after the out-of-band note
    expect(sent[1].message.content.endsWith("two")).toBe(true);
  });

  it("re-delivers the volatile half after the CLI compacted its session, and emits nothing about it", async () => {
    await create();
    const prompts = join(scratch, "compacted-prompts.jsonl");
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    process.env.FAKE_CLAUDE_COMPACT = "1"; // compacts on this process's second turn
    const turn = (text: string) => instance.adapter.sendTurn({
      threadId: "t-folded", text,
      system: "You are Testy.\n\nYour memory:\nlikes tea",
      systemStable: "You are Testy.",
      systemVolatile: "Your memory:\nlikes tea",
    });
    for (const text of ["one", "two", "three"]) {
      recorder.events.length = 0;
      await turn(text);
      await recorder.until((e) => e.type === "turn.completed");
      expect(JSON.stringify(recorder.events)).not.toMatch(/compact/i);
    }
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(sent.map((p) => p.message.content.endsWith(["one", "two", "three"][sent.indexOf(p)]))).toEqual([true, true, true]);
    // unchanged memory is not re-sent on an ordinary turn
    expect(sent[1].message.content).toBe("two");
    // but the turn after the compaction carries it again, the summary may have lost it
    expect(sent[2].message.content).toContain("likes tea");
  });

  it("hands a live session only the volatile sections that changed", async () => {
    await create();
    const dump = join(scratch, "sections.json");
    const prompts = join(scratch, "sections-prompts.jsonl");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    const memory = { id: "memory", text: "\n\nYour memory:\nlikes tea" };
    const send = async (text: string, sections: Array<{ id: string; text: string }>) => {
      recorder.events.length = 0;
      const volatile = sections.map((section) => section.text).join("");
      await instance.adapter.sendTurn({
        threadId: "t-sections", text, system: "You are Testy." + volatile,
        systemStable: "You are Testy.", systemVolatile: volatile, systemVolatileSections: sections,
      });
      await recorder.until((e) => e.type === "turn.completed");
    };
    await send("one", [memory, { id: "recent", text: "\n\nRecent: report (2h ago)" }]);
    const firstPid = JSON.parse(readFileSync(dump, "utf8")).pid;
    await send("two", [memory, { id: "recent", text: "\n\nRecent: report (3h ago)" }]);
    await send("three", [{ id: "recent", text: "\n\nRecent: report (3h ago)" }]);
    await send("four", [{ id: "recent", text: "\n\nRecent: report (3h ago)" }]);
    expect(JSON.parse(readFileSync(dump, "utf8")).pid).toBe(firstPid);
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line).message.content as string);
    expect(sent[0]).toMatch(LAUNCH_NOTE);
    expect(sent[0].endsWith("one")).toBe(true);
    // only the moved line rides; the unchanged memory notebook does not
    expect(sent[1]).toContain("3h ago");
    expect(sent[1]).not.toContain("likes tea");
    expect(sent[1].endsWith("two")).toBe(true);
    // a section that went away is named, so the old copy does not stand
    expect(sent[2]).toContain('"memory"');
    expect(sent[2]).not.toContain("Recent:");
    // nothing changed: the bare words
    expect(sent[3]).toBe("four");
  });

  it("redelivers unchanged mention context on every tagged turn", async () => {
    await create();
    const dump = join(scratch, "mention.json");
    const prompts = join(scratch, "mention-prompts.jsonl");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;

    const send = async (text: string, mentionTurn?: boolean) => {
      await instance.adapter.sendTurn({
        threadId: "t-mention",
        text,
        system: "You are Testy.\n\nTagged: @Testy",
        systemStable: "You are Testy.",
        systemVolatile: "Tagged: @Testy",
        ...(mentionTurn ? { mentionTurn: true } : {}),
      });
      await recorder.until((e) => e.type === "turn.completed");
    };
    await send("one");
    recorder.events.length = 0;
    await send("two", true);

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // the mention describes this turn, so the note rides it even though the
    // volatile half is byte-identical to the one the session launched with
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(sent).toHaveLength(2);
    expect(sent[0].message.content).toContain("Tagged: @Testy");
    expect(sent[0].message.content.endsWith("one")).toBe(true);
    expect(sent[1].message.content).toContain("Tagged: @Testy");
    expect(sent[1].message.content.endsWith("two")).toBe(true);
    expect(seen.systemPrompt).toContain("Tagged: @Testy");
  });

  it("hands a live session the phone-call instruction only on call turns", async () => {
    await create();
    const dump = join(scratch, "voice-call.json");
    const prompts = join(scratch, "voice-call-prompts.jsonl");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    const kinds = ["written", "call", "call", "interrupted", "after"] as const;
    for (const [index, kind] of kinds.entries()) {
      recorder.events.length = 0;
      await instance.adapter.sendTurn({ threadId: "t-voice-call", text: `words ${index}`, ...voiceCallTurn(kind) });
      await recorder.until((e) => e.type === "turn.completed");
    }
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // one process for the whole conversation: the call never respawns it
    expect(seen.systemPrompt).not.toContain(CALL_MARK);
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line).message.content as string);
    expect(sent).toHaveLength(5);
    expect(sent[0]).not.toContain(CALL_MARK);
    expect(sent[1]).toContain(CALL_MARK);
    expect(sent[2]).toBe("words 2");
    expect(sent[3]).toContain(INTERRUPTED_MARK);
    expect(sent[4]).toContain(ENDED_MARK);
    expect(sent[4]).not.toContain(CALL_MARK);
    for (const [index, text] of sent.entries()) expect(text.endsWith(`words ${index}`)).toBe(true);
  });

  it("launches a call turn with the phone-call instruction in the appended system prompt", async () => {
    await create();
    const dump = join(scratch, "voice-call-spawn.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-voice-call-spawn", text: "hello", ...voiceCallTurn("call") });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.systemPrompt).toContain(CALL_MARK);
    expect(seen.prompt).not.toContain(CALL_MARK);
  });

  it("still relaunches when the stable half of the prompt changes", async () => {
    await create();
    const dump = join(scratch, "stable.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-stable", text: "one", system: "You are Testy.", systemStable: "You are Testy." });
    await recorder.until((e) => e.type === "turn.completed");
    const firstPid = JSON.parse(readFileSync(dump, "utf8")).pid;

    recorder.events.length = 0;
    await instance.adapter.sendTurn({ threadId: "t-stable", text: "two", system: "You are Grumpy.", systemStable: "You are Grumpy." });
    await recorder.until((e) => e.type === "turn.completed");

    expect(JSON.parse(readFileSync(dump, "utf8")).pid).not.toBe(firstPid);
  });

  it("launches a new session with only the stable half in its prompt file and the volatile half in its first message", async () => {
    await create();
    const dump = join(scratch, "volatile-spawn.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-volatile-spawn",
      text: "hi",
      system: "You are Testy.\n\nYour memory:\nlikes tea",
      systemStable: "You are Testy.",
      systemVolatile: "Your memory:\nlikes tea",
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // the file stays byte-identical while memory changes, so a relaunch keeps the cached prefix
    expect(seen.systemPromptFile).toBe("You are Testy.");
    // the fake folds the first message's note back: the model is still told everything
    expect(seen.systemPrompt).toBe("You are Testy.\n\nYour memory:\nlikes tea");
    const content = seen.prompt.message.content;
    const text = typeof content === "string" ? content : content.map((c: any) => c.text ?? "").join("");
    expect(text).toMatch(LAUNCH_NOTE);
    expect(text).toContain("likes tea");
    expect(text.endsWith("hi")).toBe(true);
  });

  it("relaunches a resumed session with the same prompt file and the current volatile half in its first message", async () => {
    await create();
    const dump = join(scratch, "relaunch.json");
    const prompts = join(scratch, "relaunch-prompts.jsonl");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    const halves = (memory: string) => ({ system: `You are Testy.\n\nYour memory:\n${memory}`, systemStable: "You are Testy.", systemVolatile: `Your memory:\n${memory}` });

    await instance.adapter.sendTurn({ threadId: "t-relaunch", text: "one", ...halves("likes tea") });
    await recorder.until((e) => e.type === "turn.completed");
    const first = JSON.parse(readFileSync(dump, "utf8"));
    const announced = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;

    recorder.events.length = 0;
    // a new spawn contract closes the live process; the next one resumes the conversation
    await instance.adapter.sendTurn({ threadId: "t-relaunch", text: "two", effort: "high", resumeCursor: announced, ...halves("likes tea, dislikes cloud kitchens") });
    await recorder.until((e) => e.type === "turn.completed");

    const second = JSON.parse(readFileSync(dump, "utf8"));
    expect(second.pid).not.toBe(first.pid);
    expect(second.argv[second.argv.indexOf("--resume") + 1]).toBe(announced);
    expect(first.systemPromptFile).toBe("You are Testy.");
    expect(second.systemPromptFile).toBe(first.systemPromptFile);
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    // the resumed conversation holds the old copy: only the change rides
    expect(sent[1].message.content).toContain("likes tea, dislikes cloud kitchens");
    expect(sent[1].message.content.endsWith("two")).toBe(true);

    recorder.events.length = 0;
    // relaunched again with nothing changed: the conversation already holds it
    await instance.adapter.sendTurn({ threadId: "t-relaunch", text: "three", effort: "low", resumeCursor: announced, ...halves("likes tea, dislikes cloud kitchens") });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(dump, "utf8")).pid).not.toBe(second.pid);
    const third = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(third[2].message.content).toBe("three");

    recorder.events.length = 0;
    // a fresh session (no resume) starts from nothing: the whole half rides
    await instance.adapter.sendTurn({ threadId: "t-relaunch", text: "four", effort: "medium", sessionReset: true, ...halves("likes tea, dislikes cloud kitchens") });
    await recorder.until((e) => e.type === "turn.completed");
    const fourth = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(fourth[3].message.content).toMatch(LAUNCH_NOTE);
    expect(fourth[3].message.content).toContain("dislikes cloud kitchens");
  });

  it("delivers the volatile half with the first real turn of a warm process", async () => {
    await create();
    const dump = join(scratch, "warm-volatile.json");
    const prompts = join(scratch, "warm-volatile-prompts.jsonl");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    const turn = { threadId: "t-warm-volatile", keepWarm: true, system: "You are Testy.\n\nYour memory:\nlikes tea", systemStable: "You are Testy.", systemVolatile: "Your memory:\nlikes tea" };
    await instance.adapter.sendTurn({ ...turn, text: "", warmOnly: true });
    for (const text of ["one", "two"]) {
      recorder.events.length = 0;
      expect((await instance.adapter.sendTurn({ ...turn, text })).reused).toBe(true);
      await recorder.until((e) => e.type === "turn.completed");
    }
    const sent = readFileSync(prompts, "utf8").trim().split("\n").map((line) => JSON.parse(line).message.content as string);
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatch(LAUNCH_NOTE);
    expect(sent[0]).toContain("likes tea");
    expect(sent[0].endsWith("one")).toBe(true);
    // held now: the next turn is the bare words
    expect(sent[1]).toBe("two");
    expect(JSON.parse(readFileSync(dump, "utf8")).systemPromptFile).toBe("You are Testy.");
  });

  it("refreshes a resumed session's recorded prompt on every turn when the CLI supports it", async () => {
    await create(undefined, { FAKE_CLAUDE_DUMP: join(scratch, "coordination-snapshot.json"), FAKE_CLAUDE_VERSION: "2.1.267" });
    // After an Engines snapshot, the cached version is what admits the flag.
    await instance.snapshot();
    await instance.adapter.sendTurn({
      threadId: "t-coordinated-resume",
      text: "Addressed teammate request 2. Add the new header row.",
      resumeCursor: "existing-claude-session",
      system: "Stable coordination policy, without the earlier assignment.",
    });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(join(scratch, "coordination-snapshot.json"), "utf8"));
    expect(seen.argv[seen.argv.indexOf("--system-prompt-snapshot") + 1]).toBe("off");
    expect(seen.argv[seen.argv.indexOf("--resume") + 1]).toBe("existing-claude-session");
    expect(seen.prompt.message.content).toContain("Add the new header row.");
  });

  it("refreshes the recorded prompt on a plain turn too: no caller has to ask", async () => {
    const dump = join(scratch, "plain-snapshot.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: "2.1.267" });
    await instance.adapter.sendTurn({ threadId: "t-plain-snapshot", text: "hi", system: "You are Testy." });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--system-prompt-snapshot") + 1]).toBe("off");
  });

  it("keeps resumed turns working on a CLI without the snapshot flag", async () => {
    const dump = join(scratch, "coordination-no-snapshot.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: "2.1.232" });
    await instance.snapshot();
    await instance.adapter.sendTurn({
      threadId: "t-coordinated-old-cli",
      text: "Addressed teammate request 2. Add the new header row.",
      resumeCursor: "existing-claude-session",
      system: "Stable coordination policy, without the earlier assignment.",
    });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--system-prompt-snapshot");
    expect(seen.prompt.message.content).toContain("Add the new header row.");
  });

  it("replaces the previous computer prompt when a normal conversation changes its place", async () => {
    const dump = join(scratch, "surface-snapshot.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: "2.1.267" });
    await instance.adapter.sendTurn({
      threadId: "t-surface-resume", text: "Open the test page.",
      resumeCursor: "previous-host-computer-session",
      system: "Everything you do on screen happens in the built-in browser tab; no host computer tools are mounted.",
      integrations: { browser: { command: process.execPath, args: ["fixture-browser"], env: {} } },
    });
    await recorder.until((event) => event.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--system-prompt-snapshot") + 1]).toBe("off");
    expect(seen.argv[seen.argv.indexOf("--resume") + 1]).toBe("previous-host-computer-session");
    expect(seen.systemPrompt).toContain("no host computer tools are mounted");
    expect(seen.mcpConfig.mcpServers.browser).toBeTruthy();
    const allowedTools = seen.argv.includes("--allowedTools")
      ? String(seen.argv[seen.argv.indexOf("--allowedTools") + 1] ?? "").split(",")
      : [];
    expect(allowedTools).not.toContain("mcp__browser");
    expect(seen.mcpConfig.mcpServers.computer).toBeUndefined();
  });

  it.each([["2.1.232", false], ["2.1.267", true]] as const)(
    "probes Claude %s before the first turn without an Engines snapshot",
    async (version, supportsSnapshot) => {
      const dump = join(scratch, `coordination-first-turn-${version}.json`);
      await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: version });
      await instance.adapter.sendTurn({
        threadId: `t-coordinated-first-turn-${version}`,
        text: "Addressed teammate request 2. Add the new header row.",
        resumeCursor: "existing-claude-session",
        system: "Stable coordination policy, without the earlier assignment.",
      });
      await recorder.until((e) => e.type === "turn.completed");
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      expect(seen.argv.includes("--system-prompt-snapshot")).toBe(supportsSnapshot);
      if (supportsSnapshot) expect(seen.argv[seen.argv.indexOf("--system-prompt-snapshot") + 1]).toBe("off");
      expect(seen.prompt.message.content).toContain("Add the new header row.");
    },
  );

  it("compacts the CLI session at a window the harness picks", async () => {
    await create();
    await instance.snapshot();
    const dump = join(scratch, "compact.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-compact", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--autocompact") + 1]).toBe("200000");
  });

  it("clamps a configured compaction window into the range the CLI accepts", () => {
    // out of range is a hard argument error in the CLI: it would fail every
    // turn, not degrade
    expect(autoCompactWindow({ SAGAX_CLAUDE_AUTOCOMPACT: "50000" })).toBe("100000");
    expect(autoCompactWindow({ SAGAX_CLAUDE_AUTOCOMPACT: "9000000" })).toBe("1000000");
    expect(autoCompactWindow({ SAGAX_CLAUDE_AUTOCOMPACT: "150000" })).toBe("150000");
    expect(autoCompactWindow({ SAGAX_CLAUDE_AUTOCOMPACT: "nonsense" })).toBe("200000");
    expect(autoCompactWindow({})).toBe("200000");
    expect(autoCompactWindow({ SAGAX_CLAUDE_AUTOCOMPACT: "auto" })).toBe("auto");
    expect(autoCompactWindow({ SAGAX_CLAUDE_AUTOCOMPACT: "off" })).toBe(null);
  });

  it("passes no compaction window when it is turned off", async () => {
    const dump = join(scratch, "compact-off.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, SAGAX_CLAUDE_AUTOCOMPACT: "off" });
    await instance.adapter.sendTurn({ threadId: "t-compact-off", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).not.toContain("--autocompact");
  });

  it("launches isolated from the machine's own Claude Code configuration", async () => {
    await create();
    const dump = join(scratch, "isolation.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-isolate", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // Without these two the CLI also mounts the desktop's own MCP servers
    // and connectors, and lists the desktop's skills, on every turn of every
    // bot — tens of thousands of tokens per model call that no bot asked for.
    expect(seen.argv).toContain("--strict-mcp-config");
    expect(seen.argv[seen.argv.indexOf("--setting-sources") + 1]).toBe("project");
    expect(seen.settings.claudeMdExcludes).toEqual([join(homedir(), ".claude", "CLAUDE.md")]);
  });

  it("inherits the machine's configuration again when the escape hatch is set", async () => {
    const dump = join(scratch, "inherit.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, SAGAX_CLAUDE_INHERIT_USER_CONFIG: "1" });

    await instance.adapter.sendTurn({ threadId: "t-inherit", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--strict-mcp-config");
    expect(seen.argv).not.toContain("--setting-sources");
    expect(seen.settings?.claudeMdExcludes).toBeUndefined();
  });

  it("loads the machine's own MCP servers when the turn asks, keeping the rest isolated", async () => {
    await create();
    const dump = join(scratch, "user-mcp.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-user-mcp", text: "hi", mcpFromUserConfig: true });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // the Plugins → MCP servers switch: only the MCP half of the isolation
    // goes; skills, hooks and the personal CLAUDE.md stay out
    expect(seen.argv).not.toContain("--strict-mcp-config");
    expect(seen.argv[seen.argv.indexOf("--setting-sources") + 1]).toBe("project");
  });

  it("keeps no claude.ai connector on an isolated turn", async () => {
    await create();
    const dump = join(scratch, "no-claude-ai.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-no-claude-ai", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--strict-mcp-config");
    expect(seen.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
  });

  it("keeps the speaker's claude.ai connectors when the turn asks, the rest still isolated", async () => {
    await create();
    const dump = join(scratch, "claude-ai.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-claude-ai", text: "hi", claudeAiConnectors: true });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // --strict-mcp-config also drops claude.ai connectors (CLI 2.1.287)
    expect(seen.argv).not.toContain("--strict-mcp-config");
    expect(seen.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBeUndefined();
    // user-scope servers, skills and hooks stay out
    expect(seen.argv[seen.argv.indexOf("--setting-sources") + 1]).toBe("project");
  });

  it("never keeps claude.ai connectors on a guest's confined turn", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" });
    const dump = join(scratch, "claude-ai-guest.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-claude-ai-guest", text: "hi", claudeAiConnectors: true, guestConfined: true, approvalMode: "ask" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--strict-mcp-config");
    expect(seen.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
  });

  it("mounts a url server in the CLI's own shape, header values in the private file", async () => {
    await create();
    const dump = join(scratch, "remote-mcp.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-remote-mcp",
      text: "hi",
      integrations: { custom: {
        docs: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer tok-docs" } },
        legacy: { type: "sse", url: "https://old.example/sse", headers: {} },
      } },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // The one engine that connects by itself: its handshake has only
    // spec-defined fields (claude.ts), so no Sagax connector here,
    // unlike every other engine.
    expect(seen.mcpConfig.mcpServers.docs).toEqual({ type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer tok-docs" } });
    expect(seen.mcpConfig.mcpServers.legacy).toEqual({ type: "sse", url: "https://old.example/sse", headers: {} });
    expect(JSON.stringify(seen.mcpConfig)).not.toContain("mcp-remote-proxy");
    expect(JSON.stringify(seen.argv)).not.toContain("tok-docs");
  });

  it("reaches the harness's Data and browser servers over HTTP, the bearer in a header", async () => {
    await create();
    const dump = join(scratch, "harness-http.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const harness = (kind: string) => ({ command: process.execPath, args: ["/app/server/harness-mcp-proxy.ts", kind], env: { SAGAX_MCP_TOKEN: `tok-${kind}`, SAGAX_HARNESS_URL: "http://127.0.0.1:4321" } });
    await instance.adapter.sendTurn({ threadId: "t-harness-http", text: "hi", integrations: { data: harness("data"), browser: harness("browser") } });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.data).toEqual({ type: "http", url: "http://127.0.0.1:4321/api/internal/data/mcp-http", headers: { Authorization: "Bearer tok-data" } });
    expect(seen.mcpConfig.mcpServers.browser).toEqual({ type: "http", url: "http://127.0.0.1:4321/api/internal/browser/mcp-http", headers: { Authorization: "Bearer tok-browser" } });
    expect(JSON.stringify(seen.argv)).not.toContain("tok-data");
  });

  it("keeps the harness's stdio proxy for a turn with a tool selection", async () => {
    await create();
    const dump = join(scratch, "harness-http-scoped.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const data = { command: process.execPath, args: ["/app/server/harness-mcp-proxy.ts", "data"], env: { SAGAX_MCP_TOKEN: "tok-d", SAGAX_HARNESS_URL: "http://127.0.0.1:4321" } };
    await instance.adapter.sendTurn({ threadId: "t-harness-http-scoped", text: "hi", toolScope: { allow: ["native:*", "mcp:data:*"] }, integrations: { data } });
    await recorder.until((e) => e.type === "turn.completed");
    const mounted = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.data;
    expect(mounted.type).toBeUndefined();
    expect(JSON.stringify(mounted)).toContain("harness-mcp-proxy");
  });

  it("keeps a selected url server's whole catalog: Claude Code searches tools itself", async () => {
    await create();
    const dump = join(scratch, "remote-mcp-scoped.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-remote-mcp-scoped",
      text: "hi",
      toolScope: { allow: ["native:*", "mcp:docs:*"] },
      integrations: { custom: { docs: { type: "http", url: "https://docs.example/mcp", headers: { Authorization: "Bearer tok-docs" } } } },
    });
    await recorder.until((e) => e.type === "turn.completed");
    const docs = JSON.parse(readFileSync(dump, "utf8")).mcpConfig.mcpServers.docs;
    expect(docs.args[0]).toContain("mcp-gate");
    expect(docs.env).not.toHaveProperty("SAGAX_GATE_DIRECTORY");
    const upstream = JSON.parse(docs.env.SAGAX_GATE_UPSTREAM);
    expect(upstream.args[0]).toContain("mcp-remote-proxy");
    expect(upstream.env).not.toHaveProperty("SAGAX_REMOTE_MCP_DIRECTORY");
  });

  it("preserves only the selected account's auth settings in a private file", async () => {
    const account = join(scratch, "account");
    mkdirSync(account);
    const settings = { apiKeyHelper: "echo synthetic-helper-key", env: { ANTHROPIC_BASE_URL: "http://127.0.0.1:9", ANTHROPIC_AUTH_TOKEN: "synthetic-token", SAGAX_TTS_KEY: "must-not-leak" }, hooks: { SessionStart: [{ command: "must-not-run" }] }, permissions: { defaultMode: "bypassPermissions" } };
    writeFileSync(join(account, "settings.json"), JSON.stringify(settings));
    const dump = join(scratch, "account.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump }, { configDir: account });
    await instance.adapter.sendTurn({ threadId: "t-auth-settings", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.settings).toEqual({ claudeMdExcludes: [join(homedir(), ".claude", "CLAUDE.md")], apiKeyHelper: settings.apiKeyHelper, env: { ANTHROPIC_BASE_URL: settings.env.ANTHROPIC_BASE_URL, ANTHROPIC_AUTH_TOKEN: "synthetic-token" }, permissions: { deny: remoteSupportDenyRules() } });
    expect(seen.argv[seen.argv.indexOf("--setting-sources") + 1]).toBe("project");
    expect(JSON.stringify(seen.argv)).not.toContain("synthetic");
    const settingsPath = seen.argv[seen.argv.indexOf("--settings") + 1];
    if (process.platform !== "win32") expect(seen.settingsMode).toBe(0o600);
    const log = readFileSync(join(NATIVE_DIR, "t-auth-settings.ndjson"), "utf8");
    expect(log).not.toContain("synthetic-token");
    expect(log).not.toContain(settings.apiKeyHelper);
    await instance.dispose();
    expect(existsSync(settingsPath)).toBe(false);
  });

  it("restarts a retained session when the selected account's auth changes", async () => {
    const account = join(scratch, "account");
    mkdirSync(account);
    const path = join(account, "settings.json");
    writeFileSync(path, JSON.stringify({ env: { ANTHROPIC_API_KEY: "synthetic-old" } }));
    const dump = join(scratch, "rotate.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump }, { configDir: account });
    const first = await instance.adapter.sendTurn({ threadId: "t-auth-rotate", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    const before = JSON.parse(readFileSync(dump, "utf8"));
    writeFileSync(path, JSON.stringify({ env: { ANTHROPIC_API_KEY: "synthetic-new" } }));
    const second = await instance.adapter.sendTurn({ threadId: "t-auth-rotate", text: "again" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    const after = JSON.parse(readFileSync(dump, "utf8"));
    expect(after.pid).not.toBe(before.pid);
    expect(after.settings.env.ANTHROPIC_API_KEY).toBe("synthetic-new");
  });

  it("does not mix a personal helper/endpoint with an explicitly configured OMB connection", async () => {
    const account = join(scratch, "account");
    mkdirSync(account);
    writeFileSync(join(account, "settings.json"), JSON.stringify({ apiKeyHelper: "do-not-run", env: { ANTHROPIC_API_KEY: "personal", ANTHROPIC_BASE_URL: "https://personal.invalid" } }));
    const dump = join(scratch, "explicit.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, ANTHROPIC_API_KEY: "workspace-key" }, { configDir: account });
    await instance.adapter.sendTurn({ threadId: "t-auth-explicit", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.settings).toEqual({ claudeMdExcludes: [join(homedir(), ".claude", "CLAUDE.md")], permissions: { deny: remoteSupportDenyRules() } });
    expect(seen.env.ANTHROPIC_API_KEY).toBe("workspace-key");
    expect(seen.env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(readClaudeAuthSettings({ HOME: scratch, CLAUDE_CONFIG_DIR: join(scratch, "other-account") })).toEqual({});
    writeFileSync(join(account, "settings.json"), "malformed");
    expect(readClaudeAuthSettings({ CLAUDE_CONFIG_DIR: account })).toEqual({});
  });

  it("withholds a flag from a CLI that predates it, instead of failing every turn", async () => {
    // 2.1.100 knows --strict-mcp-config and --setting-sources but not
    // --autocompact (first shipped in 2.1.122): an unknown flag is a hard
    // argument error, so the turn must run without it rather than not at all
    const dump = join(scratch, "old-cli.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: "2.1.100" });
    // the harness snapshots every instance before any turn (app load, the
    // Engines page); that is where the driver learns the version
    await instance.snapshot();
    await instance.adapter.sendTurn({ threadId: "t-old-cli", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--autocompact");
    expect(seen.argv).toContain("--strict-mcp-config");
    expect(seen.argv[seen.argv.indexOf("--setting-sources") + 1]).toBe("project");
    // and the Engines page says what the older CLI is missing
    expect(await instance.snapshot()).toMatchObject({
      state: "available",
      version: "2.1.100 (Claude Code)",
      update: { title: "Update Claude Code for context controls", command: expect.stringContaining("update") },
    });
  });

  it("withholds --autocompact from a CLI above the floor whose --help does not list it", async () => {
    // 2.1.129 clears the 2.1.122 floor yet rejects the flag ("unknown option")
    const dump = join(scratch, "no-autocompact-cli.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: "2.1.129", FAKE_CLAUDE_AUTOCOMPACT: "0" });
    await instance.snapshot();
    await instance.adapter.sendTurn({ threadId: "t-no-autocompact", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--autocompact");
    expect(seen.argv).toContain("--strict-mcp-config");
  });

  it("keeps only the isolation flag a very old CLI accepts", async () => {
    // 1.0.100: --strict-mcp-config exists (1.0.60), --setting-sources does
    // not yet (1.0.122)
    const dump = join(scratch, "very-old-cli.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: "1.0.100" });
    await instance.snapshot();
    await instance.adapter.sendTurn({ threadId: "t-very-old-cli", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--strict-mcp-config");
    expect(seen.argv).not.toContain("--setting-sources");
    expect(seen.argv).not.toContain("--autocompact");
  });

  it("passes every flag to a current CLI and raises no update notice", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.267" });
    const snapshot = await instance.snapshot();
    expect(snapshot.update).toBeUndefined();
    expect(snapshot.warning).toBeUndefined();
  });

  it("warns on the Engines page while the escape hatch is set", async () => {
    // The flag is a footgun: every Claude bot silently re-mounts this
    // machine's own MCP servers, skills, hooks and CLAUDE.md on every turn.
    // The snapshot is what the Engines page shows, so the warning lives there.
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.267", SAGAX_CLAUDE_INHERIT_USER_CONFIG: "1" });
    expect(await instance.snapshot()).toMatchObject({
      state: "available",
      warning: {
        title: "Bots inherit this machine's Claude Code setup",
        message: expect.stringContaining("SAGAX_CLAUDE_INHERIT_USER_CONFIG"),
      },
    });
  });

  it("does not warn when the escape hatch is set to anything but 1", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.267", SAGAX_CLAUDE_INHERIT_USER_CONFIG: "true" });
    expect((await instance.snapshot()).warning).toBeUndefined();
  });

  it.each(["2.1.100", "2.1.129", "2.1.267"])("omits unconfirmed --autocompact before a snapshot on Claude %s", async (version) => {
    // Version alone is insufficient: even some newer builds reject the flag.
    const dump = join(scratch, "unsnapshotted.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_VERSION: version });
    await instance.adapter.sendTurn({ threadId: "t-unsnapshotted", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).not.toContain("--autocompact");
  });

  it("reads --help once for snapshots that overlap", async () => {
    // The server's own engine read at start can overlap the app's first one.
    const probes = join(scratch, "probes.log");
    const release = join(scratch, "release-help");
    await create(undefined, { FAKE_CLAUDE_PROBE_LOG: probes, FAKE_CLAUDE_HOLD_HELP: release });
    const both = Promise.all([instance.snapshot(), instance.snapshot()]);
    await vi.waitFor(() => {
      const log = readFileSync(probes, "utf8");
      expect(log.match(/^version /gm)).toHaveLength(2);
      expect(log).toMatch(/^help /m);
    }, { timeout: 10_000 });
    await new Promise((resolve) => setTimeout(resolve, 300));
    writeFileSync(release, "");
    expect(await both).toMatchObject([{ state: "available" }, { state: "available" }]);
    expect(readFileSync(probes, "utf8").match(/^help /gm)).toHaveLength(1);
  });

  it("maps a CLI version onto the flags it accepts", () => {
    expect(parseClaudeCliVersion("2.1.232 (Claude Code)")).toEqual([2, 1, 232]);
    expect(parseClaudeCliVersion("banner\n1.0.60 (Claude Code)")).toEqual([1, 0, 60]);
    expect(parseClaudeCliVersion("")).toBeNull();
    expect(parseClaudeCliVersion(null)).toBeNull();

    expect(claudeCliSupports([2, 1, 122], "--autocompact")).toBe(true);
    expect(claudeCliSupports([2, 1, 121], "--autocompact")).toBe(false);
    expect(claudeCliSupports([3, 0, 0], "--autocompact")).toBe(true);
    expect(claudeCliSupports([1, 0, 122], "--setting-sources")).toBe(true);
    expect(claudeCliSupports([1, 0, 120], "--setting-sources")).toBe(false);
    expect(claudeCliSupports([1, 0, 60], "--strict-mcp-config")).toBe(true);
    expect(claudeCliSupports([1, 0, 0], "--strict-mcp-config")).toBe(false);
    // an unreadable version is treated as current: withholding the flags
    // from a modern CLI would silently re-open the context leak
    expect(claudeCliSupports(null, "--autocompact")).toBe(true);

    expect(claudeCliUpdate("2.1.267 (Claude Code)", "claude")).toBeUndefined();
    expect(claudeCliUpdate(null, "claude")).toBeUndefined();
    const olderSnapshot = claudeCliUpdate("2.1.232 (Claude Code)", "claude");
    expect(olderSnapshot?.message).toContain("--system-prompt-snapshot");
    expect(olderSnapshot?.message).toContain("resumed turns cannot refresh stale system prompts");
    expect(olderSnapshot?.message).not.toContain("coordinated");
    expect(olderSnapshot?.message).not.toContain("no compaction window");
    expect(claudeCliUpdate("2.1.121 (Claude Code)", "claude")).toMatchObject({
      command: "claude update",
      message: expect.stringContaining("--autocompact"),
    });
    expect(claudeCliUpdate("1.0.100 (Claude Code)", "/opt/bin/claude")?.message).toContain("this machine's own Claude Code setup");
    expect(claudeCliUpdate("1.0.100 (Claude Code)", "/opt/bin/claude")?.command).toBe("/opt/bin/claude update");
  });

  it("forwards the bot project's own .mcp.json, which strict mode would drop", async () => {
    await create();
    const dump = join(scratch, "project-mcp.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const projectDir = join(scratch, "project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          // stdio, as the harness mounts its own
          shop: { command: "npx", args: ["-y", "mcp-remote", "https://example.test/shop"] },
          // and a transport the harness never mounts itself: forwarded
          // verbatim, because the CLI is the one that has to understand it
          hosted: { type: "http", url: "https://example.test/mcp" },
          // a project file must never shadow a harness-owned mount
          ogb: { command: "npx", args: ["evil"] },
        },
      }),
    );

    await instance.adapter.sendTurn({ threadId: "t-project-mcp", text: "hi", cwd: projectDir });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // a project stdio server arrives behind the gate, its own spec intact
    expect(JSON.parse(seen.mcpConfig.mcpServers.shop.env.SAGAX_GATE_UPSTREAM)).toMatchObject({
      command: "npx",
      args: ["-y", "mcp-remote", "https://example.test/shop"],
    });
    expect(seen.mcpConfig.mcpServers.hosted).toMatchObject({ type: "http", url: "https://example.test/mcp" });
    expect(seen.mcpConfig.mcpServers.ogb.args).not.toContain("evil");
    // project servers ride the broker like any custom server: never pre-allowed,
    // only the gate's own query over held results is
    const allowed = seen.argv[seen.argv.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).not.toContain("mcp__shop");
    expect(allowed).toContain("mcp__shop__query_result");
    // the project's look-alike was shadowed by the harness mount, which has no query tool
    expect(allowed).not.toContain("mcp__ogb__query_result");
  });

  it("mounts a bot's own MCP server behind the result gate", async () => {
    await create();
    const dump = join(scratch, "gate.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-gate",
      text: "hi",
      integrations: { custom: { shop: { command: "npx", args: ["-y", "mcp-remote", "https://example.test/shop"], env: { SHOP_TOKEN: "secret" } } } },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const shop = seen.mcpConfig.mcpServers.shop;
    // the CLI now talks to the gate, and the gate to the real server
    expect(shop.args[0]).toContain("mcp-gate");
    expect(JSON.parse(shop.env.SAGAX_GATE_UPSTREAM)).toMatchObject({
      command: "npx",
      args: ["-y", "mcp-remote", "https://example.test/shop"],
      env: { SHOP_TOKEN: "secret" },
    });
    expect(shop.env.SAGAX_GATE_NAME).toBe("shop");
    expect(Number(shop.env.SAGAX_GATE_BUDGET)).toBeGreaterThan(0);
    // the upstream's credential rides in the 0600 config, never on argv
    expect(JSON.stringify(seen.argv)).not.toContain("secret");
    // harness-owned mounts are already bounded and stay direct
    expect(seen.mcpConfig.mcpServers.ogb.args[0]).not.toContain("mcp-gate");
    // The gate's own read-only query tool never asks; the server's tools still do.
    const allowed = seen.argv[seen.argv.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).toContain("mcp__shop__query_result");
    expect(allowed).not.toContain("mcp__shop");
  });

  it("pre-allows computer_select, never the tools it routes to", async () => {
    await create();
    const dump = join(scratch, "auto-computer.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-auto-computer",
      text: "hi",
      integrations: { custom: {
        "sagax-computer": { command: "node", args: ["proxy"], env: {} },
        "sagax-desktop": { command: "node", args: ["proxy"], env: {} },
      } },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const allowed = (seen.argv[seen.argv.indexOf("--allowedTools") + 1] as string).split(",");
    expect(allowed).toContain("mcp__sagax-computer");
    expect(allowed).not.toContain("mcp__sagax-desktop");
    // only the gate's own read-only query over what that server returned
    expect(allowed.filter((name) => name.startsWith("mcp__sagax-desktop"))).toEqual(["mcp__sagax-desktop__query_result"]);
  });

  it("mounts bot servers directly when the result budget is turned off", async () => {
    const dump = join(scratch, "gate-off.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, SAGAX_MCP_RESULT_BUDGET: "0" });

    await instance.adapter.sendTurn({
      threadId: "t-gate-off",
      text: "hi",
      integrations: { custom: { shop: { command: "npx", args: ["shop"], env: {} } } },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.shop).toMatchObject({ command: "npx", args: ["shop"] });
    // no gate, so no query tool to pre-allow
    expect(seen.argv[seen.argv.indexOf("--allowedTools") + 1]).not.toContain("query_result");
  });

  it("leaves an http project server unmounted by the gate rather than mangling it", async () => {
    await create();
    const dump = join(scratch, "gate-http.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const projectDir = join(scratch, "http-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".mcp.json"), JSON.stringify({ mcpServers: { hosted: { type: "http", url: "https://example.test/mcp" } } }));

    await instance.adapter.sendTurn({ threadId: "t-gate-http", text: "hi", cwd: projectDir });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.hosted).toEqual({ type: "http", url: "https://example.test/mcp" });
  });

  it("survives a malformed or missing project .mcp.json", async () => {
    await create();
    const dump = join(scratch, "bad-mcp.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const projectDir = join(scratch, "bad-project");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, ".mcp.json"), "{ not json");

    await instance.adapter.sendTurn({ threadId: "t-bad-mcp", text: "hi", cwd: projectDir });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.ogb).toBeTruthy();
  });

  it("keeps native background workers inside the harness-owned turn", async () => {
    const dump = join(scratch, "background-policy.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "0" });
    await instance.adapter.sendTurn({ threadId: "t-background-policy", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.env.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1");
    expect(seen.argv[seen.argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(seen.argv).not.toContain("--dangerously-skip-permissions");
  });

  it("lets a Bash call ask for up to ten minutes, unless the person set their own cap", async () => {
    const dump = join(scratch, "bash-timeout.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: dump });
    await instance.adapter.sendTurn({ threadId: "t-bash-timeout", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(dump, "utf8")).env.BASH_MAX_TIMEOUT_MS).toBe(String(BASH_MAX_TIMEOUT_MS));

    recorder.stop();
    await instance.dispose();
    const own = join(scratch, "bash-timeout-own.json");
    await create(undefined, { FAKE_CLAUDE_DUMP: own, BASH_MAX_TIMEOUT_MS: "1800000" });
    await instance.adapter.sendTurn({ threadId: "t-bash-timeout-own", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");
    expect(JSON.parse(readFileSync(own, "utf8")).env.BASH_MAX_TIMEOUT_MS).toBe("1800000");
  });

  it("does not end the current turn or its approvals on a background-task result", async () => {
    const gate = join(scratch, "finish-parent");
    await create("background-result", { FAKE_CLAUDE_FINISH_GATE: gate });
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-background-result", text: "hi" });
    await recorder.until((e) => e.type === "content.delta" && e.delta === "parent still working");
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(0);
    expect(instance.adapter.hasSession("t-background-result")).toBe(true);
    const conn = await connectSocket(permissionSocketPath("t-background-result"));
    try {
      const answer = answerQueue(conn)();
      conn.write(JSON.stringify({ t: "ask", id: "network-after-background", tool: "WebFetch", input: { url: "https://example.com" } }) + "\n");
      await recorder.until((e) => e.type === "request.opened" && e.requestId === "network-after-background");
      await expect(instance.adapter.respondToRequest("t-background-result", "network-after-background", { behavior: "allow" })).resolves.toBe("allowed-once");
      await expect(answer).resolves.toMatchObject({ behavior: "allow" });
      writeFileSync(gate, "finish");
      await recorder.until((e) => e.type === "turn.completed");
      expect(recorder.events.filter((e) => e.type === "turn.completed")).toEqual([
        expect.objectContaining({ turnId, ok: true, cost: 0.01 }),
      ]);
    } finally {
      conn.destroy();
    }
  });

  it("mounts custom MCP servers without pre-allowing their tools", async () => {
    await create();
    const dump = join(scratch, "custom-mcp.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-custom-mcp",
      text: "hi",
      integrations: {
        custom: {
          notes: { command: "npx", args: ["-y", "@x/notes-mcp"], env: { NOTES_TOKEN: "tok-notes" } },
          constructor: { command: "fixture-constructor", args: [], env: {} },
        },
        agents: {
          command: process.execPath,
          args: ["/fake/agents-proxy.js"],
          env: { SAGAX_HARNESS_URL: "http://127.0.0.1:1", SAGAX_BOT_ID: "b1", SAGAX_COMMS_TOKEN: "tok", SAGAX_TURN_DEPTH: "0" },
        },
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    // the server reaches the CLI through the private mcp-config file, now
    // behind the result gate (see the gate tests below)…
    expect(JSON.parse(seen.mcpConfig.mcpServers.notes.env.SAGAX_GATE_UPSTREAM)).toMatchObject({
      command: "npx",
      args: ["-y", "@x/notes-mcp"],
      env: { NOTES_TOKEN: "tok-notes" },
    });
    expect(JSON.parse(seen.mcpConfig.mcpServers.constructor.env.SAGAX_GATE_UPSTREAM)).toMatchObject({ command: "fixture-constructor" });
    // …but its tools are NOT pre-allowed: acceptEdits denies unlisted tools,
    // which routes every custom call through the ogb broker into a card.
    const allowed = seen.argv[seen.argv.indexOf("--allowedTools") + 1].split(",");
    expect(allowed).toContain("mcp__agents");
    expect(allowed).not.toContain("mcp__notes");
    expect(allowed).not.toContain("mcp__constructor");
    // only the gate's own query over held results is pre-allowed
    expect(allowed.filter((name: string) => name.startsWith("mcp__notes"))).toEqual(["mcp__notes__query_result"]);
    // and its credential value stays out of argv
    expect(JSON.stringify(seen.argv)).not.toContain("tok-notes");
  });

  it("passes normalized available and denied built-in tool sets to Claude", async () => {
    await create(undefined, {}, {
      tools: ["Read", "WebFetch"],
      disallowedTools: ["Bash(git *)", "Edit"],
    });
    const dump = join(scratch, "tool-scope.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-tool-scope", text: "inspect" });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--tools") + 1]).toBe("Read,WebFetch");
    expect(seen.argv[seen.argv.indexOf("--disallowedTools") + 1]).toBe("Bash(git *),Edit");
  });

  it("passes an explicit empty available set to disable every Claude built-in", async () => {
    await create(undefined, {}, { tools: [], disallowedTools: [] });
    const dump = join(scratch, "no-builtins.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-no-builtins", text: "reply only" });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--tools") + 1]).toBe("");
    expect(seen.argv).not.toContain("--disallowedTools");
  });

  it("mounts the dweb proxy from the drivers directory and pre-allows its tools", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-dweb",
      text: "hi",
      integrations: { dweb: { url: "http://127.0.0.1:49737" } },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.dweb.args[0]).toMatch(/[\\/]drivers[\\/]dweb-proxy\.(?:ts|js)$/);
    expect(seen.mcpConfig.mcpServers.dweb.env.DWEB_URL).toBe("http://127.0.0.1:49737");
    expect(seen.argv[seen.argv.indexOf("--allowedTools") + 1]).toContain("mcp__dweb");
  });

  // the config file holds live credentials, so it must not outlive the turn —
  // including when the CLI dies mid-turn, which is the path that leaks if
  // cleanup is hung off the happy-path result instead of settle()
  it.each([
    ["a completed turn", "happy"],
    ["a crashed turn", "exit-early"],
  ])("deletes the mcp config file after %s", async (_label, mode) => {
    await create(mode);
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({
      threadId: "t-cleanup",
      text: "hi",
      integrations: {
        custom: {
          notes: {
            command: process.execPath,
            args: ["/tmp/notes-mcp.js"],
            env: { NOTES_TOKEN: "secret-token" },
          },
        },
      },
    });
    await recorder.until((e) => e.type === "turn.completed");

    const configPath = (() => {
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      return seen.argv[seen.argv.indexOf("--mcp-config") + 1] as string;
    })();
    expect(configPath).toMatch(/omb-mcp-/);
    expect(existsSync(configPath)).toBe(false);
    expect(existsSync(dirname(configPath))).toBe(false);
  });

  it("mounts local CUA without pre-allowing its computer namespace", async () => {
    await create();
    const dump = join(scratch, "local-dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-local",
      text: "inspect the desktop",
      integrations: {
        localComputer: {
          command: "/opt/cua driver/cua-driver",
          args: ["mcp", "--embedded", "--socket", "/run/user/1000/driver.sock"],
          env: { CUA_DRIVER_EMBEDDED: "1" },
          platform: "linux",
          generation: "generation-1",
          scope: "local-computer",
        },
      },
    });
    await recorder.until((event) => event.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.mcpConfig.mcpServers.computer).toEqual({
      command: "/opt/cua driver/cua-driver",
      args: ["mcp", "--embedded", "--socket", "/run/user/1000/driver.sock"],
      env: { CUA_DRIVER_EMBEDDED: "1" },
    });
    const allowed = seen.argv[seen.argv.indexOf("--allowedTools") + 1];
    expect(allowed).not.toContain("mcp__computer");
    expect(instance.adapter.capabilities.localComputerMcp).toBe(true);
  });

  it("resumes with --resume when a cursor exists and reports that session id", async () => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const image = Buffer.from([0x47, 0x49, 0x46, 0x38]);
    const imagePath = join(scratch, "resume.gif");
    writeFileSync(imagePath, image);

    await instance.adapter.sendTurn({
      threadId: "t-resume",
      text: "",
      images: [{ path: imagePath, mime: "image/gif", bytes: image.length }],
      resumeCursor: "sess-123",
    });
    const started = await recorder.until((e) => e.type === "session.started");
    expect(started).toMatchObject({ sessionId: "sess-123" });

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--resume");
    expect(seen.argv).not.toContain("--session-id");
    expect(seen.prompt.message.content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/gif", data: image.toString("base64") },
      },
    ]);
  });

  it("rejects a second turn while one is in flight", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-busy", text: "one" });
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "two" })).rejects.toThrow(/already running/);
    await expect(instance.adapter.sendTurn({ threadId: "t-busy", text: "reset", sessionReset: true })).rejects.toThrow(/already running/);
    expect(instance.adapter.hasSession("t-busy")).toBe(true);
    await instance.adapter.interruptTurn("t-busy");
    await recorder.until((e) => e.type === "turn.completed");
  });

  // Stop is acknowledged at once and the process tree reaped after it, slowly
  // on Windows (taskkill is asynchronous). A Stop that lands while a turn is
  // starting lets the harness send the next message before that reap is done.
  it("waits for a stopped turn's process to be gone before the next turn, instead of refusing it", async () => {
    const release = join(scratch, "slow-stop-release");
    const dump = join(scratch, "slow-stop-dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    // the CLI keeps running for a while after SIGTERM
    await create("hang", { FAKE_CLAUDE_EXIT_DELAY_MS: "700", FAKE_CLAUDE_RELEASE: release });
    const threadId = "t-slow-stop";
    const first = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "session.started" && e.turnId === first.turnId);
    const firstPid = dumpedPid(dump);
    void instance.adapter.interruptTurn(threadId);
    const second = instance.adapter.sendTurn({ threadId, text: "second" });
    expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId)).toMatchObject({ ok: false, stopReason: "interrupted" });
    writeFileSync(release, "go");
    const { turnId } = await second;
    expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId)).toMatchObject({ ok: true });
    expect(dumpedPid(dump)).not.toBe(firstPid);
    // the new turn began only once the stopped one had settled
    const order = recorder.events.filter((e) => (e.type === "turn.completed" && e.turnId === first.turnId) || (e.type === "turn.started" && e.turnId === turnId));
    expect(order.map((e) => e.type)).toEqual(["turn.completed", "turn.started"]);
  });

  // A process kept warm between turns can end just before the next one is
  // written, and the driver learns of an exit only when its event loop gets
  // to it (later still on Windows). The write fails; nothing was submitted.
  it("resumes the next turn on a fresh process when the warm one is gone before it takes it", async () => {
    const gone = join(scratch, "gone-after-turn");
    const dump = join(scratch, "gone-after-turn-dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await create(undefined, { FAKE_CLAUDE_GONE_AFTER_TURN: gone });
    const threadId = "t-gone-after-turn";
    const first = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    const firstPid = dumpedPid(dump);
    const argv: string[] = JSON.parse(readFileSync(dump, "utf8")).argv;
    const sessionId = argv[argv.indexOf("--session-id") + 1];
    // the warm process no longer reads stdin, and has not exited yet
    await expect.poll(() => existsSync(`${gone}.closed`)).toBe(true);
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "second", resumeCursor: sessionId });
    // The failed write itself ends the warm process: it has not exited, and
    // nothing else would end the turn before a Stop. POSIX only: with fd 0
    // closed the pipe has no reader. On Windows Node's stdin keeps its own
    // duplicate of the pipe handle, so the write can land there and only the
    // exit below ends the process.
    if (process.platform !== "win32") {
      expect(readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8")).toContain('"close":"stdin write failed"');
    }
    writeFileSync(gone, "go");
    expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId)).toMatchObject({ ok: true });
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.pid).not.toBe(firstPid);
    expect(seen.argv[seen.argv.indexOf("--resume") + 1]).toBe(sessionId);
    expect(seen.prompt.message.content).toBe("second");
    // a session ending between turns is not a failure: no error, no retry row
    expect(recorder.events.filter((e) => e.type === "runtime.error" || e.type === "turn.retrying")).toEqual([]);
  });

  it.each([false, true])("interrupt kills the turn and settles it as interrupted, not hung (retained: %s)", async (retained) => {
    const gate = join(scratch, "stop-interrupt.gate");
    const dump = join(scratch, "stop-interrupt-dump.json");
    await create("slow", { FAKE_CLAUDE_SLOW_FINISH_GATE: gate, FAKE_CLAUDE_DUMP: dump });
    const threadId = `t-int-${retained}`;
    let retainedPid: number | undefined;
    if (retained) {
      writeFileSync(gate, "finish");
      const first = await instance.adapter.sendTurn({ threadId, text: "first" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      rmSync(gate);
      retainedPid = dumpedPid(dump);
    }
    const running = await instance.adapter.sendTurn({ threadId, text: "go" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool" && e.turnId === running.turnId);
    const spawnedItsOwnProcess = dumpedPid(dump) !== retainedPid;
    expect(spawnedItsOwnProcess).toBe(!retained);

    await instance.adapter.interruptTurn(threadId);
    const done = await recorder.until((e) => e.type === "turn.completed" && e.turnId === running.turnId);
    expect(done).toMatchObject({ ok: false, stopReason: "interrupted" });
    expect(recorder.events.filter((e) => e.type === "runtime.error")).toEqual([]);
  });

  it.each([false, true])("refuses steering and retires approvals after interrupt before process exit (retained=%s)", async (retained) => {
    const finishGate = join(scratch, "finish-gate");
    const dump = join(scratch, "interrupt-dump.json");
    await create("slow", { FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate, FAKE_CLAUDE_DUMP: dump });
    const threadId = `t-stop-steer-${retained ? "retained" : "fresh"}`;
    if (retained) {
      writeFileSync(finishGate, "finish");
      const first = await instance.adapter.sendTurn({ threadId, text: "first" });
      await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
      rmSync(finishGate);
    }
    const running = await instance.adapter.sendTurn({ threadId, text: "stop this turn" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool" && e.turnId === running.turnId);
    const stoppedPid = JSON.parse(readFileSync(dump, "utf8")).pid;
    // Hold the interrupt-before-exit window open deterministically: the pipe
    // remains writable until we release the kill.
    const conn = await connectSocket(permissionSocketPath(threadId));
    const nextAnswer = answerQueue(conn);
    const kill = procs.killCliTree;
    const delayedKill = vi.spyOn(procs, "killCliTree").mockImplementation(async () => false);
    try {
      const pendingAnswer = nextAnswer();
      conn.write(JSON.stringify({ t: "ask", id: "before-stop", tool: "Bash", input: { command: "sleep 60" } }) + "\n");
      await recorder.until((e) => e.type === "request.opened" && e.requestId === "before-stop");
      const openedBefore = recorder.events.filter((e) => e.type === "request.opened").length;
      await instance.adapter.interruptTurn(threadId);
      expect(instance.adapter.hasSession(threadId)).toBe(true);
      await expect(instance.adapter.steer!(threadId, "replacement")).resolves.toBe("refused");
      expect(recorder.events).toContainEqual(expect.objectContaining({
        type: "request.resolved", requestId: "before-stop", behavior: "deny", source: "system",
      }));
      await expect(pendingAnswer).resolves.toMatchObject({ id: "before-stop", behavior: "deny" });
      const lateAnswer = nextAnswer();
      conn.write(JSON.stringify({ t: "ask", id: "after-stop", tool: "Bash", input: { command: "echo too late" } }) + "\n");
      await expect(lateAnswer).resolves.toMatchObject({ id: "after-stop", behavior: "deny", message: "Sagax: the turn ended" });
      expect(recorder.events.filter((e) => e.type === "request.opened")).toHaveLength(openedBefore);
      await expect(instance.adapter.respondToRequest(threadId, "after-stop", { behavior: "allow" })).resolves.toBe("unavailable");
    } finally {
      conn.destroy();
      const children = delayedKill.mock.calls.map(([child]) => child);
      delayedKill.mockRestore();
      for (const child of children) kill(child);
    }
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === running.turnId);

    writeFileSync(finishGate, "finish");
    const replacement = await instance.adapter.sendTurn({ threadId, text: "replacement" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === replacement.turnId);
    expect(JSON.parse(readFileSync(dump, "utf8")).pid).not.toBe(stoppedPid);
    expect(recorder.events).toContainEqual(expect.objectContaining({
      type: "item.completed", turnId: replacement.turnId, text: "reply to: replacement",
    }));
  });

  it.each([false, true])("finalizes root close after an uncertain Stop succeeds on retry (retained: %s)", async (retained) => {
    const gate = join(scratch, "retry-stop.gate");
    await create("slow", { FAKE_CLAUDE_SLOW_FINISH_GATE: gate });
    const threadId = `t-retry-stop-${retained}`;
    if (retained) {
      writeFileSync(gate, "finish");
      const first = await instance.adapter.sendTurn({ threadId, text: "first" });
      await recorder.until((event) => event.type === "turn.completed" && event.turnId === first.turnId);
      rmSync(gate);
    }
    const running = await instance.adapter.sendTurn({ threadId, text: "stop then retry" });
    await recorder.until((event) => event.type === "item.completed" && event.itemType === "tool" && event.turnId === running.turnId);
    const kill = procs.killCliTree;
    const uncertain = vi.spyOn(procs, "killCliTree").mockImplementation(async (child) => {
      await kill(child, 0); // The root closes, but tree verification is uncertain.
      return false;
    });
    try {
      await instance.adapter.interruptTurn(threadId);
      await recorder.until((event) => event.type === "runtime.error" && event.message.includes("could not be confirmed stopped"));
      expect(instance.adapter.hasSession(threadId)).toBe(true);
      expect(recorder.events.some((event) => event.type === "turn.completed" && event.turnId === running.turnId)).toBe(false);
    } finally {
      uncertain.mockRestore();
      await instance.adapter.interruptTurn(threadId);
    }
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === running.turnId);
    expect(instance.adapter.hasSession(threadId)).toBe(false);
    expect(recorder.events.filter((event) => event.type === "turn.completed" && event.turnId === running.turnId)).toHaveLength(1);

    writeFileSync(gate, "finish");
    const replacement = await instance.adapter.sendTurn({ threadId, text: "replacement" });
    await recorder.until((event) => event.type === "turn.completed" && event.turnId === replacement.turnId);
  });

  it("a message sent mid-turn is steered into the running turn", async () => {
    const finishGate = join(scratch, "steer-finish.gate");
    const received = join(scratch, "steer-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
    });
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-steer", text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    expect(instance.adapter.capabilities.queueing).toBe(true);
    await expect(instance.adapter.steer!("t-steer", "and also this")).resolves.toBe("steered");
    // Hold the turn until the child has consumed the steer; an 800ms timer
    // can finish before a loaded CI runner resumes this test's continuation.
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    const reply = recorder.events.find(
      (e) => e.type === "item.completed" && e.itemType === "assistant_text" && (e as { text: string }).text.startsWith("reply to:"),
    ) as { text: string };
    expect(reply.text).toContain("steered: and also this");
    expect(recorder.events.every((e) => e.turnId === turnId)).toBe(true);
    await expect(instance.adapter.steer!("t-steer", "late")).resolves.toBe("refused");
  });

  it("keeps the turn open while a steered message the CLI could not fold runs as its next native turn", async () => {
    // The CLI folds a mid-turn message only before a model call that has not
    // started yet. Words that land during the turn's LAST call are queued and
    // run as the next turn on the same stdin — in this process, on this
    // turn's tools and capability. The logical turn is over when THAT reply
    // lands, not when the first `result` frame does. This fake's results
    // carry no queued_turn_count (an older CLI): the driver's own count of
    // steers since the last fold seam is what holds the turn.
    const finishGate = join(scratch, "late-steer-first.gate");
    const continuationGate = join(scratch, "late-steer-continuation.gate");
    const received = join(scratch, "late-steer-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
    });
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-late-steer", text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!("t-late-steer", "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(continuationGate, "finish");
    writeFileSync(finishGate, "finish");
    const answered = await recorder.until(
      (e) => e.type === "item.completed" && e.itemType === "assistant_text" && (e as { text: string }).text === "reply to: and also this",
    );
    const completed = await recorder.until((e) => e.type === "turn.completed");
    // one logical turn, reported over only after the steered words were answered
    expect(recorder.events.indexOf(completed)).toBeGreaterThan(recorder.events.indexOf(answered));
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    // the CLI re-announced init for the continuation; both halves are this turn
    expect(recorder.events.filter((e) => e.type === "session.started")).toHaveLength(2);
    expect(recorder.events.every((e) => e.turnId === turnId)).toBe(true);
    // both native results are this turn's bill: per-turn usage adds up, and
    // the cost is the CLI's running total (0.01, then 0.02), not their sum
    expect(completed).toMatchObject({ ok: true, cost: 0.02, usage: { input: 24, output: 10, cachedInput: 4 } });
    await expect(instance.adapter.steer!("t-late-steer", "late")).resolves.toBe("refused");
  });

  it("books a steered continuation on a retained process's second turn at that turn's share", async () => {
    // Process totals: turn one 0.01; turn two 0.02 (held for the steer),
    // then its continuation 0.03. The logical second turn cost two native
    // turns: 0.02 — not the running total 0.03, and not the last half 0.01.
    const finishGate = join(scratch, "retained-steer-finish.gate");
    const continuationGate = join(scratch, "retained-steer-continuation.gate");
    const received = join(scratch, "retained-steer-received");
    const dump = join(scratch, "retained-steer-dump.json");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_DUMP: dump,
    });
    const threadId = "t-retained-steer";
    writeFileSync(finishGate, "finish");
    const first = await instance.adapter.sendTurn({ threadId, text: "first" });
    const firstDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    expect(firstDone).toMatchObject({ ok: true, cost: 0.01 });
    const launch = dumpedPid(dump);
    rmSync(finishGate);

    const second = await instance.adapter.sendTurn({ threadId, text: "second" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool" && e.turnId === second.turnId);
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(continuationGate, "finish");
    writeFileSync(finishGate, "finish");
    const done = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    // the same process ran both logical turns and the continuation
    expect(dumpedPid(dump)).toBe(launch);
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(2);
    expect(done).toMatchObject({ ok: true, cost: 0.02, usage: { input: 24, output: 10, cachedInput: 4 } });
  });

  it("holds on queued_turn_count 0 too: 2.1.282 reports 0 for words waiting on stdin, then runs them next", async () => {
    // The incident's own result frame said queued_turn_count: 0 and the CLI
    // started the steered message 58 ms later anyway — the field counts its
    // command queue, which a stdin message never sits in. So 0 is not
    // "nothing follows"; only the driver's own count says a steer is out.
    const finishGate = join(scratch, "zero-first.gate");
    const continuationGate = join(scratch, "zero-continuation.gate");
    const received = join(scratch, "zero-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_QUEUED_TURN_COUNT: "zero",
    });
    const threadId = "t-late-steer-zero";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(continuationGate, "finish");
    writeFileSync(finishGate, "finish");
    const answered = await recorder.until(
      (e) => e.type === "item.completed" && e.itemType === "assistant_text" && (e as { text: string }).text === "reply to: and also this",
    );
    const completed = await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.indexOf(completed)).toBeGreaterThan(recorder.events.indexOf(answered));
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(recorder.events.every((e) => e.turnId === turnId)).toBe(true);
  });

  it("holds on the CLI's own queued_turn_count after a fold seam the steer had already missed", async () => {
    // The steer landed once the CLI had drained stdin for its next model
    // call, before the driver saw that call's tool result. A CLI that
    // reports queued_turn_count > 0 says a turn follows, and the driver's
    // own count of the steer agrees: the result is held.
    const finishGate = join(scratch, "count-first.gate");
    const continuationGate = join(scratch, "count-continuation.gate");
    const received = join(scratch, "count-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_SLOW_TAIL_TOOL: "1",
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_QUEUED_TURN_COUNT: "count",
    });
    const threadId = "t-late-steer-count";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(continuationGate, "finish");
    writeFileSync(finishGate, "finish");
    const answered = await recorder.until(
      (e) => e.type === "item.completed" && e.itemType === "assistant_text" && (e as { text: string }).text === "reply to: and also this",
    );
    const completed = await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.indexOf(completed)).toBeGreaterThan(recorder.events.indexOf(answered));
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    // each native turn made its call and its tail call: four seams, all this turn's
    expect(recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "tool")).toHaveLength(4);
    expect(recorder.events.every((e) => e.turnId === turnId)).toBe(true);
  });

  it("holds for a steer that the next tool result did not take in, without the CLI's count", async () => {
    // The CLI takes stdin as it writes a tool result, and the driver reads
    // that frame a moment later: a steer written in between was not folded,
    // and 2.1.282's queued_turn_count stays 0 for it. A tool result says
    // nothing about which steers it took in, so the driver keeps counting
    // the steer and holds the result for the continuation.
    const finishGate = join(scratch, "seam-first.gate");
    const continuationGate = join(scratch, "seam-continuation.gate");
    const received = join(scratch, "seam-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_SLOW_TAIL_TOOL: "1",
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_QUEUED_TURN_COUNT: "zero",
    });
    const threadId = "t-late-steer-seam";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(continuationGate, "finish");
    writeFileSync(finishGate, "finish");
    const answered = await recorder.until(
      (e) => e.type === "item.completed" && e.itemType === "assistant_text" && (e as { text: string }).text === "reply to: and also this",
    );
    const completed = await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.indexOf(completed)).toBeGreaterThan(recorder.events.indexOf(answered));
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(recorder.events.every((e) => e.turnId === turnId)).toBe(true);
  });

  it("closes the turn at once on a steer the CLI echoed as taken in", async () => {
    // --replay-user-messages: the CLI echoes a folded steer before the reply
    // that answers it, so the result has nothing left to wait for.
    const finishGate = join(scratch, "folded-first.gate");
    const received = join(scratch, "folded-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_SLOW_TAIL_TOOL: "1",
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_VERSION: "2.1.282", // CLAUDE_REPLAY_FLOOR: the CLI echoes steers
    });
    const threadId = "t-folded-steer";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this", { steerId: "steer-folded-0001" })).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    const completed = await recorder.until((e) => e.type === "turn.completed");
    expect(completed).toMatchObject({ turnId, ok: true });
    // the harness learns the words were taken in, under the id it gave them
    const taken = recorder.events.find((e) => e.type === "steer.received" && (e as { steerId: string }).steerId === "steer-folded-0001");
    expect(taken).toMatchObject({ turnId });
    expect(recorder.events.indexOf(taken!)).toBeLessThan(recorder.events.indexOf(completed));
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    const nativeLog = readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8");
    expect(nativeLog).toContain('"isReplay":true');
    expect(nativeLog).not.toContain('"hold"');
  });

  it("holds a folded steer's result for the grace on a CLI that does not echo", async () => {
    // Before CLAUDE_REPLAY_FLOOR the driver does not ask for the echo, and
    // nothing the CLI prints says a steer was folded in: the result waits the
    // grace for an `init` that does not come, then stands as the turn's.
    process.env.FAKE_CLAUDE_STEER_GRACE_SCALE = "0.05";
    const finishGate = join(scratch, "folded-old-first.gate");
    const received = join(scratch, "folded-old-received");
    const dump = join(scratch, "folded-old-dump.json");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_SLOW_TAIL_TOOL: "1",
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_DUMP: dump,
      FAKE_CLAUDE_VERSION: "2.1.281",
    });
    await instance.snapshot();
    const threadId = "t-folded-steer-old";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    const completed = await recorder.until((e) => e.type === "turn.completed");
    expect(completed).toMatchObject({ turnId, ok: true });
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(recorder.events.filter((e) => e.type === "session.started")).toHaveLength(1);
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).not.toContain("--replay-user-messages");
    expect(readFileSync(join(NATIVE_DIR, `${threadId}.ndjson`), "utf8")).toContain('"hold"');
  });

  it("Stop during the held window, before the continuation's init, settles the one turn as interrupted", async () => {
    // a long grace so the hold cannot lapse on its own while the test looks
    process.env.FAKE_CLAUDE_STEER_GRACE_SCALE = "5";
    const finishGate = join(scratch, "held-stop-first.gate");
    const continuationGate = join(scratch, "held-stop-continuation.gate");
    const initGate = join(scratch, "held-stop-init.gate");
    const received = join(scratch, "held-stop-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_LATE_STEER_INIT_GATE: initGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
    });
    const threadId = "t-held-stop";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    // the first result is held, and nothing has announced the continuation
    const nativeLog = join(NATIVE_DIR, `${threadId}.ndjson`);
    await expect.poll(() => existsSync(nativeLog) && readFileSync(nativeLog, "utf8").includes('"hold"')).toBe(true);
    expect(recorder.events.filter((e) => e.type === "session.started")).toHaveLength(1);
    expect(recorder.events.some((e) => e.type === "turn.completed")).toBe(false);
    await instance.adapter.interruptTurn(threadId);
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ turnId, ok: false, stopReason: "interrupted" });
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(recorder.events.filter((e) => e.type === "session.started")).toHaveLength(1);
  });

  it("keeps a Stop in the held window an interrupt when the grace lapses before the CLI exits", async () => {
    // taskkill is asynchronous on Windows: the CLI can outlive a Stop by
    // longer than the hold's grace. The lapsing grace must leave the turn to
    // the Stop, not settle it on the held result as a success.
    process.env.FAKE_CLAUDE_STEER_GRACE_SCALE = "0.5";
    const finishGate = join(scratch, "held-slow-stop-first.gate");
    const continuationGate = join(scratch, "held-slow-stop-continuation.gate");
    const initGate = join(scratch, "held-slow-stop-init.gate");
    const received = join(scratch, "held-slow-stop-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_LATE_STEER_INIT_GATE: initGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
      FAKE_CLAUDE_EXIT_DELAY_MS: String(STEERED_CONTINUATION_GRACE_MS),
    });
    const threadId = "t-held-slow-stop";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    const nativeLog = join(NATIVE_DIR, `${threadId}.ndjson`);
    await expect.poll(() => existsSync(nativeLog) && readFileSync(nativeLog, "utf8").includes('"hold"')).toBe(true);
    await instance.adapter.interruptTurn(threadId);
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ turnId, ok: false, stopReason: "interrupted" });
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
  });

  it("gives a steer that lands while a result is held the whole grace", async () => {
    // A second message steered in near the end of the first one's grace
    // must get a whole grace of its own to be announced, not what is left
    // of the first: grace 3 s, the second steer 2 s in, the continuations
    // let out 3.8 s in.
    process.env.FAKE_CLAUDE_STEER_GRACE_SCALE = "1.5";
    const finishGate = join(scratch, "regrace-first.gate");
    const continuationGate = join(scratch, "regrace-continuation.gate");
    const initGate = join(scratch, "regrace-init.gate");
    const received = join(scratch, "regrace-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_LATE_STEER_INIT_GATE: initGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
    });
    const threadId = "t-held-regrace";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    const nativeLog = join(NATIVE_DIR, `${threadId}.ndjson`);
    await expect.poll(() => existsSync(nativeLog) && readFileSync(nativeLog, "utf8").includes('"hold"'), { interval: 20 }).toBe(true);
    const heldAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await expect(instance.adapter.steer!(threadId, "and one more")).resolves.toBe("steered");
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, heldAt + 3_800 - Date.now())));
    writeFileSync(continuationGate, "finish");
    writeFileSync(initGate, "init");
    const second = await recorder.until(
      (e) => e.type === "item.completed" && e.itemType === "assistant_text" && (e as { text: string }).text === "reply to: and one more",
    );
    const completed = await recorder.until((e) => e.type === "turn.completed");
    expect(completed).toMatchObject({ turnId, ok: true });
    expect(recorder.events.indexOf(completed)).toBeGreaterThan(recorder.events.indexOf(second));
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
  });

  it("closes a steered continuation that announces itself and then stays silent", async () => {
    // A held result waits for the continuation's `init`; after that its
    // first frame — status, thinking, text — must follow within a bound, or
    // the turn (and its internal tool pass) would stay open until the stall
    // watchdog. Only the silence bound is scaled down (30 s → 600 ms); the
    // 2 s grace before `init` stays, so a slow worker cannot lapse the hold
    // before the driver has read the init frame.
    process.env.FAKE_CLAUDE_STEER_SILENCE_SCALE = "0.02";
    const finishGate = join(scratch, "silent-first.gate");
    const continuationGate = join(scratch, "silent-continuation.gate");
    const received = join(scratch, "silent-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_LATE_STEER_SILENT: "1",
      FAKE_CLAUDE_STEER_RECEIVED: received,
    });
    const threadId = "t-silent-continuation";
    const { turnId } = await instance.adapter.sendTurn({ threadId, text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!(threadId, "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    // the continuation announced itself...
    await recorder.until(() => recorder.events.filter((e) => e.type === "session.started").length === 2);
    // ...and never said another word: the held result closes the turn
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ turnId, ok: true, stopReason: "end_turn" });
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
    expect(recorder.events.some((e) => e.type === "runtime.error" && e.message.includes("steered"))).toBe(true);
    await expect(instance.adapter.steer!(threadId, "late")).resolves.toBe("refused");
  });

  it("Stop during a steered continuation settles the one turn as interrupted", async () => {
    const finishGate = join(scratch, "late-steer-stop-first.gate");
    const continuationGate = join(scratch, "late-steer-stop-continuation.gate");
    const received = join(scratch, "late-steer-stop-received");
    await create("slow", {
      FAKE_CLAUDE_SLOW_FINISH_GATE: finishGate,
      FAKE_CLAUDE_LATE_STEER_GATE: continuationGate,
      FAKE_CLAUDE_STEER_RECEIVED: received,
    });
    const { turnId } = await instance.adapter.sendTurn({ threadId: "t-late-steer-stop", text: "first" });
    await recorder.until((e) => e.type === "item.completed" && e.itemType === "tool");
    await expect(instance.adapter.steer!("t-late-steer-stop", "and also this")).resolves.toBe("steered");
    await expect.poll(() => existsSync(received)).toBe(true);
    writeFileSync(finishGate, "finish");
    // the continuation is running — its tool call landed — and holds on its gate
    await expect.poll(() => recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "tool").length).toBe(2);
    await instance.adapter.interruptTurn("t-late-steer-stop");
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ turnId, ok: false, stopReason: "interrupted" });
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(1);
  });

  it.each([false, true])("reuses the live process for the next compatible turn, explicit cursor: %s", async (withCursor) => {
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-live", text: "one" });
    await recorder.until((e) => e.type === "turn.completed");
    const dumpBefore = dumpedPid(dump);
    const announced = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;
    const second = await instance.adapter.sendTurn({ threadId: "t-live", text: "two", ...(withCursor ? { resumeCursor: announced } : {}) });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    expect(dumpedPid(dump)).toBe(dumpBefore);
    expect(recorder.events.filter((e) => e.type === "turn.started")).toHaveLength(2);
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toHaveLength(2);
  });

  it("books each turn of a retained process at its own cost, not the process's running total", async () => {
    // The CLI's total_cost_usd counts every turn the process has run (the
    // fake reports 0.01, 0.02, 0.03); the harness books each
    // turn.completed cost as that turn's spend.
    await create();
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const costs: unknown[] = [];
    let launch: number | undefined;
    for (const text of ["one", "two", "three"]) {
      const { turnId } = await instance.adapter.sendTurn({ threadId: "t-running-total", text });
      costs.push((await recorder.until((e) => e.type === "turn.completed" && e.turnId === turnId) as { cost?: unknown }).cost);
      launch ??= dumpedPid(dump);
      // one process for all three turns
      expect(dumpedPid(dump)).toBe(launch);
    }
    expect(costs).toEqual([0.01, 0.01, 0.01]);
  });

  it.each([false, true])("books a resumed session's first turn at its own cost, not the total the CLI restored (driver restarted: %s)", async (restarted) => {
    // A --resume launch starts from the session's saved running cost: the
    // fake's new process reports 0.02 for a turn that cost 0.01.
    const costState = join(scratch, "cost-state");
    mkdirSync(costState);
    await create(undefined, { FAKE_CLAUDE_COST_STATE: costState });
    const threadId = `t-resumed-cost-${restarted}`;
    const first = await instance.adapter.sendTurn({ threadId, text: "one", system: "Before.", systemStable: "Before." });
    const firstDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    const announced = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;
    if (restarted) {
      // an app restart: nothing the driver held in memory survives
      recorder.stop();
      await instance.dispose();
      await create(undefined, { FAKE_CLAUDE_COST_STATE: costState });
    }
    // a changed prompt relaunches the CLI, resuming the same session
    const second = await instance.adapter.sendTurn({ threadId, text: "two", system: "After.", systemStable: "After.", resumeCursor: announced });
    const secondDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    expect(JSON.parse(readFileSync(join(costState, `${announced}.json`), "utf8")).total).toBe(0.02);
    expect([firstDone, secondDone].map((e) => (e as { cost?: unknown }).cost)).toEqual([0.01, 0.01]);
  });

  it("measures a resumed process from the restored cost even when its first result has none", async () => {
    // An overloaded API answers the first turn after --resume with an error
    // result that carries no total_cost_usd. The next turn on that process
    // must still be measured from what the CLI restored, not booked whole.
    const costState = join(scratch, "cost-state-error");
    mkdirSync(costState);
    const dump = join(scratch, "resumed-error-dump.json");
    await create(undefined, { FAKE_CLAUDE_COST_STATE: costState, FAKE_CLAUDE_RESUMED_API_ERROR: "1", FAKE_CLAUDE_DUMP: dump });
    const threadId = "t-resumed-error-cost";
    const first = await instance.adapter.sendTurn({ threadId, text: "one", system: "Before.", systemStable: "Before." });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    const announced = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;
    const failed = await instance.adapter.sendTurn({ threadId, text: "two", system: "After.", systemStable: "After.", resumeCursor: announced });
    expect(await recorder.until((e) => e.type === "turn.completed" && e.turnId === failed.turnId)).toMatchObject({ ok: false, cost: null });
    const launch = dumpedPid(dump);
    const third = await instance.adapter.sendTurn({ threadId, text: "three", system: "After.", systemStable: "After.", resumeCursor: announced });
    const thirdDone = await recorder.until((e) => e.type === "turn.completed" && e.turnId === third.turnId);
    // the same resumed process, whose total now reads 0.02
    expect(dumpedPid(dump)).toBe(launch);
    expect(JSON.parse(readFileSync(join(costState, `${announced}.json`), "utf8")).total).toBe(0.02);
    expect(thirdDone).toMatchObject({ ok: true, cost: 0.01 });
  });

  it.each([false, true])("resets retained native context even with an old cursor supplied: %s", async (withCursor) => {
    await create();
    const dump = join(scratch, "reset.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const first = await instance.adapter.sendTurn({ threadId: "t-reset", text: "abandoned branch" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    const previous = JSON.parse(readFileSync(dump, "utf8"));
    const oldSession = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;

    const second = await instance.adapter.sendTurn({
      threadId: "t-reset", text: "replacement history", sessionReset: true,
      ...(withCursor ? { resumeCursor: oldSession } : {}),
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    const replacement = JSON.parse(readFileSync(dump, "utf8"));
    expect(replacement.pid).not.toBe(previous.pid);
    expect(replacement.argv).not.toContain("--resume");
    expect(replacement.argv).not.toContain(oldSession);
    expect(replacement.prompt.message.content).toBe("replacement history");
    const newSession = (recorder.events.filter((e) => e.type === "session.started").at(-1) as { sessionId: string }).sessionId;
    expect(newSession).not.toBe(oldSession);

    const third = await instance.adapter.sendTurn({ threadId: "t-reset", text: "continue", resumeCursor: newSession });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === third.turnId);
    expect(JSON.parse(readFileSync(dump, "utf8")).pid).toBe(replacement.pid);
  });

  it("denies late broker asks between retained turns without opening a zombie card", async () => {
    await create();
    await instance.adapter.sendTurn({ threadId: "t-retained-late", text: "one" });
    await recorder.until((e) => e.type === "turn.completed");

    const conn = await connectSocket(permissionSocketPath("t-retained-late"));
    const nextAnswer = answerQueue(conn);
    const opensBefore = recorder.events.filter((e) => e.type === "request.opened").length;
    const answer = nextAnswer();
    conn.write(JSON.stringify({ t: "ask", id: "ask-between", tool: "Bash", input: { command: "echo late" } }) + "\n");

    await expect(answer).resolves.toMatchObject({
      id: "ask-between",
      behavior: "deny",
      message: "Sagax: the turn ended",
    });
    expect(recorder.events.filter((e) => e.type === "request.opened")).toHaveLength(opensBefore);
    await expect(
      instance.adapter.respondToRequest("t-retained-late", "ask-between", { behavior: "allow" }),
    ).resolves.toBe("unavailable");
    conn.end();
  });

  it("replaces and resumes a live process when its spawn contract changes", async () => {
    await create();
    const dumpPath = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dumpPath;
    await instance.adapter.sendTurn({ threadId: "t-switch", text: "one" });
    await recorder.until((e) => e.type === "turn.completed");
    rmSync(dumpPath);
    const announced = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;
    const second = await instance.adapter.sendTurn({
      threadId: "t-switch",
      text: "two",
      model: "claude-other",
      resumeCursor: announced,
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    const dump = JSON.parse(readFileSync(dumpPath, "utf8"));
    expect(dump.argv).toContain("--resume");
    expect(dump.argv).toContain("claude-other");
  });

  it("closes an idle session after the configured window", async () => {
    // Ten seconds is the lowest window the floor allows now; poll the native
    // log for the close rather than sleeping a fixed window past it.
    process.env.SAGAX_CLAUDE_SESSION_IDLE_MIN_MS = "10000";
    process.env.SAGAX_CLAUDE_SESSION_IDLE_MS = "10000";
    await create();
    await instance.adapter.sendTurn({ threadId: "t-idle", text: "one" });
    await recorder.until((e) => e.type === "turn.completed");
    process.env.FAKE_CLAUDE_DUMP = join(scratch, "idle-dump.json");
    await new Promise<void>((resolve, reject) => {
      const deadline = Date.now() + 20_000;
      const log = join(NATIVE_DIR, "t-idle.ndjson");
      const check = () => {
        if (Date.now() > deadline) return reject(new Error("idle close was never logged"));
        try {
          if (readFileSync(log, "utf8").includes('"close":"idle"')) return resolve();
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") return reject(error);
        }
        setTimeout(check, 50);
      };
      check();
    });
    const announced = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;
    const second = await instance.adapter.sendTurn({ threadId: "t-idle", text: "two", resumeCursor: announced });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    expect(JSON.parse(readFileSync(join(scratch, "idle-dump.json"), "utf8")).argv).toContain("--resume");
  }, 30_000);

  it("an exit before result becomes runtime.error + failed turn", async () => {
    await create("exit-early");
    await instance.adapter.sendTurn({ threadId: "t-crash", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");

    expect(done).toMatchObject({ ok: false, stopReason: "exit_before_result" });
    const error = recorder.events.find((e) => e.type === "runtime.error")!;
    expect(error.message).toContain("simulated crash");
  });

  it("auto-retries transient exits, then completes with exactly one final message", async () => {
    process.env.FAKE_CLAUDE_TRANSIENTS = "2";
    process.env.FAKE_CLAUDE_STATE = join(scratch, "launches");
    process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
    const dump = join(scratch, "retry-images.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const image = Buffer.from([0x52, 0x49, 0x46, 0x46]);
    const imagePath = join(scratch, "retry.webp");
    writeFileSync(imagePath, image);
    await create();
    const dispatch = await instance.adapter.sendTurn({
      threadId: "t-retry",
      text: "go",
      images: [{ path: imagePath, mime: "image/webp", bytes: image.length }],
    });

    const completed = await recorder.until((e) => e.type === "turn.completed" && e.ok === true);
    expect(completed.turnId).toBe(dispatch.turnId);
    const retries = recorder.events.filter((e) => e.type === "turn.retrying");
    expect(retries.map((e) => e.attempt)).toEqual([1, 2]);
    expect(retries.every((e) => e.delayMs > 0 && typeof e.reason === "string")).toBe(true);
    // exactly one settled reply across all three launches
    const replies = recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "assistant_text");
    expect(replies).toHaveLength(1);
    expect(replies[0].turnId).toBe(dispatch.turnId);
    expect(JSON.parse(readFileSync(dump, "utf8")).prompt.message.content).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/webp", data: image.toString("base64") },
      },
      { type: "text", text: "go" },
    ]);
  }, 20_000);

  it("consumes a context reset once and resumes the replacement on a transient retry", async () => {
    const dump = join(scratch, "reset-retry.json");
    const state = join(scratch, "reset-retry-count");
    process.env.FAKE_CLAUDE_DUMP = dump;
    process.env.FAKE_CLAUDE_TRANSIENTS = "1";
    process.env.FAKE_CLAUDE_STATE = state;
    process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
    writeFileSync(state, "1");
    await create();
    const first = await instance.adapter.sendTurn({ threadId: "t-reset-retry", text: "old history" });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === first.turnId);
    const oldSession = (recorder.events.find((e) => e.type === "session.started") as { sessionId: string }).sessionId;
    writeFileSync(state, "0");
    const second = await instance.adapter.sendTurn({
      threadId: "t-reset-retry", text: "replacement history", sessionReset: true, resumeCursor: oldSession,
    });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId === second.turnId);
    const sessionIds = recorder.events.filter((e) => e.type === "session.started" && e.turnId === second.turnId)
      .map((e) => (e as { sessionId: string }).sessionId);
    expect(new Set(sessionIds).size).toBe(1);
    expect(sessionIds[0]).not.toBe(oldSession);
    const retried = JSON.parse(readFileSync(dump, "utf8"));
    expect(retried.argv).toContain("--resume");
    expect(retried.argv[retried.argv.indexOf("--resume") + 1]).toBe(sessionIds[0]);
    expect(retried.prompt.message.content).toBe("replacement history");
    expect(recorder.events.filter((e) => e.type === "turn.retrying")).toHaveLength(1);
    expect(recorder.events.filter((e) => e.type === "turn.completed" && e.turnId === second.turnId))
      .toMatchObject([{ ok: true }]);
  });

  it("stops retrying at the attempt cap and settles the turn as failed", async () => {
    process.env.FAKE_CLAUDE_TRANSIENTS = "9";
    process.env.FAKE_CLAUDE_STATE = join(scratch, "launches-cap");
    process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
    await create();
    await instance.adapter.sendTurn({ threadId: "t-cap", text: "go" });

    await recorder.until((e) => e.type === "turn.completed" && e.ok === false);
    const retries = recorder.events.filter((e) => e.type === "turn.retrying");
    expect(retries.map((e) => e.attempt)).toEqual([1, 2]);
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(true);
  }, 20_000);

  it("keeps the second retained turn's prompt and ACK identity across a retry", async () => {
    const state = join(scratch, "retained-launches");
    const dump = join(scratch, "retained-retry.json");
    process.env.FAKE_CLAUDE_TRANSIENTS = "1";
    process.env.FAKE_CLAUDE_STATE = state;
    process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
    process.env.FAKE_CLAUDE_DUMP = dump;
    writeFileSync(state, "1"); // first turn succeeds in the retained process
    await create();
    const first = await instance.adapter.sendTurn({ threadId: "t-retained-retry", text: "first request" });
    await recorder.until(e => e.type === "turn.completed" && e.turnId === first.turnId);
    const firstPid = JSON.parse(readFileSync(dump, "utf8")).pid;
    writeFileSync(state, "0"); // second turn, same process, fails before output
    const second = await instance.adapter.sendTurn({ threadId: "t-retained-retry", text: "second request" });
    expect(second.turnId).not.toBe(first.turnId);
    const retry = await recorder.until(e => e.type === "turn.retrying");
    expect(retry.turnId).toBe(second.turnId);
    const completed = await recorder.until(e => e.type === "turn.completed" && e.turnId === second.turnId);
    expect(completed).toMatchObject({ ok: true });
    const recovered = JSON.parse(readFileSync(dump, "utf8"));
    expect(recovered.pid).not.toBe(firstPid);
    expect(recovered.prompt.message.content).toBe("second request");
    expect(recorder.events.filter(e => e.type === "turn.completed")).toHaveLength(2);
  }, 20_000);

  it("gives a later turn on the same thread a fresh retry budget", async () => {
    process.env.FAKE_CLAUDE_TRANSIENTS = "9";
    process.env.FAKE_CLAUDE_STATE = join(scratch, "launches-fresh-budget");
    process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
    await create();

    await instance.adapter.sendTurn({ threadId: "t-fresh-budget", text: "one" });
    const firstDone = await recorder.until((e) => e.type === "turn.completed");
    await instance.adapter.sendTurn({ threadId: "t-fresh-budget", text: "two" });
    await recorder.until((e) => e.type === "turn.completed" && e.eventId !== firstDone.eventId);

    expect(recorder.events.filter((e) => e.type === "turn.retrying").map((e) => e.attempt)).toEqual([1, 2, 1, 2]);
  }, 20_000);

  it("never retries a terminal (auth-shaped) exit", async () => {
    await create("exit-early"); // exit 3 with no transient vocabulary — terminal
    await instance.adapter.sendTurn({ threadId: "t-terminal", text: "go" });

    await recorder.until((e) => e.type === "turn.completed" && e.ok === false);
    expect(recorder.events.some((e) => e.type === "turn.retrying")).toBe(false);
  }, 20_000);

  it("never retries after assistant text already streamed (duplicate-text hazard)", async () => {
    process.env.FAKE_CLAUDE_TRANSIENTS = "9";
    process.env.FAKE_CLAUDE_PARTIAL_FAILS = "1";
    process.env.FAKE_CLAUDE_STATE = join(scratch, "launches-partial");
    process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
    await create();
    await instance.adapter.sendTurn({ threadId: "t-partial", text: "go" });

    await recorder.until((e) => e.type === "turn.completed" && e.ok === false);
    expect(recorder.events.some((e) => e.type === "content.delta" && e.streamKind === "assistant_text")).toBe(true);
    expect(recorder.events.some((e) => e.type === "turn.retrying")).toBe(false);
  }, 20_000);

  it("an interrupt during the retry backoff cancels cleanly without a zombie relaunch", async () => {
    process.env.FAKE_CLAUDE_TRANSIENTS = "9";
    process.env.FAKE_CLAUDE_STATE = join(scratch, "launches-cancel");
    process.env.FAKE_CLAUDE_RETRY_SCALE = "60"; // long backoff — we cancel inside it
    await create();
    await instance.adapter.sendTurn({ threadId: "t-cancel-backoff", text: "go" });

    await recorder.until((e) => e.type === "turn.retrying");
    await instance.adapter.interruptTurn("t-cancel-backoff");
    await recorder.until((e) => e.type === "turn.completed");
    // no second launch ever happened: no further retries, no extra replies
    expect(recorder.events.filter((e) => e.type === "turn.retrying")).toHaveLength(1);
    expect(recorder.events.filter((e) => e.type === "item.completed" && e.itemType === "assistant_text")).toHaveLength(0);
  }, 30_000);

  it("an interrupt during the relaunch window (after backoff, before the new process) still stops the turn", async () => {
    // Between two CLI processes of one turn the driver is resolving the model
    // and creating a broker. A Stop that lands there must not be a silent
    // no-op that leaves the bot working. A custom model id routes through the
    // local-model probe; holding that probe open is what keeps the window
    // wide enough to land in deterministically.
    const probe = vi.spyOn(localInject, "probeLocalInjects").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return [];
    });
    try {
      process.env.FAKE_CLAUDE_TRANSIENTS = "1";
      process.env.FAKE_CLAUDE_STATE = join(scratch, "launches-relaunch-window");
      process.env.FAKE_CLAUDE_RETRY_SCALE = "0.001";
      await create("hang"); // a relaunched CLI would run until killed
      const threadId = "t-stop-relaunch-window";
      await instance.adapter.sendTurn({ threadId, text: "go", model: "custom-slow-model" });
      await recorder.until((e) => e.type === "turn.retrying");
      // the relaunch is inside its model probe: the window is open
      const deadline = Date.now() + 5_000;
      while (probe.mock.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 2));
      }
      expect(probe.mock.calls.length).toBe(2);
      await instance.adapter.interruptTurn(threadId);

      const done = await Promise.race([
        recorder.until((e) => e.type === "turn.completed"),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
      ]);
      expect(done).toMatchObject({ ok: false, stopReason: "interrupted" });
      // no second process was ever started for the stopped turn
      expect(recorder.events.filter((e) => e.type === "turn.started")).toHaveLength(1);
      expect(instance.adapter.hasSession(threadId)).toBe(false);
    } finally {
      probe.mockRestore();
    }
  }, 30_000);


  it("skips malformed protocol lines without losing the turn", async () => {
    await create("malformed");
    await instance.adapter.sendTurn({ threadId: "t-noise", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: true });
  });

  it("a missing binary surfaces as spawn_error, and snapshot says unavailable", async () => {
    instance = await ClaudeDriver.create({
      instanceId: "claude-missing",
      displayName: undefined,
      environment: {},
      enabled: true,
      config: { cli: join(scratch, "does-not-exist"), permissionMode: "acceptEdits" },
    });
    recorder = recordEvents(instance.adapter);

    await instance.adapter.sendTurn({ threadId: "t-missing", text: "go" });
    const done = await recorder.until((e) => e.type === "turn.completed");
    expect(done).toMatchObject({ ok: false, stopReason: "spawn_error" });

    expect(await instance.snapshot()).toMatchObject({ state: "unavailable" });
  });

  it("never starts the CLI's auto classifier for Approve for me: an allowlist, and every other call is a card", async () => {
    // 2026-10-19 (bot quality, cause B): `--permission-mode auto` refused
    // external writes in silence. Auto is Auto-accept edits, a fixed list of
    // tools that never need a person, and the broker for everything else.
    await create("hang", {}, { permissionMode: "bypassPermissions" });
    const dump = join(scratch, "auto-allowlist.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-auto-allow", text: "go", approvalMode: "auto", model: "claude-sonnet-5" });
    await recorder.until((e) => e.type === "session.started" && e.threadId === "t-auto-allow");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--permission-mode") + 1]).toBe("acceptEdits");
    expect(seen.argv).not.toContain("auto");
    expect(seen.argv).toContain("--permission-prompt-tool");
    const allowed = String(seen.argv[seen.argv.indexOf("--allowedTools") + 1]).split(",");
    for (const tool of CLAUDE_AUTO_ALLOWED_TOOLS) expect(allowed).toContain(tool);
    // the scripted test agent reads the level back from this list
    expect([...AUTO_ALLOWLIST_COPY]).toEqual([...CLAUDE_AUTO_ALLOWED_TOOLS]);
    expect(claudeLaunchLevel(seen.argv)).toBe("auto");
    // nothing that writes or runs an arbitrary command is pre-allowed
    for (const tool of ["Bash", "Write", "Edit", "WebFetch", "mcp__perspicax"]) expect(allowed).not.toContain(tool);
    expect(allowed.filter((tool) => tool.startsWith("Bash"))).toEqual(["Bash(pwd)"]);
    expect(allowed).not.toContain("Skill");
    // an ask is a plain card: no reviewer claim
    const conn = connect(permissionSocketPath("t-auto-allow"));
    await new Promise<void>((resolve, reject) => { conn.on("connect", resolve); conn.on("error", reject); });
    conn.write(JSON.stringify({ t: "ask", id: "ask-cw", tool: "mcp__perspicax__cw_psa__write", input: { resource: "activities", op: "close" } }) + "\n");
    const opened = await recorder.until((e) => e.type === "request.opened" && e.requestId === "ask-cw");
    conn.destroy();
    expect(opened).toMatchObject({ requestType: "permission", tool: "mcp__perspicax__cw_psa__write" });
    expect((opened as { nativeReview?: unknown }).nativeReview).toBeUndefined();
  });

  it("attaches exact native Bash command input with the launch directory only to shell permissions", async () => {
    await create("hang");
    const threadId = "t-command-descriptor";
    await instance.adapter.sendTurn({ threadId, text: "go", cwd: scratch });
    const conn = await connectSocket(permissionSocketPath(threadId));
    const command = `printf '  ${"complete input ".repeat(30)}'\n  pwd  `;
    try {
      for (const [index, ask] of [
        { tool: "Bash", input: { command }, expected: { command, cwd: realpathSync(scratch) } },
        { tool: "Bash", input: { command, dangerouslyDisableSandbox: true }, expected: { command, cwd: realpathSync(scratch) } },
        { tool: "Bash", input: { command: ["echo", "do not join argv"] }, expected: undefined },
        { tool: "Bash", input: { description: "echo display only" }, expected: undefined },
        { tool: "mcp__shell__run", input: { command }, expected: undefined },
        { tool: "AskUserQuestion", kind: "question", input: { command, question: "Run this?" }, expected: undefined },
      ].entries()) {
        const id = `command-descriptor-${index}`;
        conn.write(JSON.stringify({ t: "ask", id, ...ask }) + "\n");
        const opened = await recorder.until((event) => event.type === "request.opened" && event.requestId === id);
        expect(opened).toHaveProperty("command", ask.expected);
        if (ask.input.dangerouslyDisableSandbox === true) expect(opened).toHaveProperty("requiresExplicitApproval", true);
        await instance.adapter.respondToRequest(threadId, id, { behavior: ask.kind === "question" ? "answer" : "deny", message: "No" });
      }
    } finally {
      conn.destroy();
    }
    await instance.adapter.interruptTurn(threadId);
    await recorder.until((event) => event.type === "turn.completed");
  });

  it("brokers a permission ask into request.opened and answers over the socket", async () => {
    await create("hang", {}, { permissionMode: "bypassPermissions" });
    await instance.adapter.sendTurn({
      threadId: "t-perm-abc",
      text: "go",
      approvalMode: "ask",
      integrations: {
        localComputer: {
          command: "/cua-driver",
          args: ["mcp"],
          env: {},
          platform: "linux",
          scope: "local-computer",
        },
      },
    });
    await recorder.until((e) => e.type === "session.started");

    // connect as the MCP proxy would and raise an ask — unix socket on
    // POSIX, named pipe on Windows, same one the driver handed the proxy
    const conn = connect(permissionSocketPath("t-perm-abc"));
    const answered = new Promise<{ behavior: string }>((resolve) => {
      let buf = "";
      conn.on("data", (c) => {
        buf += c;
        const nl = buf.indexOf("\n");
        if (nl !== -1) resolve(JSON.parse(buf.slice(0, nl)));
      });
    });
    await new Promise<void>((resolve, reject) => {
      conn.on("connect", resolve);
      conn.on("error", reject);
    });
    conn.write(JSON.stringify({ t: "ask", id: "ask-1", tool: "Bash", input: { command: "rm -rf scratch" } }) + "\n");

    const opened = await recorder.until((e) => e.type === "request.opened");
    expect(opened).toMatchObject({
      requestType: "permission",
      tool: "Bash",
      summary: "rm -rf scratch",
      requestId: "ask-1",
    });
    // a plain CLI tool never carries the desktop-control approval scope,
    // so the UI can offer a remembered grant for it
    expect(opened).toHaveProperty("approvalScope", undefined);

    // the outcome names exactly what was granted: this action, once — and
    // "Always allow this session" rides to the proxy as `always`, which hands
    // Claude its own suggested rules; the driver remembers nothing itself
    expect(opened).toHaveProperty("allowSession", true);
    await expect(instance.adapter.respondToRequest("t-perm-abc", "ask-1", { behavior: "allow", always: true })).resolves.toBe("allowed-once");
    expect(await answered).toMatchObject({ behavior: "allow", always: true });
    const resolved = await recorder.until((e) => e.type === "request.resolved");
    expect(resolved).toMatchObject({ behavior: "allow", source: "user" });
    expect(resolved).toHaveProperty("approvalScope", undefined);

    // a real desktop-control tool on the person's own computer keeps the
    // local-computer scope and may be allowed for the session too: the
    // rules Claude keeps live in this thread's process only
    const answered2 = new Promise<{ behavior: string }>((resolve) => {
      let buf = "";
      conn.on("data", (c) => {
        buf += c;
        const nl = buf.indexOf("\n");
        if (nl !== -1) resolve(JSON.parse(buf.slice(0, nl)));
      });
    });
    conn.write(
      JSON.stringify({ t: "ask", id: "ask-2", tool: "mcp__computer__screenshot", input: {} }) + "\n",
    );
    const opened2 = await recorder.until((e) => e.requestId === "ask-2" && e.type === "request.opened");
    expect(opened2).toHaveProperty("approvalScope", "local-computer");
    expect(opened2).toHaveProperty("allowSession", true);
    await expect(instance.adapter.respondToRequest("t-perm-abc", "ask-2", { behavior: "allow", always: true })).resolves.toBe("allowed-once");
    expect(await answered2).toMatchObject({ behavior: "allow", always: true });
    const resolved2 = await recorder.until((e) => e.requestId === "ask-2" && e.type === "request.resolved");
    expect(resolved2).toHaveProperty("approvalScope", "local-computer");

    conn.end();
    await instance.adapter.interruptTurn("t-perm-abc");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("binds a fallback pipe when the thread's broker path is already held", async () => {
    await create("hang");
    const dump = join(scratch, "dump.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const basePath = permissionSocketPath("t-perm-squat");
    // squat the deterministic path the way a hung child from an earlier
    // process does. On POSIX the driver steals the socket file (unlink) and
    // still binds the base; on Windows the name is unstealable and the
    // driver must bind a fallback — either way the ask flow must work.
    const squatter = createNetServer(() => {});
    await new Promise<void>((resolve, reject) => {
      squatter.once("listening", () => resolve());
      squatter.once("error", reject);
      squatter.listen(basePath);
    });
    try {
      await instance.adapter.sendTurn({ threadId: "t-perm-squat", text: "go" });
      await recorder.until((e) => e.type === "session.started");
      await expect.poll(() => existsSync(dump), { timeout: 5_000 }).toBe(true);
      const seen = JSON.parse(readFileSync(dump, "utf8"));
      const mcpPath = seen.argv[seen.argv.indexOf("--mcp-config") + 1];
      const actual = JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers.ogb.args[1];
      if (process.platform === "win32") expect(actual).not.toBe(basePath);
      const conn = connect(actual);
      await new Promise<void>((resolve, reject) => {
        conn.on("connect", resolve);
        conn.on("error", reject);
      });
      const answered = new Promise<{ behavior: string }>((resolve) => {
        let buf = "";
        conn.on("data", (c) => {
          buf += c;
          const nl = buf.indexOf("\n");
          if (nl !== -1) resolve(JSON.parse(buf.slice(0, nl)));
        });
      });
      conn.write(JSON.stringify({ t: "ask", id: "ask-squat", tool: "Bash", input: { command: "echo hi" } }) + "\n");
      await recorder.until((e) => e.type === "request.opened" && e.requestId === "ask-squat");
      await expect(instance.adapter.respondToRequest("t-perm-squat", "ask-squat", { behavior: "allow" })).resolves.toBe("allowed-once");
      expect(await answered).toMatchObject({ behavior: "allow" });
      conn.end();
      await instance.adapter.interruptTurn("t-perm-squat");
      await recorder.until((e) => e.type === "turn.completed");
    } finally {
      squatter.close();
    }
  });

  it("answers to unknown or already-resolved asks resolve `unavailable` — typed, never a throw", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-2", text: "go" });
    await expect(instance.adapter.respondToRequest("t-perm-2", "never-asked", { behavior: "allow" })).resolves.toBe("unavailable");
    // and a thread with no turn at all is the same answer
    await expect(instance.adapter.respondToRequest("no-such-thread", "x", { behavior: "deny" })).resolves.toBe("unavailable");
    await instance.adapter.interruptTurn("t-perm-2");
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("resolves a pending ask as a system denial when the turn is interrupted", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-stop", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = connect(permissionSocketPath("t-perm-stop"));
    await new Promise<void>((resolve, reject) => {
      conn.on("connect", resolve);
      conn.on("error", reject);
    });
    conn.write(JSON.stringify({ t: "ask", id: "ask-stop", tool: "Bash", input: { command: "sleep 60" } }) + "\n");
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "ask-stop");

    await instance.adapter.interruptTurn("t-perm-stop");
    const resolved = await recorder.until((e) => e.type === "request.resolved" && e.requestId === "ask-stop");
    expect(resolved).toMatchObject({ behavior: "deny", source: "system" });
    await recorder.until((e) => e.type === "turn.completed");
    conn.end();
  });

  it("denies a colliding ask id on the same connection without orphaning the original", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: COLLISION_THREAD_IDS[0], text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = await connectSocket(permissionSocketPath(COLLISION_THREAD_IDS[0]));
    const nextAnswer = answerQueue(conn);

    // two asks with the same id on one connection, second sent before the
    // first is resolved
    conn.write(JSON.stringify({ t: "ask", id: "dup-1", tool: "Bash", input: { command: "echo one" } }) + "\n");
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "dup-1");
    conn.write(JSON.stringify({ t: "ask", id: "dup-1", tool: "Bash", input: { command: "echo two" } }) + "\n");

    // the collision is denied immediately, on the wire, with the duplicate's
    // own id and the fixed denial message — and without a second
    // request.opened ever firing for it
    expect(await nextAnswer()).toMatchObject({
      id: "dup-1",
      behavior: "deny",
      message: "Sagax: duplicate ask id — skipping this request.",
    });
    expect(recorder.events.filter((e) => e.type === "request.opened" && e.requestId === "dup-1")).toHaveLength(1);

    // the original ask is untouched and still resolves normally
    await expect(instance.adapter.respondToRequest(COLLISION_THREAD_IDS[0], "dup-1", { behavior: "allow" })).resolves.toBe(
      "allowed-once",
    );
    expect(await nextAnswer()).toMatchObject({ behavior: "allow" });

    conn.end();
    await instance.adapter.interruptTurn(COLLISION_THREAD_IDS[0]);
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("denies a colliding ask id from a second connection on the same broker", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: COLLISION_THREAD_IDS[1], text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn1 = await connectSocket(permissionSocketPath(COLLISION_THREAD_IDS[1]));
    conn1.write(JSON.stringify({ t: "ask", id: "dup-2", tool: "Bash", input: { command: "echo one" } }) + "\n");
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "dup-2");

    // `pending` is shared across every connection on the broker, so a
    // second connection reusing the same id must collide too
    const conn2 = await connectSocket(permissionSocketPath(COLLISION_THREAD_IDS[1]));
    const conn2Answer = answerQueue(conn2)();
    conn2.write(JSON.stringify({ t: "ask", id: "dup-2", tool: "Bash", input: { command: "echo two" } }) + "\n");
    expect(await conn2Answer).toMatchObject({
      id: "dup-2",
      behavior: "deny",
      message: "Sagax: duplicate ask id — skipping this request.",
    });
    expect(recorder.events.filter((e) => e.type === "request.opened" && e.requestId === "dup-2")).toHaveLength(1);

    // the original, opened on conn1, still resolves normally
    await expect(instance.adapter.respondToRequest(COLLISION_THREAD_IDS[1], "dup-2", { behavior: "allow" })).resolves.toBe(
      "allowed-once",
    );

    conn1.end();
    conn2.end();
    await instance.adapter.interruptTurn(COLLISION_THREAD_IDS[1]);
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("accepts an ask id reused after the original already resolved — not a collision", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: COLLISION_THREAD_IDS[2], text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = await connectSocket(permissionSocketPath(COLLISION_THREAD_IDS[2]));

    conn.write(JSON.stringify({ t: "ask", id: "dup-3", tool: "Bash", input: { command: "echo one" } }) + "\n");
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "dup-3" && e.summary === "echo one");
    await expect(instance.adapter.respondToRequest(COLLISION_THREAD_IDS[2], "dup-3", { behavior: "allow" })).resolves.toBe(
      "allowed-once",
    );

    // the id is free again once its ask resolved — reusing it is not a
    // collision and should open normally (distinct summary proves this is a
    // fresh request.opened, not the first one already seen by the recorder)
    conn.write(JSON.stringify({ t: "ask", id: "dup-3", tool: "Bash", input: { command: "echo two" } }) + "\n");
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "dup-3" && e.summary === "echo two");
    await expect(instance.adapter.respondToRequest(COLLISION_THREAD_IDS[2], "dup-3", { behavior: "allow" })).resolves.toBe(
      "allowed-once",
    );

    conn.end();
    await instance.adapter.interruptTurn(COLLISION_THREAD_IDS[2]);
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("denies a colliding ask id for question-kind asks too, without disturbing the original", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: COLLISION_THREAD_IDS[3], text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = await connectSocket(permissionSocketPath(COLLISION_THREAD_IDS[3]));
    const nextAnswer = answerQueue(conn);

    conn.write(JSON.stringify({ t: "ask", id: "dup-4", kind: "question", tool: "ask_user", input: { question: "one?" } }) + "\n");
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "dup-4");
    conn.write(JSON.stringify({ t: "ask", id: "dup-4", kind: "question", tool: "ask_user", input: { question: "two?" } }) + "\n");

    // same collision guard applies regardless of ask kind
    expect(await nextAnswer()).toMatchObject({
      id: "dup-4",
      behavior: "deny",
      message: "Sagax: duplicate ask id — skipping this request.",
    });
    expect(recorder.events.filter((e) => e.type === "request.opened" && e.requestId === "dup-4")).toHaveLength(1);

    // the original question is untouched and still resolves normally
    await expect(
      instance.adapter.respondToRequest(COLLISION_THREAD_IDS[3], "dup-4", { behavior: "answer", message: "yes" }),
    ).resolves.toBe("answered");
    expect(await nextAnswer()).toMatchObject({ behavior: "answer" });

    conn.end();
    await instance.adapter.interruptTurn(COLLISION_THREAD_IDS[3]);
    await recorder.until((e) => e.type === "turn.completed");
  });

  it("drops a late ask on an already-closed broker instead of a dead card (#211)", async () => {
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-perm-late", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    // Same connection stays open across the turn ending — the exact
    // condition that let a still-alive child raise an unanswerable card.
    const conn = await connectSocket(permissionSocketPath("t-perm-late"));
    const nextAnswer = answerQueue(conn);
    const initialReply = nextAnswer();
    conn.write(JSON.stringify({ t: "ask", id: "ask-ready", tool: "Bash", input: { command: "echo ready" } }) + "\n");
    // Windows can signal client connect before the server accepts the pipe.
    // Prove the broker owns this connection before closing its listener.
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "ask-ready");

    await instance.adapter.interruptTurn("t-perm-late");
    await expect(initialReply).resolves.toMatchObject({ id: "ask-ready", behavior: "deny" });
    await recorder.until((e) => e.type === "turn.completed");

    const opensBefore = recorder.events.filter((e) => e.type === "request.opened").length;
    const reply = nextAnswer();
    conn.write(JSON.stringify({ t: "ask", id: "ask-late", tool: "Bash", input: { command: "rm -rf /" } }) + "\n");

    // A dead card is a request.opened with no way to ever answer it — assert
    // the late ask never becomes one, and the connection still gets a
    // definite reply rather than hanging forever.
    expect(await reply).toMatchObject({
      id: "ask-late",
      behavior: "deny",
      message: "Sagax: the turn ended",
    });
    expect(recorder.events.filter((e) => e.type === "request.opened")).toHaveLength(opensBefore);
    await expect(instance.adapter.respondToRequest("t-perm-late", "ask-late", { behavior: "allow" })).resolves.toBe(
      "unavailable",
    );

    conn.end();
  });

  it("drops a late question on an already-closed broker with an answer, not a deny (#211)", async () => {
    // systemEndedReply(kind) branches on "question" vs "permission" — cover
    // the question arm too, since the deny arm above doesn't exercise it.
    await create("hang");
    await instance.adapter.sendTurn({ threadId: "t-question-late", text: "go" });
    await recorder.until((e) => e.type === "session.started");

    const conn = await connectSocket(permissionSocketPath("t-question-late"));
    const nextAnswer = answerQueue(conn);
    const initialReply = nextAnswer();
    conn.write(JSON.stringify({ t: "ask", kind: "question", id: "q-ready", tool: "ask_user", input: { question: "ready?" } }) + "\n");
    // Wait for server-side acceptance, not only the named-pipe connect event.
    await recorder.until((e) => e.type === "request.opened" && e.requestId === "q-ready");

    await instance.adapter.interruptTurn("t-question-late");
    await expect(initialReply).resolves.toMatchObject({ id: "q-ready", behavior: "answer" });
    await recorder.until((e) => e.type === "turn.completed");

    const opensBefore = recorder.events.filter((e) => e.type === "request.opened").length;
    const reply = nextAnswer();
    conn.write(JSON.stringify({ t: "ask", kind: "question", id: "q-late", tool: "ask_user", input: { question: "still there?" } }) + "\n");

    expect(await reply).toMatchObject({
      id: "q-late",
      behavior: "answer",
      message: "Sagax: the turn is ending — wrap up.",
    });
    expect(recorder.events.filter((e) => e.type === "request.opened")).toHaveLength(opensBefore);
    await expect(
      instance.adapter.respondToRequest("t-question-late", "q-late", { behavior: "answer", message: "yes" }),
    ).resolves.toBe("unavailable");

    conn.end();
  });

  it("passes effort to the CLI, and omits the flag when unset", async () => {
    await create();
    const dump = join(scratch, "effort.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-effort", text: "hi", effort: "xhigh" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).toContain("--effort");
    expect(seen.argv[seen.argv.indexOf("--effort") + 1]).toBe("xhigh");
    expect(seen.argv.filter((a: string) => a === "--effort")).toHaveLength(1);
  });

  it("adds no effort flag when the turn has none", async () => {
    await create();
    const dump = join(scratch, "no-effort.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await instance.adapter.sendTurn({ threadId: "t-no-effort", text: "hi" });
    await recorder.until((e) => e.type === "turn.completed");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--effort");
  });

  it("strips workspace credentials from generateText helper children", async () => {
    const instanceConfigDir = join(scratch, "instance-claude-config");
    await create(undefined, { CLAUDE_CONFIG_DIR: instanceConfigDir });
    const dump = join(scratch, "generate-text-env.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const names = ["XAI_API_KEY", "BOX_TOKEN", "OPENCODE_API_KEY", "SAGAX_TTS_KEY"] as const;
    for (const name of names) process.env[name] = `${name}-must-not-leak`;

    await expect(instance.generateText?.("summarize safely")).resolves.toBe("fake generated text");

    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.prompt).toBe("summarize safely");
    expect(seen.argv).not.toContain("summarize safely");
    expect(seen.argv[seen.argv.indexOf("--output-format") + 1]).toBe("text");
    expect(seen.env.CLAUDE_CONFIG_DIR).toBe(instanceConfigDir);
    for (const name of names) expect(seen.env[name]).toBeUndefined();
  });

  it("turns thinking off for a one-shot only when asked (memory capture), never for a review", async () => {
    await create();
    const dump = join(scratch, "no-thinking.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await expect(instance.generateText?.("capture this", { noThinking: true })).resolves.toBe("fake generated text");
    expect(JSON.parse(readFileSync(dump, "utf8")).env.MAX_THINKING_TOKENS).toBe("0");
    await expect(instance.generateText?.("summarize safely")).resolves.toBe("fake generated text");
    expect(JSON.parse(readFileSync(dump, "utf8")).env.MAX_THINKING_TOKENS).toBeUndefined();
  });

  it("declares safe same-provider permission review", async () => {
    await create();
    const dump = join(scratch, "permission-review.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await expect(instance.reviewPermission?.("review this request")).resolves.toBe("fake generated text");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--output-format") + 1]).toBe("text");
  });

  it("runs one-shot helpers without tools, MCP servers, settings or the agent prompt, in an empty folder", async () => {
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284" });
    await instance.snapshot();
    const dump = join(scratch, "one-shot-isolated.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await expect(instance.generateText?.("capture this")).resolves.toBe("fake generated text");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    const after = (flag: string) => seen.argv[seen.argv.indexOf(flag) + 1];
    expect(seen.argv).toContain("--strict-mcp-config");
    expect(after("--tools")).toBe("");
    expect(after("--setting-sources")).toBe("");
    expect(after("--system-prompt")).toBe(ONE_SHOT_SYSTEM_PROMPT);
    expect(seen.cwd).not.toBe(process.cwd());
    expect(seen.cwd).toMatch(/claude-one-shot$/);
    expect(seen.env.ENABLE_CLAUDEAI_MCP_SERVERS).toBe("false");
    await expect(instance.reviewPermission?.("review this request")).resolves.toBe("fake generated text");
    expect(JSON.parse(readFileSync(dump, "utf8")).argv).toContain("--strict-mcp-config");
  });

  it("keeps the plain one-shot call when settings.json carries the login", async () => {
    const configDir = join(scratch, "claude-config-helper");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "settings.json"), JSON.stringify({ apiKeyHelper: "/usr/local/bin/key-helper" }));
    await create(undefined, { FAKE_CLAUDE_VERSION: "2.1.284", CLAUDE_CONFIG_DIR: configDir });
    await instance.snapshot();
    const dump = join(scratch, "one-shot-helper.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await expect(instance.generateText?.("capture this")).resolves.toBe("fake generated text");
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--setting-sources");
    expect(seen.argv).not.toContain("--tools");
  });

  it("keeps the plain one-shot call on a CLI too old for the isolation flags", async () => {
    expect(oneShotIsolationArgs(null)).toEqual([]);
    expect(oneShotIsolationArgs([2, 0, 99])).toEqual([]);
    expect(oneShotIsolationArgs([2, 1, 0])).toContain("--strict-mcp-config");
  });

  it("never falls back to personal authentication for API-key-only helper calls", async () => {
    process.env.ANTHROPIC_API_KEY = "unselected-personal-key";
    await create(undefined, {}, { requireApiKey: true });
    const dump = join(scratch, "missing-api-key-helper.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await expect(instance.generateText!("summarize")).rejects.toThrow("No Anthropic API key");
    await expect(instance.reviewPermission!("review request")).rejects.toThrow("No Anthropic API key");
    await expect(instance.adapter.sendTurn({ threadId: "t-api-no-key", text: "hello" })).rejects.toThrow("No Anthropic API key");
    expect(existsSync(dump)).toBe(false);
  });

  it("uses the selected API key for API-key-only helper calls", async () => {
    await create(undefined, { ANTHROPIC_API_KEY: "selected-api-key" }, { requireApiKey: true });
    const dump = join(scratch, "api-key-helper.json");
    process.env.FAKE_CLAUDE_DUMP = dump;

    await expect(instance.generateText!("summarize")).resolves.toBe("fake generated text");
    expect(JSON.parse(readFileSync(dump, "utf8")).env.ANTHROPIC_API_KEY).toBe("selected-api-key");
    await expect(instance.reviewPermission!("review request")).resolves.toBe("fake generated text");
    expect(JSON.parse(readFileSync(dump, "utf8")).env.ANTHROPIC_API_KEY).toBe("selected-api-key");
  });

  it("reports the actual one-shot model, total input, cached input and cost once", async () => {
    await create(undefined, { FAKE_CLAUDE_TEXT_RESULT: JSON.stringify({
      type: "result", result: "  captured memory  ", is_error: false,
      usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 3, output_tokens: 5 },
      total_cost_usd: 0.004,
      modelUsage: { "claude-haiku-4-5-20251001": { costUSD: 0.004 } },
    }) });
    const dump = join(scratch, "text-usage.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const onUsage = vi.fn();
    await expect(instance.generateText!("capture memory", { onUsage })).resolves.toBe("captured memory");
    expect(onUsage.mock.calls).toEqual([[{ model: "claude-haiku-4-5-20251001", input: 33, output: 5, cachedInput: 20, costUsd: 0.004 }]]);
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv[seen.argv.indexOf("--output-format") + 1]).toBe("json");
    expect(seen.argv[seen.argv.indexOf("--model") + 1]).toBe("claude-haiku-4-5");
    expect(recorder.events).toEqual([]);
  });

  it.each([
    [{}, undefined],
    [{ usage: { input_tokens: "12", output_tokens: -1 }, total_cost_usd: null }, undefined],
    [{ usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }, total_cost_usd: 0 }, 0],
  ])("keeps missing usage unknown and preserves explicit zeroes (%j)", async (metadata, expected) => {
    await create(undefined, { FAKE_CLAUDE_TEXT_RESULT: JSON.stringify({ type: "result", result: "done", ...metadata }) }, { managedModels: ["managed-helper"] });
    const onUsage = vi.fn();
    await expect(instance.generateText!("summarize", { onUsage })).resolves.toBe("done");
    expect(onUsage.mock.calls).toEqual([[{ model: "managed-helper", input: expected, output: expected, cachedInput: expected, costUsd: expected }]]);
  });

  it.each([false, true])("reports usage before rejecting an error result (nonzero exit: %s)", async nonzeroExit => {
    const failureFile = join(scratch, "failure.txt");
    writeFileSync(failureFile, "__FAIL__");
    await create(undefined, {
      ...(nonzeroExit ? { FAKE_CLAUDE_TEXT_FILE: failureFile } : {}),
      FAKE_CLAUDE_TEXT_RESULT: JSON.stringify({ type: "result", is_error: true, result: "synthetic billed failure", total_cost_usd: 0.01 }),
    });
    const onUsage = vi.fn();
    await expect(instance.generateText!("summarize", { onUsage })).rejects.toThrow("synthetic billed failure");
    expect(onUsage.mock.calls).toEqual([[{ model: "claude-haiku-4-5", input: undefined, output: undefined, cachedInput: undefined, costUsd: 0.01 }]]);
  });

  it.each(["not JSON", '{"type":"assistant"}'])("rejects malformed one-shot output without invented usage (%s)", async result => {
    await create(undefined, { FAKE_CLAUDE_TEXT_RESULT: result });
    const onUsage = vi.fn();
    await expect(instance.generateText!("summarize", { onUsage })).rejects.toThrow();
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("stops the one-shot text call when its caller aborts mid-flight", async () => {
    await create();
    process.env.FAKE_CLAUDE_TEXT_HANG = "1";
    const controller = new AbortController();
    const onUsage = vi.fn();
    setTimeout(() => controller.abort(), 100);
    await expect(instance.generateText?.("summarize safely", { signal: controller.signal, onUsage }))
      .rejects.toThrow(/aborted/);
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("stops permission review when its caller gives up", async () => {
    await create();
    const controller = new AbortController();
    controller.abort();
    await expect(instance.reviewPermission?.("review this request", controller.signal)).rejects.toThrow(/aborted/);
  });

  it("declares the effort levels the CLI accepts", async () => {
    await create();
    expect(instance.adapter.capabilities.effortLevels).toEqual([
      "low", "medium", "high", "xhigh", "max",
    ]);
  });
});

// Auth state must come from the CLI, not from probing its credential store:
// on macOS the OAuth tokens live in the login Keychain, so the old
// ~/.claude/.credentials.json check reported signed-in users as signed out
// and disabled the model picker with them (#108).
describe("ClaudeDriver resume recovery (fake CLI)", () => {
  let instance: ProviderInstance;
  let recorder: EventRecorder;
  let scratch: string;

  const REBUILD = "[rebuild]\n\nUser: my dog is Biscuit\n\nwhat now?";

  beforeEach(async () => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
    scratch = mkdtempSync(join(tmpdir(), "omb-claude-recover-"));
    process.env.FAKE_CLAUDE_MODE = "dead-session";
    instance = await ClaudeDriver.create({
      instanceId: "claude-test",
      displayName: "Claude Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: "auto" } as never,
    });
    recorder = recordEvents(instance.adapter);
  });

  afterEach(async () => {
    delete process.env.FAKE_CLAUDE_MODE;
    delete process.env.FAKE_CLAUDE_DUMP;
    delete process.env.FAKE_CLAUDE_PROMPTS;
    delete process.env.FAKE_CLAUDE_TEXT_HANG;
    recorder?.stop();
    await instance?.dispose();
    await removeTempDir(scratch);
  });
  /** How many launches were handed a prompt, read from FAKE_CLAUDE_PROMPTS. */
  const launches = (file: string) => readFileSync(file, "utf8").trim().split("\n").length;
  const promptText = (prompt: any) => {
    const content = prompt.message.content;
    return typeof content === "string" ? content : content.map((c: any) => c.text ?? "").join("");
  };

  it("starts a fresh session carrying the rebuild when --resume is refused", async () => {
    // Was a bricked thread: the CLI exits before `init`, the failure is
    // terminal so nothing retries, and the dead cursor is never cleared —
    // so every later turn resumed the same missing session and failed
    // identically, with no way back except switching engines.
    const dump = join(scratch, "recovered.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const dispatch = await instance.adapter.sendTurn({
      threadId: "t-dead",
      text: "what now?",
      resumeCursor: "a-session-claude-no-longer-has",
      recoveryText: REBUILD,
    });
    await recorder.until((e) => e.type === "turn.completed");

    expect(recorder.events.filter((e) => e.type === "turn.completed").at(-1)).toMatchObject({ ok: true, turnId: dispatch.turnId });
    // nothing failed that a retry fixed: the rebuilt session is what is told
    expect(recorder.events.some((e) => e.type === "turn.retrying")).toBe(false);
    // it started a NEW session, so the harness records a live cursor again
    const started = recorder.events.filter((e) => e.type === "session.started");
    expect(started.length).toBeGreaterThan(0);
    expect(started.at(-1)).not.toMatchObject({ sessionId: "a-session-claude-no-longer-has" });
    expect(started.at(-1)).toMatchObject({ rebuilt: true });
    // and the new session is not blank: the prompt is the rebuild, once
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--resume");
    const content = seen.prompt.message.content;
    const text = typeof content === "string" ? content : content.map((c: any) => c.text ?? "").join("");
    expect(text).toBe(REBUILD);
  });

  it("does not announce a replacement as rebuilt when there was nothing to replay", async () => {
    // recoveryPromptFor falls back to the turn text when the harness attached
    // no rebuild: that session holds the turn, not the conversation, and the
    // harness must not credit it with a replay it never saw.
    const dump = join(scratch, "no-replay.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({
      threadId: "t-no-replay",
      text: "what now?",
      resumeCursor: "a-session-claude-no-longer-has",
    });
    await recorder.until((e) => e.type === "turn.completed");
    const started = recorder.events.filter((e) => e.type === "session.started");
    expect(started.length).toBeGreaterThan(0);
    expect(started.at(-1)).not.toMatchObject({ rebuilt: true });
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--resume");
    const content = seen.prompt.message.content;
    expect(typeof content === "string" ? content : content.map((c: any) => c.text ?? "").join("")).toBe("what now?");
  });

  it("recovers only once, then fails visibly", async () => {
    // exit-early refuses every launch, resumed or fresh: the recovery is
    // spent on the first relaunch and the turn must then settle as failed
    // rather than relaunching forever
    process.env.FAKE_CLAUDE_MODE = "exit-early";
    const prompts = join(scratch, "prompts.jsonl");
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    await instance.adapter.sendTurn({ threadId: "t-always-dead", text: "what now?", resumeCursor: "gone", recoveryText: REBUILD });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.completed").at(-1)).toMatchObject({ ok: false });
    expect(launches(prompts)).toBe(2);
  });

  // Marketer (Oct 10, 2.1.295, idle since Sep 3): the CLI answered the resume
  // with an error result instead of exiting, the rebuild above never ran, and
  // the turn ended empty — no reply, no error, stop reason null.
  it("rebuilds a session the CLI answers with \"No conversation found\" instead of exiting", async () => {
    process.env.FAKE_CLAUDE_MODE = "stale-session";
    const dump = join(scratch, "stale.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    const prompts = join(scratch, "stale-prompts.jsonl");
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    const dispatch = await instance.adapter.sendTurn({
      threadId: "t-stale", text: "what now?", resumeCursor: "9de14760-idle-since-september", recoveryText: REBUILD,
    });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toEqual([expect.objectContaining({ ok: true, turnId: dispatch.turnId })]);
    expect(recorder.events.some((e) => e.type === "runtime.error")).toBe(false);
    expect(recorder.events.filter((e) => e.type === "session.started")).toEqual([
      expect.objectContaining({ rebuilt: true, sessionId: expect.not.stringMatching(/idle-since-september/) }),
    ]);
    // the person reads, once, what did not carry over
    const notices = () => recorder.events.filter((e) => e.type === "runtime.notice");
    expect(notices()).toEqual([expect.objectContaining({ message: rebuiltSessionNotice("Claude Code") })]);
    // one refused resume, one fresh session given the rebuild
    expect(launches(prompts)).toBe(2);
    const seen = JSON.parse(readFileSync(dump, "utf8"));
    expect(seen.argv).not.toContain("--resume");
    expect(promptText(seen.prompt)).toBe(REBUILD);
    // the next message goes to that same process: it re-announces its
    // session, which is no new rebuild to tell the person about
    const rebuilt = recorder.events.find((e) => e.type === "session.started") as { sessionId: string };
    await instance.adapter.sendTurn({ threadId: "t-stale", text: "and then?", resumeCursor: rebuilt.sessionId, recoveryText: REBUILD });
    await recorder.until((e) => e.type === "turn.completed" && e.turnId !== dispatch.turnId);
    expect(recorder.events.filter((e) => e.type === "session.started")).toEqual([
      expect.objectContaining({ rebuilt: true }),
      expect.not.objectContaining({ rebuilt: true }),
    ]);
    expect(notices()).toHaveLength(1);
  });

  it("says what failed when the fresh session ends in an error result too, after one rebuild", async () => {
    process.env.FAKE_CLAUDE_MODE = "error-result";
    const prompts = join(scratch, "error-prompts.jsonl");
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    await instance.adapter.sendTurn({ threadId: "t-error-result", text: "what now?", resumeCursor: "gone", recoveryText: REBUILD });
    await recorder.until((e) => e.type === "turn.completed");
    expect(launches(prompts)).toBe(2);
    expect(recorder.events.filter((e) => e.type === "runtime.error")).toEqual([
      expect.objectContaining({ message: expect.stringMatching(/^No conversation found with session ID: /) }),
    ]);
    expect(recorder.events.filter((e) => e.type === "turn.completed")).toEqual([
      expect.objectContaining({ ok: false, stopReason: "error_during_execution" }),
    ]);
  });

  it("never resends a turn the CLI accepted before dying", async () => {
    // the resumed session emitted `init` — it read the prompt, and may have
    // run tools on it — and then died with no output. That is the far side
    // of the acceptance boundary: replaying here is a duplicate side effect
    process.env.FAKE_CLAUDE_MODE = "resume-dies-after-init";
    const prompts = join(scratch, "accepted-prompts.jsonl");
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    await instance.adapter.sendTurn({ threadId: "t-accepted", text: "what now?", resumeCursor: "accepted-then-died", recoveryText: REBUILD });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.completed").at(-1)).toMatchObject({ ok: false });
    expect(launches(prompts)).toBe(1);
  });

  it("never treats a crash on a fresh launch as a refused resume", async () => {
    // no cursor was offered, so there is no resume to have been rejected:
    // this is an ordinary terminal failure, not a licence to send the turn
    // again
    process.env.FAKE_CLAUDE_MODE = "exit-early";
    const prompts = join(scratch, "fresh-crash-prompts.jsonl");
    process.env.FAKE_CLAUDE_PROMPTS = prompts;
    await instance.adapter.sendTurn({ threadId: "t-fresh-crash", text: "what now?", recoveryText: REBUILD });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.completed").at(-1)).toMatchObject({ ok: false });
    expect(launches(prompts)).toBe(1);
  });

  it("does not rebuild when there was no session to resume", async () => {
    process.env.FAKE_CLAUDE_MODE = "happy";
    const dump = join(scratch, "fresh.json");
    process.env.FAKE_CLAUDE_DUMP = dump;
    await instance.adapter.sendTurn({ threadId: "t-fresh", text: "what now?", recoveryText: REBUILD });
    await recorder.until((e) => e.type === "turn.completed");
    expect(recorder.events.filter((e) => e.type === "turn.completed").at(-1)).toMatchObject({ ok: true });
    expect(recorder.events.some((e) => e.type === "turn.retrying")).toBe(false);
    const content = JSON.parse(readFileSync(dump, "utf8")).prompt.message.content;
    const text = typeof content === "string" ? content : content.map((c: any) => c.text ?? "").join("");
    expect(text).toBe("what now?");
  });
});

describe("ClaudeDriver snapshot auth (fake CLI)", () => {
  let instance: ProviderInstance;

  const create = async () => {
    instance = await ClaudeDriver.create({
      instanceId: "claude-auth-test",
      displayName: "Claude Auth Test",
      environment: {},
      enabled: true,
      config: { cli: FAKE_CLI, permissionMode: "acceptEdits" },
    });
  };

  beforeEach(() => {
    ensureDirs();
    chmodSync(FAKE_CLI, 0o755);
  });

  afterEach(async () => {
    delete process.env.FAKE_CLAUDE_AUTH;
    delete process.env.ANTHROPIC_API_KEY;
    await instance?.dispose();
  });

  it("reports authenticated when `auth status` says loggedIn", async () => {
    process.env.FAKE_CLAUDE_AUTH = "in";
    await create();
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: true });
  });

  it("reports signed out when `auth status` says loggedIn:false", async () => {
    process.env.FAKE_CLAUDE_AUTH = "out";
    await create();
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: false });
  });

  it("fails closed instead of trusting stale credential storage", async () => {
    await create();

    process.env.FAKE_CLAUDE_AUTH = "unsupported";
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: false });

    process.env.FAKE_CLAUDE_AUTH = "malformed";
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: false });

    // The real turn removes inherited API keys, so the auth probe must do the
    // same or setup can report a login the turn cannot use.
    process.env.FAKE_CLAUDE_AUTH = "inherited-api-key";
    process.env.ANTHROPIC_API_KEY = "sk-should-not-leak";
    expect(await instance.snapshot()).toMatchObject({ state: "available", authenticated: false });
  });
});

describe("an error result that only repeats the turn's reply", () => {
  it("keeps the reply as the answer: never the error's cause", async () => {
    const { claudeResultError, resultRepeatsReply } = await import("./claude.ts");
    const reply = "Everyone answered.\n\n| Bot | Status |\n|---|---|\n| Alpha | ok |";
    const frame = { subtype: "success", is_error: true, result: reply };
    expect(resultRepeatsReply(frame, reply)).toBe(true);
    expect(claudeResultError(frame, reply)).not.toContain("Everyone answered");
    // a result with its own errors, or one that says something else, still fails the turn in its words
    expect(resultRepeatsReply({ ...frame, errors: ["No conversation found"] }, reply)).toBe(false);
    expect(claudeResultError({ subtype: "success", result: "API Error: 529 Overloaded" }, reply)).toMatch(/overloaded/i);
  });
});
