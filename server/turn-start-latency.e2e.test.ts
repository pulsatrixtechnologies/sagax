// #4215: every turn of a conversation paid a cold engine start (path=spawn on
// each turn's timing line), its setup and an uncached opening prompt.
//
// Through the real server and the fake engine CLIs only (no provider, no
// production data), for a fixture bot, several turns in one conversation:
//   - the next turns reuse the engine the first one started (one process for
//     the conversation, path other than spawn), also when the bot's own
//     engine is signed out and a backup carries each turn;
//   - the second turn sends no second copy of the opening prompt;
//   - the timing line of each turn is printed, for the record.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb, verificationServerEnvironment } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

type Fixture = {
  api: (method: string, path: string, body?: unknown) => Promise<any>;
  control: (...args: string[]) => Promise<any>;
  serverLog: () => string;
  promptPids: () => Set<number>;
  /** releases the busy fixture's held turns */
  release: () => void;
};

async function withLatencyFixture(options: { claudeSignedOut?: boolean; busy?: boolean; coldMs?: number; toolMs?: number }, check: (fixture: Fixture) => Promise<void>): Promise<void> {
  const fixture = await launchVerificationServer();
  const { dataDir, url, logPath } = fixture.info;
  let server: ChildProcess | undefined;
  const rpcFile = join(dataDir, "acp-rpc.ndjson");
  const gateFile = join(dataDir, "busy-gate");
  const control = (...args: string[]) => runControlOmb([...args, "--url", url]) as Promise<any>;
  const api = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(url + path, {
      method, headers: { "content-type": "application/json", origin: url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30_000),
    });
    return response.json() as Promise<any>;
  };
  try {
    await waitForExit(fixture.child, { signal: "SIGTERM" });
    const configPath = join(dataDir, "config.json");
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    config.instances.grokfixture = {
      driver: "grokAgent", displayName: "Grok fixture",
      config: { cli: fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url)) },
      environment: { ...(options.toolMs ? {} : { FAKE_ACP_TEXT_REPLY: "4" }), FAKE_ACP_RPC_APPEND_FILE: rpcFile, ...(options.coldMs ? { FAKE_ACP_COLD_MS: String(options.coldMs) } : {}),
        // a turn that runs one tool for toolMs before its answer
        ...(options.toolMs ? { FAKE_ACP_MODE: "slow-tool", FAKE_ACP_TOOL_MS: String(options.toolMs) } : {}) },
    };
    // a teammate's engine that holds its turn open until the gate file exists
    if (options.busy) config.instances.grokbusy = {
      driver: "grokAgent", displayName: "Busy fixture",
      config: { cli: fileURLToPath(new URL("./testing/fake-acp-cli.ts", import.meta.url)) },
      environment: { FAKE_ACP_MODE: "echo-gated", FAKE_ACP_GATE_FILE: gateFile },
    };
    if (options.claudeSignedOut) {
      config.instances.claude.environment = { ...config.instances.claude.environment, FAKE_CLAUDE_MODE: "not-logged-in" };
      config.automaticRecovery = { enabled: true, backup: { instanceId: "grokfixture", model: "grok-4.7" } };
    }
    writeFileSync(configPath, JSON.stringify(config));
    const log = openSync(logPath, "a", 0o600);
    server = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_ACP_REUSE_DIAG: "1", ...(process.env.SAGAX_TURN_TRACE === "1" ? { SAGAX_TURN_TRACE: "1" } : {}) },
      stdio: ["ignore", log, log],
    });
    closeSync(log);
    await expect.poll(async () => {
      try { return (await fetch(url + "/api/health", { signal: AbortSignal.timeout(1_000) })).ok; } catch { return false; }
    }, { timeout: 20_000 }).toBe(true);
    const serverLog = () => readFileSync(logPath, "utf8");
    try {
      await check({
        api, control, serverLog, release: () => writeFileSync(gateFile, "go"),
        promptPids: () => new Set((existsSync(rpcFile) ? readFileSync(rpcFile, "utf8") : "").split("\n").filter(Boolean)
          .map((line) => JSON.parse(line) as { pid: number; method: string })
          .filter((row) => row.method === "session/prompt").map((row) => row.pid)),
      });
    } finally {
      writeFileSync(gateFile, "go");
      if (process.env.TURN_LATENCY_DUMP) writeFileSync(process.env.TURN_LATENCY_DUMP, serverLog());
    }
  } finally {
    await waitForExit(server, { signal: "SIGTERM" });
    await fixture.close();
  }
}

