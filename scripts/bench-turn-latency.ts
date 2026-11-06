#!/usr/bin/env -S node --experimental-strip-types
// Chat-latency harness for the real Sagax turn path (perf/bench-harness).
// Stages from the client's send through accept, server [turn-trace] steps,
// dispatched, first_token, and settled. Fake engines only (claude / grok /
// codex / http). No credentials, no network beyond loopback.
//
//   pnpm bench:turn-latency [--engine claude|grok|codex|http] [--mode warm|cold|both]
//     [--turns N] [--quick] [--history N] [--out file.json] [--baseline file.json]
//     [--trace]
//
// Stages (ms from t0 = right before POST /api/bots/:id/messages):
//   accept       POST returned (user message stored)
//   <trace>      every [turn-trace] step for this thread (auto: new steps appear)
//   dispatched   adapter accepted the turn (process reused or spawned)
//   first_token  first content.delta on the SSE stream (client TTFT)
//   settled      settled assistant message + thread idle
//   sse_frames / sse_bytes / deltas
//   engine_floor / overhead_ttft  (known fake delays vs measured TTFT)
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { parseArgs } from "node:util";

import { launchVerificationServer, runControlOmb, type VerificationServer } from "./control-omb.ts";
import { openSse, type SseRecorder } from "../server/testing/sse.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const FAKE_ACP_CLI = join(ROOT, "server", "testing", "fake-acp-cli.ts");

const COLD_MS = 2600;
const FIRST_TOKEN_MS = 600;
const TOKEN_MS = 25;
const LOAD_MS = 900;
const SETTLE_TIMEOUT_MS = 60_000;
const STALL_MS = 20_000;

/** ~120-word Markdown reply with a table and a code fence (voice-bench style). */
const VOICE_REPLY = [
  "Here is a concise plan for the next verification pass on the fixture bot.",
  "",
  "Start with the smoke checks, then the context build, then the engine warm path.",
  "Keep each stage timed so a regression shows up in the harness table.",
  "",
  "| Stage | Owner | Budget |",
  "|---|---|---|",
  "| Smoke | harness | 2 min |",
  "| Context | server | 800 ms |",
  "| Dispatch | engine | 600 ms |",
  "",
  "```ts",
  "export function mark(stage: string, ms: number) {",
  "  return { stage, ms };",
  "}",
  "```",
  "",
  "When the reply settles, confirm the thread is idle before the next send.",
  "Do not print secrets, credentials, or live customer names in any log line.",
  "This paragraph pads the answer toward one hundred and twenty words so the",
  "token cadence matches a realistic short assistant reply under the fake CLI.",
].join("\n");

const SOUL = [
  "# Bench bot",
  "",
  "You are a synthetic fixture bot for chat-latency measurement.",
  "Answer briefly, stay on the verification topic, and never invent credentials.",
  "Prefer structured Markdown when a table or a short code sample helps.",
  "",
  "## Standing habits",
  "- Keep replies under two hundred words unless asked for more detail.",
  "- Cite only fixture paths and synthetic ticket ids.",
  "- Refuse anything that would leave the member's own sandbox.",
  "",
  "## Tone",
  "Plain, direct, Quebec French when the person writes in French, English otherwise.",
  "Technical terms stay in English.",
  "",
  "Pad: " + "latency-fixture-soul-line. ".repeat(55),
].join("\n");

type Engine = "claude" | "grok" | "codex" | "http";
type Mode = "warm" | "cold";

type StageStats = { p50: number; p95: number; min: number; max: number; n: number };
type TurnSample = {
  index: number;
  warmup: boolean;
  threadId: string;
  coldSpawn: boolean;
  reused: boolean;
  stages: Record<string, number>;
  sse_frames: number;
  sse_bytes: number;
  deltas: number;
  engine_floor: number;
  overhead_ttft: number;
};

type ModeResult = {
  mode: Mode;
  turnsMeasured: number;
  first_turn: TurnSample | null;
  stages: Record<string, StageStats>;
  counts: { coldSpawns: number; reused: number; measured: number };
  turns: TurnSample[];
};

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return Number(sorted[rank]!.toFixed(1));
}

