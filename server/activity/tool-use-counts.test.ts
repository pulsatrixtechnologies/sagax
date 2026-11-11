// #3679: the compact prompt's tool use is counted as the tool runs are
// written, never read from the conversation logs on a turn's path.
//
// Fixture: 25 bots of one person, 40 conversations each (and two more past
// the window), plus one bot of another person. Logs are generated here
// (never a real one): every other conversation sealed at rest through the
// log writer's own sealing (sealLogLines), the rest plain lines. Each
// conversation calls a few MCP tools of three servers, chosen by its index,
// with a tool start and end per call. The oracle is the log reader the pins
// used before (readToolRuns), on the same logs.
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EVENTS_DIR, DATA_DIR } from "../config.ts";
import { configureContentEncryption } from "../messages/message-db.ts";
import { WORKSPACE_OWNER } from "../encryption/content-keys.ts";
import { resetAtRestState, sealLogLines } from "../encryption/content-at-rest.ts";
import { looksSealed } from "../encryption/content-file-crypto.ts";
import { compactPins, toolUsage, KNOWN_USE_CALLS, type ToolUse } from "../context/compact-prompt.ts";
import { createCompactPromptFor } from "../index-leaves/compactPromptFor.ts";
import { createRecentToolUses } from "../index-leaves/recentToolUses.ts";
import { sweepThreadEventLogs } from "../threads/thread-retention.ts";
import { capThreadLog } from "../threads/thread-log-rotation.ts";
import { readToolRuns } from "./activity.ts";
import { forgetToolUses, forgetToolUsesInMemory, saveToolUses, toolUsesAppended, toolUsesDir, toolUsesLogBytesRead, toolUsesOf, toolUsesSettled } from "./tool-use-counts.ts";

const THREADS = 40;
const BOTS = 25;
const SERVERS = ["agents", "crm", "files"] as const;
const TOOLS = ["list", "read", "write", "search", "find", "get", "send", "note", "plan", "fetch", "open", "close", "move", "copy"];

interface Task { threadId: string; updatedAt: number }
interface Bot { id: string; owner: string }
type Event = Record<string, unknown>;

const event = (threadId: string, n: number, extra: Event): Event => ({
  eventId: `${threadId}-e${n}`, provider: "test", threadId, createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(), ...extra,
});

/** The events of one conversation: `calls` tool runs over a few turns. */
function conversation(threadId: string, seed: number, calls: number, from = 0, pad = ""): Event[] {
  const events: Event[] = [];
  let n = from;
  for (let call = 0; call < calls; call++) {
    const turnId = `turn-${Math.floor((from + call) / 4)}`;
    const server = SERVERS[(seed + call) % SERVERS.length];
    const tool = TOOLS[(seed * 7 + call * 3) % TOOLS.length];
    const itemId = `item-${from + call}`;
    events.push(event(threadId, n++, { type: "item.started", itemType: "tool", turnId, itemId, title: `mcp__${server}__${tool}` }));
    events.push(event(threadId, n++, { type: "content.delta", turnId, delta: `working${pad}` }));
    events.push(event(threadId, n++, { type: "item.completed", itemType: "tool", turnId, itemId, ok: true }));
  }
  // a built-in tool and a gate's own search, which the pins never read
  events.push(event(threadId, n++, { type: "item.started", itemType: "tool", turnId: `turn-x${from}`, itemId: "bash", title: "Bash" }));
  events.push(event(threadId, n++, { type: "item.started", itemType: "tool", turnId: `turn-x${from}`, itemId: "gate", title: "mcp__crm__search_tools" }));
  return events;
}

const logFile = (threadId: string) => join(EVENTS_DIR, `${threadId}.ndjson`);
const linesOf = (threadId: string, events: Event[], sealed: boolean) => {
  const plain = events.map((e) => JSON.stringify(e));
  return sealed ? sealLogLines(logFile(threadId), events, plain) : plain;
};

/** A log written before this count existed: on disk, never through the writer. */
function writeLog(threadId: string, events: Event[], sealed: boolean) {
  writeFileSync(logFile(threadId), `${linesOf(threadId, events, sealed).join("\n")}\n`, { mode: 0o600 });
}

