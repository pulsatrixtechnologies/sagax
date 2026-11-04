#!/usr/bin/env -S node --experimental-strip-types
// Engine warm-path bench: Claude / Grok ACP / Codex process reuse and
// send -> first content.delta, plus Perspicax MCP handshake cost.
// Fake CLIs with realistic delays (voice mode). House style matches
// scripts/bench-server-hot-paths.ts and scripts/voice-latency-bench.ts.
//
//   pnpm exec node --experimental-strip-types scripts/bench-engine-warm.ts
//   BENCH_ENGINES=claude,grok,codex,perspicax BENCH_WARM=20 BENCH_COLD=10
//
// Knobs: BENCH_COLD_MS (2600), BENCH_LOAD_MS (900), BENCH_FIRST_TOKEN_MS (600),
// BENCH_TOKEN_MS (25), BENCH_MCP_RTT_MS (20), BENCH_OUT (JSON path).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, platform, arch } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

import { launchVerificationServer, verificationServerEnvironment, runControlOmb } from "./control-omb.ts";
import { sessionIdlePolicy } from "../server/drivers/session-idle.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { startFakeHttpMcp, type FakeHttpMcp } from "../server/testing/fake-http-mcp-server.ts";
import { RemoteMcpClient } from "../server/mcp/mcp-http.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const knob = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 && process.env[name] !== "" && process.env[name] !== undefined ? value : fallback;
};

const WARM = Math.max(1, Math.floor(knob("BENCH_WARM", 20)));
const COLD = Math.max(1, Math.floor(knob("BENCH_COLD", 10)));
const COLD_MS = knob("BENCH_COLD_MS", 2600);
const LOAD_MS = knob("BENCH_LOAD_MS", 900);
const FIRST_TOKEN_MS = knob("BENCH_FIRST_TOKEN_MS", 600);
const TOKEN_MS = knob("BENCH_TOKEN_MS", 25);
const MCP_RTT_MS = knob("BENCH_MCP_RTT_MS", 20);
const ENGINES = (process.env.BENCH_ENGINES ?? "claude,grok,codex,perspicax")
  .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!.toFixed(1));
}

function stats(values: number[]): { n: number; p50: number; p95: number; mean: number } {
  const mean = values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 0;
  return { n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95), mean };
}

type TurnSample = {
  kind: "warm" | "cold";
  launched: boolean;
  sendToFirstEventMs: number | null;
  sendToFirstDeltaMs: number | null;
  turnTraceSend?: number;
};

type EngineReport = {
  engine: string;
  sessionIdleMs?: number;
  launches: number;
  warm: TurnSample[];
  cold: TurnSample[];
  warmSendToDelta: ReturnType<typeof stats>;
  coldSendToDelta: ReturnType<typeof stats>;
  warmSendToEvent: ReturnType<typeof stats>;
  coldSendToEvent: ReturnType<typeof stats>;
  notes?: string[];
  rpc?: string[];
};

const sleep = (ms: number) => delay(ms);

function parseTurnTrace(log: string): Array<{ thread: string; step: string; at: number }> {
  const out: Array<{ thread: string; step: string; at: number }> = [];
  for (const line of log.split("\n")) {
    const m = line.match(/\[turn-trace\]\s+(\S+)\s+(\S+)\s+(\d+)/);
    if (!m) continue;
    out.push({ thread: m[1]!, step: m[2]!, at: Number(m[3]) });
  }
  return out;
}

function countLaunches(path: string): number {
  if (!existsSync(path)) return 0;
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).length;
}

function readLaunchCountFile(path: string): number {
  if (!existsSync(path)) return 0;
  return Number.parseInt(readFileSync(path, "utf8").trim(), 10) || 0;
}

function acpMethods(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    try { return (JSON.parse(line) as { method: string }).method; } catch { return "?"; }
  });
}

type SseTap = {
  raw: string;
  close(): void;
  waitFor(predicate: (frame: Record<string, unknown>) => boolean, timeoutMs: number): Promise<Record<string, unknown>>;
};