function statsOf(values: number[]): StageStats {
  if (!values.length) return { p50: 0, p95: 0, min: 0, max: 0, n: 0 };
  return {
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    min: Number(Math.min(...values).toFixed(1)),
    max: Number(Math.max(...values).toFixed(1)),
    n: values.length,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseCli(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      engine: { type: "string", default: "claude" },
      mode: { type: "string", default: "both" },
      turns: { type: "string" },
      history: { type: "string", default: "40" },
      out: { type: "string" },
      baseline: { type: "string" },
      quick: { type: "boolean", default: false },
      trace: { type: "boolean", default: false },
      org: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const quick = Boolean(values.quick);
  // --quick only fills defaults; an explicit --engine / --mode wins.
  const engineGiven = argv.some((arg) => arg === "--engine" || arg.startsWith("--engine="));
  const modeGiven = argv.some((arg) => arg === "--mode" || arg.startsWith("--mode="));
  const engineRaw = String(values.engine ?? (quick ? "all-quick" : "claude"));
  const modeRaw = String(values.mode ?? (quick ? "warm" : "both"));
  if (values.org) {
    throw new Error("--org is not wired in this harness yet (see RESULT.md); use --engine grok without --org");
  }
  const engines: Engine[] = !engineGiven && quick
    ? ["http", "claude"]
    : engineRaw === "all" || engineRaw === "all-quick"
      ? (engineRaw === "all-quick" ? ["http", "claude"] : ["claude", "grok", "codex", "http"])
      : [engineRaw as Engine];
  for (const engine of engines) {
    if (engine !== "claude" && engine !== "grok" && engine !== "codex" && engine !== "http") {
      throw new Error(`--engine must be claude|grok|codex|http (got ${engineRaw})`);
    }
  }
  const modes: Mode[] = !modeGiven && quick
    ? ["warm"]
    : modeRaw === "both"
      ? ["warm", "cold"]
      : modeRaw === "warm" || modeRaw === "cold"
        ? [modeRaw]
        : (() => { throw new Error(`--mode must be warm|cold|both (got ${modeRaw})`); })();
  const turns = Number(values.turns ?? (quick ? "8" : "20"));
  const history = Number(values.history ?? "40");
  if (!Number.isFinite(turns) || turns < 1) throw new Error("--turns must be a positive number");
  if (!Number.isFinite(history) || history < 0 || history % 2 !== 0) {
    throw new Error("--history must be an even non-negative number (user+bot pairs)");
  }
  return {
    engines,
    modes,
    turns,
    history,
    out: values.out ? String(values.out) : undefined,
    baseline: values.baseline ? String(values.baseline) : undefined,
    quick,
    keepTrace: Boolean(values.trace),
  };
}

type Api = {
  url: string;
  json: (method: string, path: string, body?: unknown) => Promise<any>;
  control: (args: string[]) => Promise<any>;
};

function makeApi(url: string): Api {
  return {
    url,
    async json(method, path, body) {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { "content-type": "application/json", origin: url },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      let parsed: any = {};
      try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = { raw: text }; }
      if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}: ${text.slice(0, 400)}`);
      return parsed;
    },
    control(args) {
      return runControlOmb([...args, "--url", url]) as Promise<any>;
    },
  };
}

/** Seed N prior messages (even) into a never-loaded thread via SQLite (WAL). */
function seedHistory(dataDir: string, threadId: string, history: number): void {
  if (history <= 0) return;
  const dbPath = join(dataDir, "messages.db");
  const deadline = Date.now() + 10_000;
  while (!existsSync(dbPath) && Date.now() < deadline) {
    // server still opening the DB on first write
  }
  if (!existsSync(dbPath)) throw new Error(`messages.db missing under ${dataDir}`);
  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const upsert = db.prepare(
      "INSERT INTO messages (thread_id, id, at, role, kind, text, json, sealed, key_id) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL) " +
      "ON CONFLICT(thread_id, id) DO UPDATE SET at = excluded.at, role = excluded.role, kind = excluded.kind, " +
      "text = excluded.text, json = excluded.json, sealed = NULL, key_id = NULL",
    );
    const now = Date.now() - history * 60_000;
    let lastId = "";
    for (let i = 0; i < history; i++) {
      const role = i % 2 === 0 ? "user" : "bot";
      const id = `bench-hist-${threadId.slice(0, 8)}-${i}`;
      const at = now + i * 60_000;
      const text = role === "user"
        ? `Fixture history question ${i / 2 + 1}: what is the status of synthetic ticket #${1000 + i}?`
        : `Fixture history answer ${Math.floor(i / 2) + 1}: ticket #${1000 + i} is clear on the bench ledger.`;
      const message = { id, at, role, kind: "text", text };
      upsert.run(threadId, id, at, role, "text", text, JSON.stringify(message));
      lastId = id;
    }
    db.prepare(
      "INSERT INTO thread_state (thread_id, active_leaf_id) VALUES (?, ?) " +
      "ON CONFLICT(thread_id) DO UPDATE SET active_leaf_id = excluded.active_leaf_id",
    ).run(threadId, lastId);
  } finally {
    db.close();
  }
}