/** The [turn-latency] lines of one thread, in order. */
function timingLines(log: string, threadId: string): string[] {
  return log.split("\n").filter((line) => line.includes("[turn-latency]") && line.includes(`thread=${threadId.slice(0, 8)}`));
}

async function threeTurns({ control }: Fixture, botId: string, threadId: string): Promise<void> {
  for (const text of ["What is 2 plus 2?", "And 3 plus 3?", "And 4 plus 4?"]) {
    await control("send", "--bot", botId, "--task", threadId, "--text", text);
    expect((await control("wait", "--bot", botId, "--task", threadId, "--timeout", "40")).status).toBe("settled");
  }
}

it("sends the opening prompt once and reuses the conversation's engine on its next turns (#4215)", async () => {
  await withLatencyFixture({}, async (fixture) => {
    const { bot } = await fixture.control("new-bot", "--name", "Arithmetic bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const threadId = bot.activeTaskId;
    await threeTurns(fixture, bot.id, threadId);
    const lines = timingLines(fixture.serverLog(), threadId);
    console.info(`[#4215] timing lines:\n${lines.join("\n")}`);
    expect(lines).toHaveLength(3);
    const paths = lines.map((line) => /path=(\w+)/.exec(line)?.[1]);
    // the first turn starts the engine; the next ones reuse it
    expect(paths[0]).toBe("spawn");
    expect(paths.slice(1)).not.toContain("spawn");
    // the opening prompt rides the first turn only: the next ones add the
    // request, so the provider's cached prefix is the whole conversation
    expect(lines.slice(1).map((line) => /full=(\w+)/.exec(line)?.[1])).toEqual(["no", "no"]);
    // one engine process for the whole conversation
    expect(fixture.promptPids().size).toBe(1);
  });
}, 180_000);

it("reuses the backup's warm engine when the bot's own engine is signed out (#4215, coverage: passes before the fix too)", async () => {
  await withLatencyFixture({ claudeSignedOut: true }, async (fixture) => {
    const { bot } = await fixture.control("new-bot", "--name", "Carried bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, {
      modelSelection: { instanceId: "claude", model: "claude-sonnet-5" },
      fallback: [{ instanceId: "grokfixture", model: "grok-4.7" }],
    });
    const threadId = bot.activeTaskId;
    await threeTurns(fixture, bot.id, threadId);
    const lines = timingLines(fixture.serverLog(), threadId);
    console.info(`[#4215] signed-out timing lines:\n${lines.join("\n")}`);
    expect(lines).toHaveLength(3);
    const paths = lines.map((line) => /path=(\w+)/.exec(line)?.[1]);
    expect(paths.slice(1)).not.toContain("spawn");
    expect(fixture.promptPids().size).toBe(1);
  });
}, 180_000);

it("keeps a conversation's warm engine while the same person's other bots are busy (#4215)", async () => {
  await withLatencyFixture({ busy: true }, async (fixture) => {
    // Four teammates of the same person working at once: their engines are
    // active while the conversation's engine goes idle between its turns.
    for (const name of ["Busy one", "Busy two", "Busy three", "Busy four"]) {
      const { bot: busy } = await fixture.control("new-bot", "--name", name);
      await fixture.api("PATCH", `/api/bots/${busy.id}`, { modelSelection: { instanceId: "grokbusy", model: "grok-4.7" } });
      await fixture.control("send", "--bot", busy.id, "--task", busy.activeTaskId, "--text", "Work on this.");
    }
    await expect.poll(() => fixture.serverLog().split("\n").filter((line) => line.includes("why=none")).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(4);
    const { bot } = await fixture.control("new-bot", "--name", "Arithmetic bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const threadId = bot.activeTaskId;
    await threeTurns(fixture, bot.id, threadId);
    const lines = timingLines(fixture.serverLog(), threadId);
    console.info(`[#4215] busy-team timing lines:\n${lines.join("\n")}`);
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).map((line) => /path=(\w+)/.exec(line)?.[1])).not.toContain("spawn");
    expect(fixture.promptPids().size).toBe(1);
    fixture.release();
  });
}, 180_000);

