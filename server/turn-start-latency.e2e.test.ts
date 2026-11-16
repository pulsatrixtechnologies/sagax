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
import { appendFileSync, closeSync, existsSync, openSync, readFileSync, writeFileSync } from "node:fs";
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

async function withLatencyFixture(options: { claudeSignedOut?: boolean; busy?: boolean; coldMs?: number; toolMs?: number; connectMcp?: boolean; idleExitMs?: number; serverEnv?: Record<string, string> }, check: (fixture: Fixture) => Promise<void>): Promise<void> {
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
        ...(options.toolMs ? { FAKE_ACP_MODE: "slow-tool", FAKE_ACP_TOOL_MS: String(options.toolMs) } : {}),
        // #4394: the engine starts and lists its tool servers as grok does
        ...(options.connectMcp ? { FAKE_ACP_MCP_CONNECT: "1" } : {}),
        // #4394: an engine that ends on its own between two turns
        ...(options.idleExitMs ? { FAKE_ACP_IDLE_EXIT_MS: String(options.idleExitMs) } : {}) },
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
      env: { ...verificationServerEnvironment({}, dataDir, Number(new URL(url).port)), SAGAX_ACP_REUSE_DIAG: "1", ...options.serverEnv, ...(process.env.SAGAX_TURN_TRACE === "1" ? { SAGAX_TURN_TRACE: "1" } : {}) },
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
      if (process.env.TURN_LATENCY_DUMP) appendFileSync(process.env.TURN_LATENCY_DUMP, serverLog());
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
    // #4394: the spawn says why no warm engine took it (the first one here), and only it
    expect(/ spawnWhy=(\S+)/.exec(lines[0]!)?.[1]).toBe("first");
    expect(lines.slice(1).join("\n")).not.toContain("spawnWhy=");
    // and why its prompt carried the whole opening block: a new session
    expect(/ fullWhy=(\S+)/.exec(lines[0]!)?.[1]).toBe("new:no-cursor");
    // #3598: the line counts the process starts of the turn's wait (the
    // engine's start at least, on the first turn)
    expect(Number(/ starts=(\d+):\d+ms /.exec(lines[0]!)?.[1] ?? 0)).toBeGreaterThanOrEqual(1);
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

// #4394: on a hosted server every turn of a conversation started its engine
// and waited about 3.4 s for a connector's tool list (toolsBy=connector:3348).
// A connector here is the person's own MCP server whose initialize and tool
// list take 1 s and 2.3 s to answer (a remote connector's round trips). The
// first engine start lists it at that cost; the next start of an engine for
// the same bot (another conversation; on the hosted server, the next turn)
// gets the list Sagax already knows at once, and the server is listed again
// beside the turn.
const FAKE_MCP = fileURLToPath(new URL("./testing/fake-mcp-server.ts", import.meta.url));
it("serves a connector's known tool list to the next engine start instead of waiting for it (#4394)", async () => {
  await withLatencyFixture({ connectMcp: true }, async (fixture) => {
    const imported = await fixture.api("POST", "/api/mcp/servers/import", { json: JSON.stringify({ mcpServers: {
      notes: { command: process.execPath, args: ["--experimental-strip-types", "--no-warnings", FAKE_MCP], env: { FAKE_MCP_INITIALIZE_MS: "1000", FAKE_MCP_LIST_MS: "2300" } },
    } }) });
    expect(imported.servers?.[0]?.name).toBe("notes");
    await fixture.api("PATCH", "/api/mcp/servers/notes", { enabled: true });
    const { bot } = await fixture.control("new-bot", "--name", "Connector bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const turn = async (threadId: string) => {
      await fixture.control("send", "--bot", bot.id, "--task", threadId, "--text", "What is 2 plus 2?");
      expect((await fixture.control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "40")).status).toBe("settled");
      return timingLines(fixture.serverLog(), threadId).at(-1)!;
    };
    const first = await turn(bot.activeTaskId);
    const created = await fixture.api("POST", `/api/bots/${bot.id}/tasks`, { title: "Second conversation" });
    const secondThread = created.task?.threadId;
    expect(typeof secondThread, JSON.stringify(created).slice(0, 300)).toBe("string");
    // the list read again beside the first turn has landed
    await new Promise((resolve) => setTimeout(resolve, 500));
    const second = await turn(secondThread);
    console.info(`[#4394] connector timing lines:\n${first}\n${second}`);
    const connectorMs = (line: string) => Number(/ toolsBy=(?:[^ ]*,)?connector:(\d+)/.exec(line)?.[1] ?? 0);
    const toolsMs = (line: string) => Number(/ setupBy=(?:[^ ]*,)?tools:(\d+)/.exec(line)?.[1] ?? 0);
    // both turns start an engine; the first one waits for the whole list
    expect(/path=(\w+)/.exec(first)?.[1]).toBe("spawn");
    expect(/path=(\w+)/.exec(second)?.[1]).toBe("spawn");
    expect(connectorMs(first)).toBeGreaterThanOrEqual(3_000);
    // the next start gets the known list without the server's 3.3 s
    expect(toolsMs(second)).toBeLessThan(1_500);
    expect(connectorMs(second)).toBeLessThan(1_500);
  });
}, 180_000);