async function installBotFixture(api: Api, botId: string): Promise<void> {
  await api.json("PATCH", `/api/bots/${botId}`, { soul: SOUL });
  await api.json("PUT", `/api/bots/${botId}/memory/file`, {
    path: "MEMORY.md",
    text: "# Memory\n\n- Prefers short replies.\n- Tracks synthetic tickets only.\n- Never stores a secret.\n",
  });
  for (const [name, body] of [
    ["tone", "# Tone\n\nDirect and brief.\n"],
    ["clients", "# Clients\n\n- Osprey\n- Wren\n"],
    ["runbook", "# Runbook\n\n1. Measure\n2. Compare\n3. Report\n"],
  ] as const) {
    await api.json("PUT", `/api/bots/${botId}/memory/file`, { path: `memory/${name}.md`, text: body });
  }
  await api.json("PUT", `/api/bots/${botId}/memory/file`, {
    path: "RULES.md",
    text: "# Rules\n\n- Never quote a price.\n- Stay inside the member sandbox.\n- No live org names.\n",
  });
  for (let i = 1; i <= 5; i++) {
    await api.json("PUT", `/api/bots/${botId}/memory/file`, {
      path: `docs/note-${i}.md`,
      text: `# Doc ${i}\n\nSynthetic reference for the latency fixture.\n`,
    });
  }
  for (const skill of ["review-diff", "triage-ticket", "summarize-thread", "check-backup"]) {
    await api.json("POST", `/api/bots/${botId}/skill-template`, {
      name: skill,
      description: `${skill} for the latency fixture`,
      source: "template",
      enabled: true,
      text: `---\nname: ${skill}\ndescription: ${skill} for the latency fixture\n---\n\n# ${skill}\n\nFollow the fixture steps. Never print a secret.\n`,
    });
  }
}

async function newBenchThread(api: Api, botId: string, title: string): Promise<string> {
  const created = await api.json("POST", `/api/bots/${botId}/tasks`, { title });
  const threadId = created.task?.threadId ?? created.threadId;
  if (typeof threadId !== "string" || !threadId) throw new Error("new task did not return a threadId");
  return threadId;
}

/** Simulate composer focus / typing (#1975 HTTP, #2055 Grok ACP): POST /warm
 * and wait until the ready step so the measured send is not the cold start. */
async function prewarmBenchThread(
  api: Api,
  botId: string,
  threadId: string,
  opts: { logPath: string; logOffset: { value: number }; readyStep: string },
): Promise<void> {
  const warm = await api.json("POST", `/api/bots/${botId}/warm`, { threadId });
  if (warm.warm === "skipped" || warm.warm === "limited") return;
  const prefix = threadId.slice(0, 8);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const logText = existsSync(opts.logPath) ? readFileSync(opts.logPath, "utf8") : "";
    const fresh = logText.slice(opts.logOffset.value);
    if (parseTraceLines(fresh).some((line) => line.thread8 === prefix && line.step === opts.readyStep)) {
      opts.logOffset.value = logText.length;
      return;
    }
    await sleep(50);
  }
  // Best effort: measure anyway if the warm timed out.
}

type TraceLine = { thread8: string; step: string; epochMs: number; sinceStart: number };

