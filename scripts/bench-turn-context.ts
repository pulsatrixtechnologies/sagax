#!/usr/bin/env -S node --experimental-strip-types
// Accept → send timing for the turn-context path (prepare/setup/prompt).
// Uses the verification fixture (fake Claude CLI) with SAGAX_TURN_TRACE=1.
//
//   SAGAX_TURN_TRACE=1 node --experimental-strip-types scripts/bench-turn-context.ts
//   SAGAX_TURN_TRACE=1 node --experimental-strip-types scripts/bench-turn-context.ts --messages 40 --warm 20 --cold 10
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync, openSync, closeSync, cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  launchVerificationServer,
  runControlOmb,
  verificationServerArgs,
  verificationServerEnvironment,
} from "./control-omb.ts";
import { waitForExit } from "../server/testing/cleanup.ts";
import { freePortBlock } from "../server/testing/ports.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const { values } = parseArgs({
  options: {
    messages: { type: "string", default: "40" },
    warm: { type: "string", default: "20" },
    cold: { type: "string", default: "10" },
    hash: { type: "boolean", default: false },
  },
});

const HISTORY = Number(values.messages);
const WARM = Number(values.warm);
const COLD = Number(values.cold);
const WANT_HASH = values.hash === true;

const STEPS = [
  "start",
  "prewarm-joined",
  "compacted",
  "context-selected",
  "soul-drift",
  "skills-selected",
  "oauth-refreshed",
  "mcp-mounted",
  "integrations",
  "prompt-start",
  "prompt-sections",
  "connectors-patched",
  "state.prompt-built",
  "recall",
  "access",
  "command",
  "send",
] as const;

type Step = (typeof STEPS)[number] | string;

const SOUL = ("You are Wren, a careful assistant for Osprey. " +
  "Cite sources. Keep answers short. Never invent client names. ").repeat(40).slice(0, 2048);

const RULES = `# Rules
- Prefer short replies.
- Never invent a person or organisation name; use Wren and Osprey only.
- Ask before any external send.
`;

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!.toFixed(1));
}

function parseTrace(log: string, threadPrefix: string): Array<{ step: string; at: number; elapsed: number }> {
  const out: Array<{ step: string; at: number; elapsed: number }> = [];
  for (const line of log.split("\n")) {
    const match = line.match(/^\[turn-trace\] ([0-9a-f]{8}) (\S+) (\d{13}) \+(\d+)$/);
    if (!match) continue;
    if (match[1] !== threadPrefix) continue;
    out.push({ step: match[2]!, at: Number(match[3]), elapsed: Number(match[4]) });
  }
  return out;
}

function gapsBetween(steps: Array<{ step: string; at: number }>): Record<string, number> {
  const gaps: Record<string, number> = {};
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!;
    const cur = steps[i]!;
    gaps[`${prev.step}->${cur.step}`] = cur.at - prev.at;
  }
  if (steps.length) {
    const first = steps[0]!;
    const send = steps.find((s) => s.step === "send") ?? steps[steps.length - 1]!;
    gaps["start->send"] = send.at - first.at;
  }
  return gaps;
}