/** An append as the bus makes it (server/harness/bus.ts appendGroup). */
function append(threadId: string, events: Event[], sealed: boolean) {
  const lines = linesOf(threadId, events, sealed);
  appendFileSync(logFile(threadId), `${lines.join("\n")}\n`);
  toolUsesAppended(threadId, events, lines);
}

let bots: Bot[] = [];
const tasks = new Map<string, Task[]>();
const compactPinsByBot = new Map<string, unknown>();
const host = {
  DATA_DIR,
  EVENTS_DIR,
  COMPACT_USAGE_THREADS: THREADS,
  compactPinsByBot,
  store: { get bots() { return bots; }, tasks: (botId: string) => tasks.get(botId) ?? [] },
  effectiveBotOwner: (bot: Bot) => bot.owner,
  get recentToolUses() { return recentToolUses; },
};
const recentToolUses = createRecentToolUses(() => host);
const compactPromptFor = createCompactPromptFor(() => host);

/** What the log reader counts in one conversation: the oracle. */
const oracleCounts = (threadId: string) => {
  const counts: Record<string, number> = {};
  for (const run of readToolRuns(EVENTS_DIR, threadId)) if (run.tool.startsWith("mcp__")) counts[run.tool] = (counts[run.tool] ?? 0) + 1;
  return counts;
};

/** The pins as they were computed before #3679, from the logs: the oracle. */
function oraclePins(bot: Bot) {
  const read = (botId: string): ToolUse[] => [...(tasks.get(botId) ?? [])]
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, THREADS)
    .flatMap((task) => readToolRuns(EVENTS_DIR, task.threadId).map((run) => ({ name: run.tool })));
  const own = read(bot.id);
  const siblings = bots.filter((other) => other.id !== bot.id && other.owner === bot.owner).flatMap((other) => read(other.id));
  const ownUsage = toolUsage(own);
  const all = toolUsage([...own, ...siblings]);
  const ownAgentsCalls = [...(ownUsage.get("agents")?.values() ?? [])].reduce((sum, count) => sum + count, 0);
  return {
    agents: compactPins(ownAgentsCalls >= KNOWN_USE_CALLS ? ownUsage : all, []).agents,
    pinned: compactPins(all, [...all.keys()].filter((server) => server !== "agents")).pinned,
  };
}

const pinsOf = (bot: Bot) => {
  const { agents, pinned } = compactPromptFor(bot, bot.owner);
  return { agents, pinned };
};

function buildFixture() {
  rmSync(EVENTS_DIR, { recursive: true, force: true });
  rmSync(toolUsesDir(), { recursive: true, force: true });
  mkdirSync(EVENTS_DIR, { recursive: true });
  bots = [];
  tasks.clear();
  compactPinsByBot.clear();
  forgetToolUsesInMemory();
  let seed = 0;
  for (let b = 0; b < BOTS; b++) {
    const bot = { id: `bot-a${b}`, owner: "person-a" };
    bots.push(bot);
    const list: Task[] = [];
    for (let t = 0; t < THREADS + 2; t++) {
      const threadId = `a${b}-t${t}`;
      writeLog(threadId, conversation(threadId, seed++, 3 + (seed % 9)), t % 2 === 0);
      list.push({ threadId, updatedAt: 1_000 + t });
    }
    tasks.set(bot.id, list);
  }
  const other = { id: "bot-b0", owner: "person-b" };
  bots.push(other);
  writeLog("b0-t0", [event("b0-t0", 0, { type: "item.started", itemType: "tool", turnId: "t", itemId: "i", title: "mcp__ledger__balance" })], true);
  tasks.set(other.id, [{ threadId: "b0-t0", updatedAt: 1 }]);
}

/** Every count of the person's bots known (loaded in the background). */
async function countAll() {
  for (const bot of bots) compactPromptFor(bot, bot.owner);
  await toolUsesSettled();
  compactPinsByBot.clear();
}