function parseTraceLines(logText: string): TraceLine[] {
  const out: TraceLine[] = [];
  for (const line of logText.split("\n")) {
    const match = line.match(/\[turn-trace\]\s+(\w+)\s+(\S+)\s+(\d+)\s+\+(\d+)/);
    if (!match) continue;
    out.push({
      thread8: match[1]!,
      step: match[2]!,
      epochMs: Number(match[3]),
      sinceStart: Number(match[4]),
    });
  }
  return out;
}

function readLaunchCount(file: string | undefined): number {
  if (!file || !existsSync(file)) return 0;
  const raw = readFileSync(file, "utf8").trim();
  if (!raw) return 0;
  // Claude/Codex: one JSON object per launch. ACP: a single integer counter.
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw.split("\n").filter(Boolean).length;
}

function readAcpRpc(file: string | undefined): Array<{ method: string }> {
  if (!file || !existsSync(file)) return [];
  return readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((line) => {
    try { return JSON.parse(line) as { method: string }; } catch { return { method: "?" }; }
  });
}

async function startHttpFixture(): Promise<{ server: Server; url: string }> {
  const tokens = Array.from({ length: 120 }, (_, i) => (i === 0 ? "Word" : ` t${i}`));
  const server = createServer(async (req, res) => {
    const t0 = Date.now();
    const path = req.url ?? "";
    if (process.env.SAGAX_TURN_TRACE === "1") {
      console.error(`[http-fixture] hit ${path} ${t0}`);
    }
    if (req.url === "/v1/models") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
      return;
    }
    if (!req.url?.startsWith("/v1/chat/completions")) {
      res.statusCode = 404;
      res.end("missing");
      if (process.env.SAGAX_TURN_TRACE === "1") {
        console.error(`[http-fixture] 404 ${path} +${Date.now() - t0}`);
      }
      return;
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    void body;
    if (process.env.SAGAX_TURN_TRACE === "1") {
      console.error(`[http-fixture] body-read ${path} +${Date.now() - t0}`);
    }
    res.writeHead(200, { "content-type": "text/event-stream" });
    await sleep(FIRST_TOKEN_MS);
    if (process.env.SAGAX_TURN_TRACE === "1") {
      console.error(`[http-fixture] first-token-write ${path} +${Date.now() - t0}`);
    }
    for (const token of tokens) {
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: token }, finish_reason: null }] })}\n\n`);
      await sleep(TOKEN_MS);
    }
    res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
    res.write("data: [DONE]\n\n");
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("http fixture has no port");
  return { server, url: `http://127.0.0.1:${address.port}/v1` };
}

async function waitIdle(api: Api, botId: string, threadId: string, timeoutMs: number): Promise<void> {
  const result = await api.control(["wait", "--bot", botId, "--task", threadId, "--timeout", String(Math.ceil(timeoutMs / 1000))]);
  if (result?.status !== "settled") throw new Error(`thread ${threadId.slice(0, 8)} never settled (${JSON.stringify(result)})`);
}

function markdownTable(title: string, stages: Record<string, StageStats>): string {
  const rows = Object.entries(stages);
  const lines = [
    `### ${title}`,
    "",
    "| Stage | p50 (ms) | p95 (ms) | min | max | n |",
    "|---|---:|---:|---:|---:|---:|",
    ...rows.map(([name, s]) => `| ${name} | ${s.p50} | ${s.p95} | ${s.min} | ${s.max} | ${s.n} |`),
    "",
  ];
  return lines.join("\n");
}

function aggregate(samples: TurnSample[]): Record<string, StageStats> {
  const keys = new Set<string>();
  for (const sample of samples) {
    for (const key of Object.keys(sample.stages)) keys.add(key);
    keys.add("sse_frames");
    keys.add("sse_bytes");
    keys.add("deltas");
    keys.add("engine_floor");
    keys.add("overhead_ttft");
  }
  const out: Record<string, StageStats> = {};
  for (const key of [...keys].sort()) {
    const values = samples.map((sample) => {
      if (key === "sse_frames") return sample.sse_frames;
      if (key === "sse_bytes") return sample.sse_bytes;
      if (key === "deltas") return sample.deltas;
      if (key === "engine_floor") return sample.engine_floor;
      if (key === "overhead_ttft") return sample.overhead_ttft;
      return sample.stages[key] ?? NaN;
    }).filter((value) => Number.isFinite(value));
    out[key] = statsOf(values);
  }
  return out;
}