it("never pays an engine start twice: a send after the composer's warm takes the warm engine, and its line names the wait (#4215)", async () => {
  // a real engine's start (2.7 to 13.6 s on the hosted server), shortened
  await withLatencyFixture({ busy: true, coldMs: 1_500 }, async (fixture) => {
    for (const name of ["Busy one", "Busy two", "Busy three", "Busy four"]) {
      const { bot: busy } = await fixture.control("new-bot", "--name", name);
      await fixture.api("PATCH", `/api/bots/${busy.id}`, { modelSelection: { instanceId: "grokbusy", model: "grok-4.7" } });
      await fixture.control("send", "--bot", busy.id, "--task", busy.activeTaskId, "--text", "Work on this.");
    }
    await expect.poll(() => fixture.serverLog().split("\n").filter((line) => line.includes("why=none")).length, { timeout: 40_000 }).toBeGreaterThanOrEqual(4);
    const { bot } = await fixture.control("new-bot", "--name", "Arithmetic bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const threadId = bot.activeTaskId;
    for (const text of ["What is 2 plus 2?", "And 3 plus 3?", "And 4 plus 4?"]) {
      // the person starts typing: the composer warms the conversation's
      // engine, and the send lands while it is still starting
      await fixture.api("POST", `/api/bots/${bot.id}/warm`, { threadId });
      await fixture.control("send", "--bot", bot.id, "--task", threadId, "--text", text);
      expect((await fixture.control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "40")).status).toBe("settled");
    }
    const lines = timingLines(fixture.serverLog(), threadId);
    console.info(`[#4215] composer-warm timing lines:\n${lines.join("\n")}`);
    expect(lines).toHaveLength(3);
    // the first send waited for the warm's start: the line counts it, by name
    const firstWait = Number(/queueBy=[^ ]*prewarm:(\d+)/.exec(lines[0]!)?.[1] ?? 0);
    expect(firstWait).toBeGreaterThan(500);
    expect(Number(/ queue=(\d+)ms/.exec(lines[0]!)?.[1])).toBeGreaterThanOrEqual(firstWait);
    // and took that engine: no turn starts one again after the wait
    expect(lines.map((line) => /path=(\w+)/.exec(line)?.[1])).not.toContain("spawn");
    expect(fixture.promptPids().size).toBe(1);
    fixture.release();
  });
}, 180_000);

/** queue + setup of a timing line: what the server adds before the engine's
 * own time to its first text. */
function serverShareMs(line: string): number {
  return Number(/ queue=(\d+)ms/.exec(line)?.[1] ?? 0) + Number(/ setup=(\d+)ms/.exec(line)?.[1] ?? 0);
}

// #4215 targets, measured on the verification server with the fake engine (a
// real engine's start shortened to 1.5 s): a no-tool turn and a turn with
// tools on a warm conversation each reach the engine in well under 5 s of the
// server's own time, on the warm engine, with no second copy of the opening
// block. The lines are printed for the record. #3598: and no turn starts more
// processes in one synchronous stretch than the server allows itself.
it("a warm conversation's no-tool and tool turns reach the engine without a start or a second opening block (#4215)", async () => {
  for (const toolMs of [0, 400]) {
    await withLatencyFixture({ coldMs: 1_500, ...(toolMs ? { toolMs } : {}) }, async (fixture) => {
      const { bot } = await fixture.control("new-bot", "--name", toolMs ? "Tool bot" : "Arithmetic bot");
      await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
      const threadId = bot.activeTaskId;
      await threeTurns(fixture, bot.id, threadId);
      const lines = timingLines(fixture.serverLog(), threadId);
      console.info(`[#4215] warm ${toolMs ? "tool" : "no-tool"} timing lines:\n${lines.join("\n")}`);
      expect(lines).toHaveLength(3);
      for (const line of lines.slice(1)) {
        expect(/path=(\w+)/.exec(line)?.[1]).not.toBe("spawn");
        expect(/full=(\w+)/.exec(line)?.[1]).toBe("no");
        expect(serverShareMs(line)).toBeLessThan(5_000);
      }
      if (toolMs) for (const line of lines) expect(Number(/tools=(\d+)/.exec(line)?.[1])).toBeGreaterThanOrEqual(1);
      // #3598: no turn's preparation starts more processes in one synchronous
      // stretch than the agreed number (STRETCH_STARTS_LIMIT, spawn-helper.ts):
      // the server logs such a stretch, and none comes after the first send
      const log = fixture.serverLog();
      expect(log.slice(log.indexOf("[omb-turn]")).split("\n").filter((line) => line.includes("[spawn-stretch]"))).toEqual([]);
      expect(fixture.promptPids().size).toBe(1);
    });
  }
}, 240_000);