beforeAll(async () => {
  process.env.SAGAX_MCP_OAUTH_KEY = "cd".repeat(32); // a synthetic vault key, this process only
  // the event log writer registers the logs sealed at rest
  await import("../harness/bus.ts");
  resetAtRestState();
  configureContentEncryption({ mode: "on", autoMigrate: false, resolveBotOwner: () => WORKSPACE_OWNER, resolveOwner: () => ({ owner: WORKSPACE_OWNER, confidential: false }) });
});
afterAll(() => {
  resetAtRestState();
  delete process.env.SAGAX_MCP_OAUTH_KEY;
});
beforeEach(async () => {
  // a load left running by the test before ends first
  await toolUsesSettled();
  buildFixture();
});

describe("compact prompt tool use (#3679)", () => {
  it("a first turn after a start reads zero bytes of conversation logs and holds the loop under 50 ms", async () => {
    const before = toolUsesLogBytesRead();
    let longest = 0;
    for (const bot of bots) {
      const started = performance.now();
      compactPromptFor(bot, bot.owner);
      longest = Math.max(longest, performance.now() - started);
    }
    expect(toolUsesLogBytesRead()).toBe(before);
    expect(longest).toBeLessThan(50);
    // nothing known yet: the day's value is not kept
    expect(compactPinsByBot.size).toBe(0);
    await toolUsesSettled();
    expect(toolUsesLogBytesRead()).toBeGreaterThan(before);
  });

  it("counts each log once in the background, one per slice, the loop given back between two", async () => {
    const ids = ["a0-t0", "a0-t1", "a0-t2", "a0-t3"];
    for (const id of ids) expect(toolUsesOf(id)).toBeUndefined();
    const known = () => ids.filter((id) => toolUsesOf(id) !== undefined).length;
    const seen: number[] = [];
    for (let tick = 0; tick < 20 && known() < ids.length; tick++) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      seen.push(known());
    }
    expect(known()).toBe(ids.length);
    // never more than one more conversation per turn of the loop
    seen.forEach((count, index) => expect(count - (seen[index - 1] ?? 0)).toBeLessThanOrEqual(1));
  });

  it("pins what the logs pinned, for every bot of the person", async () => {
    await countAll();
    const before = toolUsesLogBytesRead();
    for (const bot of bots.filter((each) => each.owner === "person-a")) expect(pinsOf(bot)).toEqual(oraclePins(bot));
    expect(toolUsesLogBytesRead()).toBe(before);
    expect(compactPinsByBot.has(bots[0]!.id)).toBe(true);
  });

  it("a tool run moves the count, a start written twice counts once, as the log reader counts", async () => {
    await countAll();
    const before = toolUsesLogBytesRead();
    for (const [threadId, sealed] of [["a0-t39", false], ["a0-t38", true]] as const) {
      const count = toolUsesOf(threadId)!["mcp__crm__list"] ?? 0;
      const start = event(threadId, 900, { type: "item.started", itemType: "tool", turnId: "turn-late", itemId: "late", title: "mcp__crm__list" });
      append(threadId, [start, { ...start, eventId: `${threadId}-again` }], sealed);
      expect(toolUsesOf(threadId)!["mcp__crm__list"]).toBe(count + 1);
      expect(toolUsesOf(threadId)).toEqual(oracleCounts(threadId));
    }
    // a new conversation started by the writer is counted from its first line
    append("a0-new", conversation("a0-new", 3, 5), true);
    expect(toolUsesOf("a0-new")).toEqual(oracleCounts("a0-new"));
    expect(toolUsesLogBytesRead()).toBe(before);
  });

  it("keeps the newest 2,000 events' use of a long conversation, not its lifetime total", async () => {
    // written live: 1,500 tool runs (4,500 events and more), the tools changing over time
    const live = "a1-live";
    tasks.get("bot-a1")!.push({ threadId: live, updatedAt: 5_000 });
    for (let at = 0; at < 1_500; at += 50) append(live, conversation(live, at, 50, 10_000 + at * 3), at % 100 === 0);
    // written before the count existed: the same, counted from its log
    const old = "a1-old";
    tasks.get("bot-a1")!.push({ threadId: old, updatedAt: 5_001 });
    writeLog(old, Array.from({ length: 30 }, (_, k) => conversation(old, k * 50, 50, 10_000 + k * 150)).flat(), true);
    await countAll();
    for (const threadId of [live, old]) {
      const oracle = oracleCounts(threadId);
      expect(Object.values(oracle).reduce((sum, n) => sum + n, 0)).toBeLessThan(1_000);
      expect(toolUsesOf(threadId)).toEqual(oracle);
    }
    const bot = bots[1]!;
    expect(pinsOf(bot)).toEqual(oraclePins(bot));
    // and stays so as newer runs push older ones out
    append(live, conversation(live, 7, 200, 90_000), true);
    expect(toolUsesOf(live)).toEqual(oracleCounts(live));
  });

  it("stops at the reader's 8 MB window when 2,000 events are bigger than that", async () => {
    const big = "a2-big";
    const pad = "x".repeat(30_000);
    for (let at = 0; at < 300; at += 20) append(big, conversation(big, at, 20, 20_000 + at * 3, pad), at % 40 === 0);
    expect(statSync(logFile(big)).size).toBeGreaterThan(9 * 1024 * 1024);
    // fewer than 2,000 events, yet the reader stops short of the oldest runs
    expect(Object.values(oracleCounts(big)).reduce((sum, n) => sum + n, 0)).toBeLessThan(300);
    await countAll();
    expect(toolUsesOf(big)).toEqual(oracleCounts(big));
    forgetToolUsesInMemory();
    rmSync(toolUsesDir(), { recursive: true, force: true });
    expect(toolUsesOf(big)).toBeUndefined();
    await toolUsesSettled();
    expect(toolUsesOf(big)).toEqual(oracleCounts(big));
  });

  it("a log the size cap trimmed is counted again from the log", async () => {
    const threadId = "a3-capped";
    for (let at = 0; at < 600; at += 30) append(threadId, conversation(threadId, at, 30, 30_000 + at * 3), false);
    await countAll();
    capThreadLog(logFile(threadId), 64 * 1024);
    append(threadId, conversation(threadId, 1, 3, 99_000), false);
    expect(toolUsesOf(threadId)).toBeUndefined();
    await toolUsesSettled();
    expect(toolUsesOf(threadId)).toEqual(oracleCounts(threadId));
  });

  it("keeps the counts across a restart, sealed under the conversation's key", async () => {
    await countAll();
    saveToolUses();
    const stored = readFileSync(join(toolUsesDir(), "a0-t2.json"));
    expect(looksSealed(stored)).toBe(true);
    expect(stored.includes("mcp__")).toBe(false);
    expect(statSync(join(toolUsesDir(), "a0-t2.json")).mode & 0o777).toBe(0o600);
    forgetToolUsesInMemory();
    const before = toolUsesLogBytesRead();
    await countAll();
    // loaded from the kept counts: no log read again
    expect(toolUsesLogBytesRead()).toBe(before);
    for (const bot of [bots[3]!, bots[20]!]) expect(pinsOf(bot)).toEqual(oraclePins(bot));
  });

  it("a deleted or swept conversation's count goes with its log", async () => {
    await countAll();
    saveToolUses();
    const deleted = join(toolUsesDir(), "a4-t2.json");
    const swept = join(toolUsesDir(), "a4-t3.json");
    expect(existsSync(deleted) && existsSync(swept)).toBe(true);
    forgetToolUses("a4-t2");
    expect(existsSync(deleted)).toBe(false);
    expect(sweepThreadEventLogs([{ threadId: "a4-t3", closedAt: 1, archivedAt: null, unread: false, busy: false, openDirectHandoff: false }], 1, 10 * 86_400_000)).toBe(1);
    expect(existsSync(swept)).toBe(false);
    saveToolUses();
    expect(existsSync(deleted) || existsSync(swept)).toBe(false);
  });

  it("never adds one person's use to another person's bot", async () => {
    await countAll();
    const other = bots.find((bot) => bot.owner === "person-b")!;
    expect(Object.keys(pinsOf(other).pinned)).toEqual(["ledger"]);
    for (const bot of bots.filter((each) => each.owner === "person-a")) expect(pinsOf(bot).pinned.ledger).toBeUndefined();
  });
});