async function measureTurn(opts: {
  api: Api;
  botId: string;
  threadId: string;
  sse: SseRecorder;
  logPath: string;
  logOffset: { value: number };
  launchFile?: string;
  launchesBefore: number;
  engine: Engine;
  index: number;
  warmup: boolean;
  text: string;
}): Promise<TurnSample> {
  const { api, botId, threadId, sse, logPath, logOffset, launchFile, launchesBefore, engine, index, warmup, text } = opts;
  const prefix = threadId.slice(0, 8);
  const framesBefore = sse.frames.length;
  let cursor = framesBefore;
  let lastFrameAt = Date.now();
  let sawDelta = false;
  let firstTokenAt: number | undefined;
  let settledAt: number | undefined;
  let deltas = 0;
  let sseBytes = 0;
  let stalled = false;

  const stallWatch = setInterval(() => {
    if (settledAt !== undefined) return;
    if (Date.now() - lastFrameAt > STALL_MS) stalled = true;
  }, 500);
  stallWatch.unref?.();

  const ingest = () => {
    while (cursor < sse.frames.length) {
      const frame = sse.frames[cursor++] as any;
      lastFrameAt = Date.now();
      try { sseBytes += Buffer.byteLength(JSON.stringify(frame)); } catch { /* ignore */ }
      const event = frame?.event as { type?: string; threadId?: string; streamKind?: string } | undefined;
      if (frame?.kind === "runtime" && event?.type === "content.delta" && event.threadId === threadId && event.streamKind === "assistant_text") {
        deltas += 1;
        if (!sawDelta) {
          sawDelta = true;
          firstTokenAt = Date.now();
        }
      }
      const message = frame?.message as { role?: string; kind?: string; text?: string } | undefined;
      if (frame?.kind === "message" && frame.threadId === threadId && message?.role === "bot" && message?.kind === "text" && typeof message.text === "string") {
        settledAt = Date.now();
      }
    }
  };

  const t0 = Date.now();
  lastFrameAt = t0;
  const post = await fetch(`${api.url}/api/bots/${botId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: api.url },
    body: JSON.stringify({ text, threadId }),
  });
  const acceptAt = Date.now();
  if (post.status !== 202 && post.status !== 200) {
    clearInterval(stallWatch);
    throw new Error(`send failed: ${post.status} ${await post.text()}`);
  }

  const deadline = t0 + SETTLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (stalled) {
      clearInterval(stallWatch);
      throw new Error(`stalled stream: no SSE frame for ${STALL_MS}ms on thread ${prefix}`);
    }
    ingest();
    if (sawDelta && settledAt !== undefined) break;
    await sleep(20);
  }
  clearInterval(stallWatch);
  ingest();

  await waitIdle(api, botId, threadId, Math.max(1_000, deadline - Date.now()));
  ingest();
  if (settledAt === undefined) settledAt = Date.now();
  if (!sawDelta || firstTokenAt === undefined) {
    throw new Error(`lost reply: no content.delta within ${SETTLE_TIMEOUT_MS}ms on thread ${prefix}`);
  }

  // Drain a moment so late trace lines flush to the log.
  await sleep(80);
  const logText = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  const fresh = logText.slice(logOffset.value);
  logOffset.value = logText.length;
  const stages: Record<string, number> = {
    accept: acceptAt - t0,
    first_token: firstTokenAt - t0,
    settled: settledAt - t0,
  };
  for (const line of parseTraceLines(fresh)) {
    if (line.thread8 !== prefix) continue;
    stages[line.step] = line.epochMs - t0;
  }

  const launchesAfter = readLaunchCount(launchFile);
  // http never spawns a CLI; claude/grok cold = launch counter moved.
  const coldSpawn = engine === "http" ? false : launchesAfter > launchesBefore;
  const reused = !coldSpawn && index > 0;

  const engine_floor = (coldSpawn ? COLD_MS : 0) + FIRST_TOKEN_MS;
  const overhead_ttft = stages.first_token - engine_floor;

  return {
    index,
    warmup,
    threadId,
    coldSpawn,
    reused,
    stages,
    sse_frames: Math.max(0, sse.frames.length - framesBefore),
    sse_bytes: sseBytes,
    deltas,
    engine_floor,
    overhead_ttft: Number(overhead_ttft.toFixed(1)),
  };
}

async function runEngineMode(
  engine: Engine,
  mode: Mode,
  turns: number,
  history: number,
  keepTrace: boolean,
): Promise<{ result: ModeResult; logPath: string; acpRpc?: string[] }> {
  const scratch = join(tmpdir(), `sagax-turn-latency-${process.pid}-${Date.now()}`);
  mkdirSync(scratch, { recursive: true });
  const launchFile = join(scratch, engine === "grok" ? "acp-launches" : "claude-launches.jsonl");
  const acpRpcFile = join(scratch, "acp-rpc.jsonl");
  if (engine === "grok") writeFileSync(launchFile, "0");

  let httpFixture: { server: Server; url: string } | undefined;
  const parentEnv: NodeJS.ProcessEnv = {
    ...process.env,
    SAGAX_TURN_TRACE: "1",
    SAGAX_CONTENT_ENCRYPTION: "off",
    SAGAX_LIMIT_FAILOVER: "0",
  };

  if (engine === "claude") {
    Object.assign(parentEnv, {
      FAKE_CLAUDE_MODE: "voice",
      FAKE_CLAUDE_COLD_MS: String(COLD_MS),
      FAKE_CLAUDE_FIRST_TOKEN_MS: String(FIRST_TOKEN_MS),
      FAKE_CLAUDE_TOKEN_MS: String(TOKEN_MS),
      FAKE_CLAUDE_VOICE_REPLY: VOICE_REPLY,
      FAKE_CLAUDE_LAUNCH_LOG: launchFile,
    });
  }

  if (engine === "http" || engine === "grok" || engine === "claude") {
    // Cold opens one thread per turn and prewarms each (#1975 / #2055 / #1971):
    // raise the per-person warm rate and cap idle warm sessions so children
    // do not pile up and stall the stream watch.
    parentEnv.SAGAX_PREWARM_PER_MINUTE = parentEnv.SAGAX_PREWARM_PER_MINUTE ?? "40";
    parentEnv.SAGAX_MAX_IDLE_ENGINE_SESSIONS = parentEnv.SAGAX_MAX_IDLE_ENGINE_SESSIONS ?? "3";
    if (engine === "http") httpFixture = await startHttpFixture();
  }

  const fixture: VerificationServer = await launchVerificationServer(parentEnv, undefined, undefined, undefined, undefined, undefined, engine === "codex" ? ["codex"] : [], undefined, undefined, {
    prepareDataDir(dataDir) {
      if (engine === "codex") {
        const path = join(dataDir, "config.json");
        const config = JSON.parse(readFileSync(path, "utf8"));
        config.instances.codex.environment = {
          FAKE_CODEX_MODE: "voice",
          FAKE_CODEX_STARTUP_DELAY_MS: String(COLD_MS),
          FAKE_CODEX_FIRST_TOKEN_MS: String(FIRST_TOKEN_MS),
          FAKE_CODEX_TOKEN_MS: String(TOKEN_MS),
          FAKE_CODEX_VOICE_REPLY: VOICE_REPLY,
          FAKE_CODEX_LAUNCH_LOG: launchFile,
        };
        writeFileSync(path, JSON.stringify(config, null, 2));
        return;
      }
      if (engine !== "grok") return;
      const configPath = join(dataDir, "config.json");
      const config = JSON.parse(readFileSync(configPath, "utf8")) as { instances: Record<string, unknown> };
      config.instances = {
        grok: {
          driver: "grokAgent",
          displayName: "Bench Grok",
          config: { cli: FAKE_ACP_CLI, fullAuto: false },
          environment: {
            FAKE_ACP_MODE: "voice",
            FAKE_ACP_COLD_MS: String(COLD_MS),
            FAKE_ACP_LOAD_MS: String(LOAD_MS),
            FAKE_ACP_FIRST_TOKEN_MS: String(FIRST_TOKEN_MS),
            FAKE_ACP_TOKEN_MS: String(TOKEN_MS),
            FAKE_ACP_VOICE_REPLY: VOICE_REPLY,
            FAKE_ACP_LAUNCH_COUNT_FILE: launchFile,
            FAKE_ACP_RPC_APPEND_FILE: acpRpcFile,
          },
        },
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
  });

  const api = makeApi(fixture.info.url);
  const logOffset = { value: 0 };
  let sse: SseRecorder | undefined;
  try {
    if (keepTrace) console.error(`server log: ${fixture.info.logPath}`);

    const created = await api.control(["new-bot", "--name", "LatencyBench"]);
    const bot = created.bot as { id: string; activeTaskId?: string; threadId?: string };
    await installBotFixture(api, bot.id);

    if (engine === "codex") {
      await api.control(["set-model", "--bot", bot.id, "--instance", "codex", "--model", "gpt-fake-default"]);
    }
    if (engine === "grok") {
      await api.control(["set-model", "--bot", bot.id, "--instance", "grok", "--model", "grok-4.7-build-fast"]);
    }
    if (engine === "http") {
      await api.json("PATCH", "/api/config", {
        openaiCompat: { key: "synthetic-fixture-key", url: httpFixture!.url, model: "fixture-model" },
      });
      await api.control(["set-model", "--bot", bot.id, "--instance", "openaiCompat", "--model", "fixture-model"]);
    }

    sse = await openSse(`${fixture.info.url}/api/events`, { origin: fixture.info.url });
    // Prime log offset past boot noise.
    if (existsSync(fixture.info.logPath)) logOffset.value = readFileSync(fixture.info.logPath, "utf8").length;

    const samples: TurnSample[] = [];
    let warmThread: string | undefined;

    for (let i = 0; i < turns + 1; i++) {
      const warmup = i === 0;
      let justOpened = false;
      const threadId = mode === "warm"
        ? (warmThread ?? (warmThread = await (async () => {
          const id = await newBenchThread(api, bot.id, "latency-warm");
          seedHistory(fixture.info.dataDir, id, history);
          justOpened = true;
          return id;
        })()))
        : await (async () => {
          const id = await newBenchThread(api, bot.id, `latency-cold-${i}`);
          seedHistory(fixture.info.dataDir, id, history);
          justOpened = true;
          return id;
        })();

      // HTTP #1975 / Grok ACP #2055 / Claude #1971: simulate composer focus so
      // cold measures a turn that already paid spawn+session (and MCP settle),
      // not the cold start itself. Codex cold still starts without /warm.
      if ((engine === "http" || engine === "grok" || engine === "claude") && justOpened) {
        await prewarmBenchThread(api, bot.id, threadId, {
          logPath: fixture.info.logPath,
          logOffset,
          readyStep: engine === "grok" ? "acp-prewarmed" : engine === "claude" ? "claude-prewarmed" : "tools-prewarmed",
        });
      }

      const launchesBefore = readLaunchCount(engine === "http" ? undefined : launchFile);
      const sample = await measureTurn({
        api,
        botId: bot.id,
        threadId,
        sse,
        logPath: fixture.info.logPath,
        logOffset,
        launchFile: engine === "http" ? undefined : launchFile,
        launchesBefore,
        engine,
        index: i,
        warmup,
        text: `Bench turn ${i}: summarize the fixture plan in one short paragraph.`,
      });
      samples.push(sample);
      // Cold http/grok/claude: drop the just-measured thread so its warm
      // process or MCP mount is not held across the rest of the run.
      if (mode === "cold" && (engine === "http" || engine === "grok" || engine === "claude") && !warmup) {
        await api.json("DELETE", `/api/bots/${bot.id}/tasks/${threadId}`).catch(() => {});
      }
      // Brief gap so a reused CLI drains its previous result before the next send.
      await sleep(500);
    }

    const first = samples[0] ?? null;
    const measured = samples.slice(1);
    const result: ModeResult = {
      mode,
      turnsMeasured: measured.length,
      first_turn: first,
      stages: aggregate(measured),
      counts: {
        coldSpawns: measured.filter((s) => s.coldSpawn).length,
        reused: measured.filter((s) => s.reused).length,
        measured: measured.length,
      },
      turns: measured,
    };
    return {
      result,
      logPath: fixture.info.logPath,
      acpRpc: engine === "grok" ? readAcpRpc(acpRpcFile).map((row) => row.method) : undefined,
    };
  } finally {
    sse?.close();
    await fixture.close();
    if (httpFixture) {
      httpFixture.server.closeAllConnections?.();
      await new Promise<void>((resolve) => httpFixture!.server.close(() => resolve()));
    }
  }
}

function deltaStages(current: Record<string, StageStats>, baseline: Record<string, StageStats>): Record<string, { p50: number; p95: number }> {
  const out: Record<string, { p50: number; p95: number }> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
    const a = current[key];
    const b = baseline[key];
    if (!a || !b) continue;
    out[key] = { p50: Number((a.p50 - b.p50).toFixed(1)), p95: Number((a.p95 - b.p95).toFixed(1)) };
  }
  return out;
}

async function main(): Promise<void> {
  const opts = parseCli(process.argv.slice(2).filter((arg) => arg !== "--"));
  const started = Date.now();
  const document: {
    benchmark: string;
    at: string;
    git?: string;
    params: typeof opts;
    delays: { coldMs: number; firstTokenMs: number; tokenMs: number; loadMs: number };
    engines: Record<string, { modes: Record<string, ModeResult>; logPath?: string; acpMethods?: string[] }>;
    baselineDelta?: unknown;
  } = {
    benchmark: "turn-latency",
    at: new Date().toISOString(),
    params: opts,
    delays: { coldMs: COLD_MS, firstTokenMs: FIRST_TOKEN_MS, tokenMs: TOKEN_MS, loadMs: LOAD_MS },
    engines: {},
  };
  try {
    document.git = readFileSync(join(ROOT, ".git", "HEAD"), "utf8").trim();
  } catch {
    try {
      const gitdir = readFileSync(join(ROOT, ".git"), "utf8").trim();
      document.git = gitdir;
    } catch { /* ignore */ }
  }

  const tables: string[] = [];
  for (const engine of opts.engines) {
    document.engines[engine] = { modes: {} };
    for (const mode of opts.modes) {
      process.stderr.write(`running ${engine}/${mode} (${opts.turns} measured + 1 warm-up)...\n`);
      const { result, logPath, acpRpc } = await runEngineMode(engine, mode, opts.turns, opts.history, opts.keepTrace);
      document.engines[engine]!.modes[mode] = result;
      document.engines[engine]!.logPath = logPath;
      if (acpRpc) document.engines[engine]!.acpMethods = acpRpc;
      tables.push(markdownTable(`${engine} / ${mode}`, result.stages));
      tables.push(`cold spawns: ${result.counts.coldSpawns}, reused: ${result.counts.reused}, measured: ${result.counts.measured}\n`);
    }
  }

  if (opts.baseline && existsSync(opts.baseline)) {
    const previous = JSON.parse(readFileSync(opts.baseline, "utf8")) as typeof document;
    const delta: Record<string, unknown> = {};
    for (const engine of Object.keys(document.engines)) {
      delta[engine] = {};
      for (const mode of Object.keys(document.engines[engine]!.modes)) {
        const cur = document.engines[engine]!.modes[mode]!.stages;
        const base = previous.engines?.[engine]?.modes?.[mode]?.stages;
        if (base) (delta[engine] as any)[mode] = deltaStages(cur, base);
      }
    }
    document.baselineDelta = delta;
  }

  const payload = { ...document, wallMs: Date.now() - started };
  if (opts.out) {
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(payload, null, 2));
    process.stderr.write(`wrote ${opts.out}\n`);
  }
  process.stdout.write(tables.join("\n"));
  if (document.baselineDelta) {
    process.stdout.write("\nBaseline delta (current - baseline) p50/p95:\n");
    process.stdout.write(`${JSON.stringify(document.baselineDelta, null, 2)}\n`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