// #4394: on a hosted server every turn of a conversation said path=spawn with
// spawnWhy=none, the reason for "no engine of this conversation here", though
// the conversation had one a turn before. An engine process that ended on its
// own between two turns was dropped from the pool without a word. Each spawn
// now names why the last engine of the conversation went (here: it exited
// with code 0 while idle), so a production line says it too.
it("names the end of an engine that exited between two turns in the next spawn's line (#4394)", async () => {
  await withLatencyFixture({ idleExitMs: 400 }, async (fixture) => {
    const { bot } = await fixture.control("new-bot", "--name", "Arithmetic bot");
    await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
    const threadId = bot.activeTaskId;
    for (const text of ["What is 2 plus 2?", "And 3 plus 3?"]) {
      await fixture.control("send", "--bot", bot.id, "--task", threadId, "--text", text);
      expect((await fixture.control("wait", "--bot", bot.id, "--task", threadId, "--timeout", "40")).status).toBe("settled");
      // the engine ends on its own before the next send
      await new Promise((resolve) => setTimeout(resolve, 1_200));
    }
    const lines = timingLines(fixture.serverLog(), threadId);
    console.info(`[#4394] idle-exit timing lines:\n${lines.join("\n")}`);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => /path=(\w+)/.exec(line)?.[1])).toEqual(["spawn", "spawn"]);
    expect(/ spawnWhy=(\S+)/.exec(lines[0]!)?.[1]).toBe("first");
    expect(/ spawnWhy=(\S+)/.exec(lines[1]!)?.[1]).toMatch(/^exited:0$/);
    // the new process loads the conversation's own session: only the
    // request and what changed ride, not a second opening block
    expect(/full=(\w+)/.exec(lines[1]!)?.[1]).toBe("no");
  });
}, 180_000);

// #4394: on a hosted server the three conversations that had a second turn
// all started a new engine for it, spawnWhy=closed:warm-budget, while the
// server kept 0 to 2 idle engines of a capacity of 16. The shared warm
// budget (server/resources/warm-resources.ts) charges an idle engine its
// process tree's memory against 1 GiB per person: a grok tree fills most of
// it, so the next conversation of the same person to finish (another bot,
// a teammate, an AI client's ask) closed the engine the person had just used.
// Here one engine fits the person's cap (a cap of 300 MiB against a 256 MiB
// engine, the same ratio), and a second conversation of the same person
// finishes between the two turns of the first.
it("keeps the engine a conversation just used for its follow-up when another conversation of the person finishes (#4394)", async () => {
  await withLatencyFixture({ serverEnv: { SAGAX_WARM_PERSON_MAX_BYTES: String(300 * 1024 * 1024), SAGAX_MAX_IDLE_ENGINE_SESSIONS: "16" } }, async (fixture) => {
    const bots = [];
    for (const name of ["Arithmetic bot", "Other bot"]) {
      const { bot } = await fixture.control("new-bot", "--name", name);
      await fixture.api("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "grokfixture", model: "grok-4.7" } });
      bots.push(bot);
    }
    const [first, other] = bots;
    const turn = async (bot: any, text: string) => {
      await fixture.control("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", text);
      expect((await fixture.control("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "40")).status).toBe("settled");
    };
    await turn(first, "What is 2 plus 2?");
    await turn(other, "What is 5 plus 5?");
    await turn(first, "And 3 plus 3?");
    const lines = timingLines(fixture.serverLog(), first.activeTaskId);
    console.info(`[#4394] warm-budget timing lines:\n${lines.join("\n")}\n${timingLines(fixture.serverLog(), other.activeTaskId).join("\n")}`);
    expect(lines).toHaveLength(2);
    expect(fixture.serverLog()).not.toContain("closeSession thread=" + first.activeTaskId.slice(0, 8) + " why=warm budget");
    expect(/path=(\w+)/.exec(lines[1]!)?.[1]).not.toBe("spawn");
    expect(lines[1]).not.toContain("spawnWhy=");
    expect(/full=(\w+)/.exec(lines[1]!)?.[1]).toBe("no");
    // the turn's start line says it is a message in the bot's one conversation
    expect(fixture.serverLog()).toContain(`thread=${first.activeTaskId.slice(0, 8)} conv=chat `);
  });
}, 180_000);