async function api(url: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { "content-type": "application/json", origin: url, ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path}: ${response.status} ${await response.text()}`);
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function settle(url: string, botId: string, timeoutSec = 60) {
  const env = { SAGAX_URL: url };
  const result = await runControlOmb(["wait", "--bot", botId, "--timeout", String(timeoutSec)], { env }) as { status?: string };
  if (result.status !== "settled") throw new Error(`turn did not settle: ${JSON.stringify(result)}`);
}

function writeWorkspace(dataDir: string, botId: string) {
  const root = join(dataDir, "workspaces", botId);
  mkdirSync(join(root, "memory"), { recursive: true });
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(dataDir, "bots", botId), { recursive: true });
  writeFileSync(join(dataDir, "bots", botId, "SOUL.md"), SOUL, { mode: 0o600 });
  writeFileSync(join(root, "RULES.md"), RULES, { mode: 0o600 });
  writeFileSync(join(root, "MEMORY.md"), `# Memory\n\n- Wren works with Osprey.\n- Prefer short replies.\n- Desk is in Montreal.\n`, { mode: 0o600 });
  for (const [name, body] of [
    ["preferences.md", "# Preferences\n\nShort answers. Quebec French when asked.\n"],
    ["projects.md", "# Projects\n\n- turn-context bench\n- fixture seeding\n"],
    ["contacts.md", "# Contacts\n\n- Wren (assistant)\n- Osprey (operator)\n"],
  ] as const) {
    writeFileSync(join(root, "memory", name), body, { mode: 0o600 });
  }
  for (let i = 1; i <= 5; i++) {
    writeFileSync(join(root, "docs", `doc-${i}.md`), `# Document ${i}\n\nProcedure ${i} for the Osprey desk.\n\n${"Step detail. ".repeat(20)}\n`, { mode: 0o600 });
  }
  const skillsRoot = join(dataDir, "skills");
  mkdirSync(skillsRoot, { recursive: true });
  for (const id of ["bench-alpha", "bench-beta", "bench-gamma", "bench-delta"]) {
    const dir = join(skillsRoot, id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({
      id,
      name: id,
      version: "1.0.0",
      description: `Bench skill ${id}`,
      defaultEnabled: true,
      triggerTerms: [id.replace("bench-", ""), "bench"],
      requiredCapabilities: [],
    }, null, 2));
    writeFileSync(join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: Bench skill\n---\n\n# ${id}\n\nDo the ${id} checklist.\n`);
  }
}

async function putSoul(url: string, botId: string) {
  await api(url, `/api/bots/${botId}/profile`, {
    method: "PATCH",
    body: JSON.stringify({ soul: SOUL, name: "Wren", title: "Bench bot", description: "Turn-context fixture" }),
  });
}

/** Append synthetic history offline (server stopped). Encryption off.
 * Runs in a child so SAGAX_DATA_DIR is bound before config.ts loads. */
async function seedHistoryOffline(dataDir: string, threadId: string, count: number) {
  if (count <= 0) return;
  const script = `
import { appendMessage, closeMessageDb } from ${JSON.stringify(join(ROOT, "server/messages/message-db.ts"))};
const threadId = ${JSON.stringify(threadId)};
const count = ${count};
const now = Date.now() - count * 2000;
for (let i = 0; i < count; i++) {
  appendMessage(threadId, { id: "seed-u-" + i, at: now + i * 2000, role: "user", kind: "text", text: "Seed turn " + (i + 1) + " of " + count + ".", sendId: "seed-send-" + i });
  appendMessage(threadId, { id: "seed-b-" + i, at: now + i * 2000 + 500, role: "bot", kind: "text", text: "ok " + (i + 1) });
}
closeMessageDb();
console.log(JSON.stringify({ seeded: count, threadId }));
`;
  const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", script], {
    cwd: ROOT,
    env: { ...process.env, SAGAX_DATA_DIR: dataDir, SAGAX_CONTENT_ENCRYPTION: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout?.on("data", (chunk) => { out += String(chunk); });
  child.stderr?.on("data", (chunk) => { err += String(chunk); });
  const code = await new Promise<number>((resolve) => child.on("exit", (c) => resolve(c ?? 1)));
  if (code !== 0) throw new Error(`seedHistoryOffline failed (${code}): ${err || out}`);
}

async function relaunchOnDataDir(dataDir: string, port: number): Promise<{ child: ReturnType<typeof spawn>; logPath: string; url: string; fixtureDumpPath: string; close: () => Promise<void> }> {
  const url = `http://127.0.0.1:${port}`;
  const logPath = join(dataDir, `relaunch-${Date.now()}.log`);
  const log = openSync(logPath, "a", 0o600);
  const parentEnv = { ...process.env, SAGAX_TURN_TRACE: "1", FAKE_CLAUDE_MODE: "happy", SAGAX_CONTENT_ENCRYPTION: "0" };
  const childEnv = verificationServerEnvironment(parentEnv, dataDir, port);
  const child = spawn(process.execPath, verificationServerArgs(childEnv), {
    cwd: ROOT,
    env: childEnv,
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`relaunch exited early; see ${logPath}`);
    try {
      const response = await fetch(`${url}/api/health`, { headers: { origin: url } });
      if (response.ok) break;
    } catch { /* not ready */ }
    if (Date.now() >= deadline) throw new Error(`relaunch not ready; see ${logPath}`);
    await delay(150);
  }
  let closed = false;
  return {
    child,
    logPath,
    url,
    fixtureDumpPath: join(dataDir, "fake-claude-dump.json"),
    async close() {
      if (closed) return;
      closed = true;
      await waitForExit(child, { signal: "SIGTERM" });
    },
  };
}

function readNewTrace(logPath: string, offset: number): { text: string; next: number } {
  const buf = readFileSync(logPath);
  const text = buf.subarray(offset).toString("utf8");
  return { text, next: buf.length };
}

function summarize(label: string, samples: Array<Record<string, number>>) {
  const keys = new Set<string>();
  for (const sample of samples) for (const key of Object.keys(sample)) keys.add(key);
  const ordered = [...keys].sort((a, b) => (a === "start->send" ? -1 : b === "start->send" ? 1 : a.localeCompare(b)));
  const rows = ordered.map((key) => {
    const values = samples.map((s) => s[key]).filter((v): v is number => typeof v === "number");
    return { gap: key, n: values.length, p50: percentile(values, 0.5), p95: percentile(values, 0.95) };
  });
  console.log(JSON.stringify({ suite: label, messages: HISTORY, rows }, null, 2));
  return rows;
}

function dumpHash(dumpPath: string): string | null {
  if (!existsSync(dumpPath)) return null;
  const dump = JSON.parse(readFileSync(dumpPath, "utf8")) as {
    prompt?: string;
    systemPrompt?: string | null;
    systemPromptFile?: string | null;
  };
  const body = JSON.stringify({
    prompt: dump.prompt ?? "",
    systemPrompt: dump.systemPrompt ?? "",
    systemPromptFile: dump.systemPromptFile ?? "",
  });
  return createHash("sha256").update(body).digest("hex");
}

const keepDir = join(tmpdir(), `sagax-turn-context-bench-${process.pid}`);
rmSync(keepDir, { recursive: true, force: true });
mkdirSync(keepDir, { recursive: true });

const bootstrap = await launchVerificationServer({
  ...process.env,
  SAGAX_TURN_TRACE: "1",
  FAKE_CLAUDE_MODE: "happy",
  SAGAX_CONTENT_ENCRYPTION: "0",
});
let url = bootstrap.info.url;
let dataDir = bootstrap.info.dataDir;
let logPath = bootstrap.info.logPath;
let dumpPath = bootstrap.fixtureDumpPath;
let env = { SAGAX_URL: url };
let liveClose: (() => Promise<void>) | null = null;

console.log(JSON.stringify({
  benchmark: "turn-context",
  messages: HISTORY,
  warm: WARM,
  cold: COLD,
  url,
  logPath,
  dataDir,
}));

let logOffset = readFileSync(logPath).length;
const warmGaps: Array<Record<string, number>> = [];
const coldGaps: Array<Record<string, number>> = [];
const hashes: string[] = [];

try {
  const created = await runControlOmb(["new-bot", "--name", "Wren"], { env }) as { bot: { id: string; activeTaskId: string } };
  const botId = created.bot.id;
  const threadId = created.bot.activeTaskId;
  await putSoul(url, botId);
  writeWorkspace(dataDir, botId);

  await runControlOmb(["send", "--bot", botId, "--task", threadId, "--text", "Prime the bench fixture."], { env });
  await settle(url, botId, 90);

  // Keep the data dir, stop the bootstrap server, seed history offline, relaunch.
  cpSync(dataDir, keepDir, { recursive: true });
  await bootstrap.close();
  if (HISTORY > 0) {
    console.error(`seeding ${HISTORY} history message pairs offline…`);
    await seedHistoryOffline(keepDir, threadId, HISTORY);
  }
  const port = await freePortBlock([0, 1]);
  const relaunched = await relaunchOnDataDir(keepDir, port);
  liveClose = () => relaunched.close();
  url = relaunched.url;
  dataDir = keepDir;
  logPath = relaunched.logPath;
  dumpPath = relaunched.fixtureDumpPath;
  env = { SAGAX_URL: url };
  logOffset = readFileSync(logPath).length;

  for (let i = 0; i < WARM; i++) {
    await runControlOmb(["send", "--bot", botId, "--task", threadId, "--text", `Warm turn ${i + 1}. Reply with ok.`], { env });
    await settle(url, botId, 90);
    await delay(30);
    const { text, next } = readNewTrace(logPath, logOffset);
    logOffset = next;
    const prefix = threadId.slice(0, 8);
    const steps = parseTrace(text, prefix);
    const lastStart = [...steps].reverse().findIndex((s) => s.step === "start" || s.step.startsWith("start:"));
    const run = lastStart >= 0 ? steps.slice(steps.length - 1 - lastStart) : steps;
    warmGaps.push(gapsBetween(run));
    if (WANT_HASH) {
      const hash = dumpHash(dumpPath);
      if (hash) hashes.push(hash);
    }
    const payload = text.split("\n").filter((line) => line.includes("payload-hash")).at(-1);
    if (payload) console.error(payload);
  }
  summarize(`warm-${HISTORY}`, warmGaps);

  for (let i = 0; i < COLD; i++) {
    const task = await api(url, `/api/bots/${botId}/tasks`, {
      method: "POST",
      body: JSON.stringify({ title: `Cold ${i + 1}` }),
    }) as { task: { threadId: string } };
    const coldThread = task.task.threadId;
    await runControlOmb(["send", "--bot", botId, "--task", coldThread, "--text", `Cold turn ${i + 1}. Reply with ok.`], { env });
    await settle(url, botId, 90);
    await delay(30);
    const { text, next } = readNewTrace(logPath, logOffset);
    logOffset = next;
    const prefix = coldThread.slice(0, 8);
    const steps = parseTrace(text, prefix);
    coldGaps.push(gapsBetween(steps));
    if (WANT_HASH) {
      const hash = dumpHash(dumpPath);
      if (hash) hashes.push(hash);
    }
  }
  summarize(`cold-${HISTORY}`, coldGaps);

  if (WANT_HASH && hashes.length) {
    const unique = [...new Set(hashes)];
    console.log(JSON.stringify({ fakeClaudeDumpHashes: unique, identical: unique.length === 1 }));
  }
} finally {
  if (liveClose) await liveClose();
  else await bootstrap.close().catch(() => undefined);
  rmSync(keepDir, { recursive: true, force: true });
}