async function openEvents(url: string): Promise<SseTap> {
  const controller = new AbortController();
  const response = await fetch(`${url}/api/events`, { headers: { origin: url }, signal: controller.signal });
  if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
  let raw = "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const waiters: Array<{ pred: (f: Record<string, unknown>) => boolean; resolve: (f: Record<string, unknown>) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }> = [];
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        raw += decoder.decode(value, { stream: true });
        for (const line of raw.split("\n")) {
          if (!line.startsWith("data:")) continue;
          try {
            const frame = JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
            for (let i = waiters.length - 1; i >= 0; i--) {
              const w = waiters[i]!;
              if (w.pred(frame)) {
                clearTimeout(w.timer);
                waiters.splice(i, 1);
                w.resolve(frame);
              }
            }
          } catch { /* partial */ }
        }
      }
    } catch { /* aborted */ }
  })();
  void pump;
  return {
    get raw() { return raw; },
    close() { controller.abort(); },
    waitFor(pred, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          const idx = waiters.findIndex((w) => w.timer === timer);
          if (idx >= 0) waiters.splice(idx, 1);
          reject(new Error(`sse timeout ${timeoutMs}ms`));
        }, timeoutMs);
        waiters.push({ pred, resolve, reject, timer });
      });
    },
  };
}

async function sendAndMeasure(opts: {
  url: string;
  botId: string;
  threadId: string;
  text: string;
  events: SseTap;
  log: () => string;
  launchesBefore: number;
  launchesAfter: () => number;
  kind: "warm" | "cold";
  timeoutMs?: number;
}): Promise<TurnSample> {
  const timeoutMs = opts.timeoutMs ?? Math.max(30_000, COLD_MS + LOAD_MS + FIRST_TOKEN_MS + 15_000);
  const sendAt = performance.now();
  const wallSend = Date.now();
  const sent = await fetch(`${opts.url}/api/bots/${opts.botId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: opts.url },
    body: JSON.stringify({ text: opts.text, threadId: opts.threadId }),
  });
  if (sent.status !== 202) throw new Error(`send ${sent.status}: ${await sent.text()}`);

  let firstEventMs: number | null = null;
  let firstDeltaMs: number | null = null;
  const threadPrefix = opts.threadId.slice(0, 8);

  const eventWait = opts.events.waitFor((frame) => {
    const event = frame.event as { type?: string; threadId?: string; streamKind?: string } | undefined;
    if (frame.kind !== "runtime" || !event || event.threadId !== opts.threadId) return false;
    if (firstEventMs === null && (event.type === "turn.started" || event.type === "session.started" || event.type === "content.delta")) {
      firstEventMs = performance.now() - sendAt;
    }
    if (event.type === "content.delta" && event.streamKind === "assistant_text") {
      firstDeltaMs = performance.now() - sendAt;
      return true;
    }
    return false;
  }, timeoutMs).catch(() => null);

  await runControlOmb(["wait", "--bot", opts.botId, "--timeout", String(Math.ceil(timeoutMs / 1000))], {
    env: { SAGAX_URL: opts.url },
  });
  await eventWait;

  const launchesAfter = opts.launchesAfter();
  const launched = launchesAfter > opts.launchesBefore;

  // Prefer turn-trace "send" wall clock when present.
  const traces = parseTurnTrace(opts.log()).filter((t) => t.thread === threadPrefix && t.step === "send" && t.at >= wallSend - 2_000);
  const turnTraceSend = traces.at(-1)?.at;

  return {
    kind: opts.kind,
    launched,
    sendToFirstEventMs: firstEventMs === null ? null : Number(firstEventMs.toFixed(1)),
    sendToFirstDeltaMs: firstDeltaMs === null ? null : Number(firstDeltaMs.toFixed(1)),
    turnTraceSend,
  };
}

function summarize(engine: string, warm: TurnSample[], cold: TurnSample[], launches: number, sessionIdleMs?: number, notes?: string[], rpc?: string[]): EngineReport {
  const num = (samples: TurnSample[], key: "sendToFirstDeltaMs" | "sendToFirstEventMs") =>
    samples.map((s) => s[key]).filter((v): v is number => typeof v === "number");
  return {
    engine,
    sessionIdleMs,
    launches,
    warm,
    cold,
    warmSendToDelta: stats(num(warm, "sendToFirstDeltaMs")),
    coldSendToDelta: stats(num(cold, "sendToFirstDeltaMs")),
    warmSendToEvent: stats(num(warm, "sendToFirstEventMs")),
    coldSendToEvent: stats(num(cold, "sendToFirstEventMs")),
    notes,
    rpc,
  };
}

function fixtureLog(logPath: string): string {
  try { return readFileSync(logPath, "utf8"); } catch { return ""; }
}

async function benchClaude(): Promise<EngineReport> {
  const dataHint = mkdtempSync(join(tmpdir(), "bench-claude-"));
  const launchLog = join(dataHint, "launches.jsonl");
  writeFileSync(launchLog, "");
  const fixture = await launchVerificationServer({
    ...process.env,
    SAGAX_TURN_TRACE: "1",
    FAKE_CLAUDE_MODE: "voice",
    FAKE_CLAUDE_COLD_MS: String(COLD_MS),
    FAKE_CLAUDE_FIRST_TOKEN_MS: String(FIRST_TOKEN_MS),
    FAKE_CLAUDE_TOKEN_MS: String(TOKEN_MS),
    FAKE_CLAUDE_LAUNCH_LOG: launchLog,
    FAKE_CLAUDE_VOICE_REPLY: "Warm path reply from the fake Claude CLI.",
  });
  const url = fixture.info.url;
  const env = { SAGAX_URL: url };
  const log = () => fixtureLog(fixture.info.logPath);
  let events: SseTap | null = null;
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "WarmClaude"], { env }) as { bot: { id: string; activeTaskId: string } };
    events = await openEvents(url);
    const warm: TurnSample[] = [];
    const threadId = bot.activeTaskId;
    for (let i = 0; i < WARM; i++) {
      const before = countLaunches(launchLog);
      warm.push(await sendAndMeasure({
        url, botId: bot.id, threadId, text: `warm turn ${i + 1}`, events, log,
        launchesBefore: before, launchesAfter: () => countLaunches(launchLog), kind: "warm",
      }));
    }
    const cold: TurnSample[] = [];
    for (let i = 0; i < COLD; i++) {
      const created = await runControlOmb(["new-bot", "--name", `ColdClaude${i}`], { env }) as { bot: { id: string; activeTaskId: string } };
      const before = countLaunches(launchLog);
      cold.push(await sendAndMeasure({
        url, botId: created.bot.id, threadId: created.bot.activeTaskId, text: `cold turn ${i + 1}`, events, log,
        launchesBefore: before, launchesAfter: () => countLaunches(launchLog), kind: "cold",
      }));
    }
    const idle = sessionIdlePolicy("CLAUDE");
    const reused = warm.filter((t) => !t.launched).length;
    return summarize("claude", warm, cold, countLaunches(launchLog), idle.idleMs, [
      `warm turns that reused a process: ${reused}/${warm.length}`,
      `SESSION_IDLE_MS=${idle.idleMs}`,
    ]);
  } finally {
    events?.close();
    await fixture.close();
  }
}

async function startGrokServer(paths: { launchCount: string; rpcLog: string; wrapper: string; dataDir: string }): Promise<{ url: string; child: ChildProcess; log: () => string; close: () => Promise<void> }> {
  const port = await freePortBlock([0, 1]);
  const fake = join(ROOT, "server", "testing", "fake-acp-cli.ts");
  writeFileSync(paths.wrapper, [
    "#!/usr/bin/env node",
    `process.env.FAKE_ACP_MODE = "voice";`,
    `process.env.FAKE_ACP_COLD_MS = ${JSON.stringify(String(COLD_MS))};`,
    `process.env.FAKE_ACP_LOAD_MS = ${JSON.stringify(String(LOAD_MS))};`,
    `process.env.FAKE_ACP_FIRST_TOKEN_MS = ${JSON.stringify(String(FIRST_TOKEN_MS))};`,
    `process.env.FAKE_ACP_TOKEN_MS = ${JSON.stringify(String(TOKEN_MS))};`,
    `process.env.FAKE_ACP_LAUNCH_COUNT_FILE = ${JSON.stringify(paths.launchCount)};`,
    `process.env.FAKE_ACP_RPC_APPEND_FILE = ${JSON.stringify(paths.rpcLog)};`,
    `process.env.FAKE_ACP_VOICE_REPLY = "Warm path reply from the fake Grok ACP CLI.";`,
    `await import(${JSON.stringify(pathToFileURL(fake).href)});`,
  ].join("\n"), { mode: 0o700 });
  writeFileSync(join(paths.dataDir, "config.json"), JSON.stringify({
    instances: { grok: { driver: "grokAgent", displayName: "Bench Grok", config: { cli: paths.wrapper, fullAuto: false } } },
  }));
  writeFileSync(paths.launchCount, "0");
  writeFileSync(paths.rpcLog, "");
  const childEnv = {
    ...verificationServerEnvironment({ ...process.env, SAGAX_TURN_TRACE: "1" }, paths.dataDir, port),
    SAGAX_TURN_TRACE: "1",
  };
  let log = "";
  const child = spawn(process.execPath, ["--experimental-strip-types", join(ROOT, "server", "index.ts")], {
    cwd: ROOT, env: childEnv, stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (c) => (log += c));
  child.stderr!.on("data", (c) => (log += c));
  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 40_000;
  for (;;) {
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* starting */ }
    if (Date.now() > deadline || child.exitCode !== null) throw new Error(`grok bench server failed:\n${log.slice(-4000)}`);
    await sleep(150);
  }
  return {
    url, child, log: () => log,
    close: async () => {
      child.kill("SIGTERM");
      await sleep(500);
      if (child.exitCode === null) child.kill("SIGKILL");
    },
  };
}

async function benchGrok(): Promise<EngineReport> {
  const dataDir = mkdtempSync(join(tmpdir(), "bench-grok-"));
  mkdirSync(join(dataDir, "tmp"), { recursive: true });
  const paths = {
    launchCount: join(dataDir, "launches.txt"),
    rpcLog: join(dataDir, "rpc.jsonl"),
    wrapper: join(dataDir, "grok-wrapper.mjs"),
    dataDir,
  };
  const server = await startGrokServer(paths);
  let events: SseTap | null = null;
  try {
    // Default bot is Claude-less: create a Grok bot via API.
    const created = await fetch(`${server.url}/api/bots`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.url },
      body: JSON.stringify({ name: "WarmGrok", modelSelection: { instanceId: "grok", model: "grok-4-fast-non-reasoning" } }),
    });
    const body = await created.json() as { bot?: { id: string; threadId?: string; activeTaskId?: string } };
    if (!body.bot) throw new Error(`create bot ${created.status}: ${JSON.stringify(body)}`);
    const bot = body.bot;
    const threadId = bot.threadId ?? bot.activeTaskId;
    if (!threadId) throw new Error("bot has no thread");
    events = await openEvents(server.url);
    const warm: TurnSample[] = [];
    for (let i = 0; i < WARM; i++) {
      const before = readLaunchCountFile(paths.launchCount);
      warm.push(await sendAndMeasure({
        url: server.url, botId: bot.id, threadId, text: `warm turn ${i + 1}`, events, log: server.log,
        launchesBefore: before, launchesAfter: () => readLaunchCountFile(paths.launchCount), kind: "warm",
        timeoutMs: Math.max(45_000, COLD_MS + LOAD_MS + FIRST_TOKEN_MS + 20_000),
      }));
    }
    const cold: TurnSample[] = [];
    for (let i = 0; i < COLD; i++) {
      const again = await fetch(`${server.url}/api/bots`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: server.url },
        body: JSON.stringify({ name: `ColdGrok${i}`, modelSelection: { instanceId: "grok", model: "grok-4-fast-non-reasoning" } }),
      });
      const coldBot = (await again.json() as { bot: { id: string; threadId?: string; activeTaskId?: string } }).bot;
      const coldThread = coldBot.threadId ?? coldBot.activeTaskId!;
      const before = readLaunchCountFile(paths.launchCount);
      cold.push(await sendAndMeasure({
        url: server.url, botId: coldBot.id, threadId: coldThread, text: `cold turn ${i + 1}`, events, log: server.log,
        launchesBefore: before, launchesAfter: () => readLaunchCountFile(paths.launchCount), kind: "cold",
        timeoutMs: Math.max(45_000, COLD_MS + LOAD_MS + FIRST_TOKEN_MS + 20_000),
      }));
    }
    const idle = sessionIdlePolicy("ACP");
    const methods = acpMethods(paths.rpcLog);
    const establish = methods.filter((m) => m === "session/new" || m === "session/load" || m === "session/resume");
    const prompts = methods.filter((m) => m === "session/prompt").length;
    const lists = methods.filter((m) => m === "_x.ai/mcp/list").length;
    return summarize("grok", warm, cold, readLaunchCountFile(paths.launchCount), idle.idleMs, [
      `warm reused launches=${warm.filter((t) => !t.launched).length}/${warm.length}`,
      `session establish RPCs (new/load/resume)=${establish.length}`,
      `session/prompt=${prompts} _x.ai/mcp/list=${lists}`,
      `SAGAX_ACP_SESSION_IDLE_MS default=${idle.idleMs}`,
    ], methods.slice(0, 80));
  } finally {
    events?.close();
    await server.close();
  }
}

async function benchCodex(): Promise<EngineReport> {
  const dataHint = mkdtempSync(join(tmpdir(), "bench-codex-"));
  const startupLog = join(dataHint, "codex-startup.jsonl");
  writeFileSync(startupLog, "");
  const delayMs = String(Math.min(COLD_MS, 800));
  const fixture = await launchVerificationServer(
    { ...process.env, SAGAX_TURN_TRACE: "1" },
    undefined, undefined, undefined, undefined, undefined, ["codex"], undefined, undefined,
    {
      prepareDataDir: (dataDir) => {
        const configPath = join(dataDir, "config.json");
        const cfg = JSON.parse(readFileSync(configPath, "utf8")) as {
          instances: Record<string, { driver: string; displayName?: string; config?: Record<string, unknown>; environment?: Record<string, string> }>;
        };
        if (cfg.instances.codex) {
          cfg.instances.codex.environment = {
            ...cfg.instances.codex.environment,
            FAKE_CODEX_STARTUP_LOG: startupLog,
            FAKE_CODEX_STARTUP_DELAY_MS: delayMs,
          };
          writeFileSync(configPath, JSON.stringify(cfg, null, 2));
        }
      },
    },
  );
  const url = fixture.info.url;
  const env = { SAGAX_URL: url };
  const log = () => fixtureLog(fixture.info.logPath);
  let events: SseTap | null = null;
  try {
    const bots = await (await fetch(`${url}/api/bots`, { headers: { origin: url } })).json() as {
      bots: Array<{ id: string; threadId?: string; activeTaskId?: string; mainThreadId?: string }>;
    };
    const bot = bots.bots[0];
    const botId = bot?.id;
    const threadId = bot?.threadId ?? bot?.activeTaskId ?? bot?.mainThreadId;
    if (!botId || !threadId) throw new Error(`no bot/thread: ${JSON.stringify(bot ?? null)}`);
    await runControlOmb(["set-model", "--bot", botId, "--instance", "codex", "--model", "gpt-fake-default"], { env });
    events = await openEvents(url);
    const warm: TurnSample[] = [];
    for (let i = 0; i < WARM; i++) {
      const before = countLaunches(startupLog);
      warm.push(await sendAndMeasure({
        url, botId, threadId, text: `warm turn ${i + 1}`, events, log,
        launchesBefore: before, launchesAfter: () => countLaunches(startupLog), kind: "warm",
      }));
    }
    const cold: TurnSample[] = [];
    for (let i = 0; i < COLD; i++) {
      const created = await runControlOmb(["new-bot", "--name", `ColdCodex${i}`], { env }) as {
        bot: { id: string; threadId?: string; activeTaskId?: string };
      };
      const coldThread = created.bot.threadId ?? created.bot.activeTaskId;
      if (!coldThread) throw new Error(`cold bot has no thread: ${JSON.stringify(created.bot)}`);
      await runControlOmb(["set-model", "--bot", created.bot.id, "--instance", "codex", "--model", "gpt-fake-default"], { env });
      const before = countLaunches(startupLog);
      cold.push(await sendAndMeasure({
        url, botId: created.bot.id, threadId: coldThread, text: `cold turn ${i + 1}`, events, log,
        launchesBefore: before, launchesAfter: () => countLaunches(startupLog), kind: "cold",
      }));
    }
    const inits = countLaunches(startupLog);
    const initEvents = existsSync(startupLog)
      ? readFileSync(startupLog, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { event: string; pid: number })
      : [];
    const pids = new Set(initEvents.map((e) => e.pid));
    return summarize("codex", warm, cold, pids.size, undefined, [
      `startup log lines=${inits} distinct pids=${pids.size}`,
      `initialize events=${initEvents.filter((e) => e.event === "initialize").length}`,
      `turn/start events=${initEvents.filter((e) => e.event === "turn/start").length}`,
      "today each Codex turn launches a new app-server (finish.ts)",
    ]);
  } finally {
    events?.close();
    await fixture.close();
  }
}

async function benchPerspicaxMcp(): Promise<EngineReport> {
  // Handshake cost against fake-http-mcp-server with simulated RTT.
  const fake: FakeHttpMcp = await startFakeHttpMcp({
    toolsDelayMs: MCP_RTT_MS,
    callDelayMs: MCP_RTT_MS,
  });
  const samples: number[] = [];
  const sequences: string[][] = [];
  try {
    for (let i = 0; i < WARM; i++) {
      const client = new RemoteMcpClient({ type: "http", url: fake.url, headers: {} });
      const t0 = performance.now();
      const signal = AbortSignal.timeout(10_000);
      await client.initialize("bench-engine-warm", signal);
      await client.request("tools/list", {}, signal);
      // Second tools/list on the same session (engine + Sagax identity path).
      await client.request("tools/list", {}, signal);
      samples.push(Number((performance.now() - t0).toFixed(1)));
      sequences.push(["initialize", "notifications/initialized", "tools/list", "tools/list"]);
      await client.close();
    }
    // Connection reuse micro-bench: many posts on one client (keep-alive Agent).
    const reuseClient = new RemoteMcpClient({ type: "http", url: fake.url, headers: {} });
    const reuseSignal = AbortSignal.timeout(15_000);
    await reuseClient.initialize("bench-reuse", reuseSignal);
    const rpcMs: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      await reuseClient.request("tools/list", {}, reuseSignal);
      rpcMs.push(Number((performance.now() - t).toFixed(1)));
    }
    await reuseClient.close();
    const warmSamples: TurnSample[] = samples.map((ms) => ({
      kind: "warm",
      launched: true,
      sendToFirstEventMs: ms,
      sendToFirstDeltaMs: ms,
    }));
    return summarize("perspicax-mcp", warmSamples, [], samples.length, 120_000, [
      `fake toolsDelayMs=${MCP_RTT_MS}`,
      `handshake+2x tools/list p50=${percentile(samples, 0.5)} p95=${percentile(samples, 0.95)}`,
      `same-session tools/list x20 p50=${percentile(rpcMs, 0.5)} p95=${percentile(rpcMs, 0.95)}`,
      `fake counters toolsLists=${fake.toolsLists} delayedToolsLists=${fake.delayedToolsLists}`,
      "keepAlive: RemoteMcpClient + PerspicaxMcp use undici Agent per origin",
      "Perspicax KEEP_ALIVE=120s PER_SUB_CAP=32 GLOBAL_CAP=512",
      `sequence=${sequences[0]?.join(" -> ")}`,
      "PerspicaxMcp tools/list cache: second list on same session is local (perspicax-identity.test.ts)",
    ]);
  } finally {
    await fake.close();
  }
}

async function main(): Promise<void> {
  console.log(JSON.stringify({
    benchmark: "engine-warm",
    node: process.version,
    platform: platform(),
    arch: arch(),
    warm: WARM,
    cold: COLD,
    coldMs: COLD_MS,
    loadMs: LOAD_MS,
    firstTokenMs: FIRST_TOKEN_MS,
    tokenMs: TOKEN_MS,
    mcpRttMs: MCP_RTT_MS,
    engines: ENGINES,
  }));

  const reports: EngineReport[] = [];
  for (const engine of ENGINES) {
    const started = performance.now();
    console.error(`[bench-engine-warm] starting ${engine}`);
    let report: EngineReport;
    if (engine === "claude") report = await benchClaude();
    else if (engine === "grok") report = await benchGrok();
    else if (engine === "codex") report = await benchCodex();
    else if (engine === "perspicax" || engine === "perspicax-mcp") report = await benchPerspicaxMcp();
    else {
      console.error(`[bench-engine-warm] skip unknown engine ${engine}`);
      continue;
    }
    console.error(`[bench-engine-warm] ${engine} done in ${((performance.now() - started) / 1000).toFixed(1)}s launches=${report.launches}`);
    reports.push(report);
    console.log(JSON.stringify(report, null, 2));
  }

  const out = process.env.BENCH_OUT;
  if (out) writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), reports }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
