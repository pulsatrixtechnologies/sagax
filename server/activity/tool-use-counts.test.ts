// #3679: tool use is counted as the tool runs are written, never read from
// the conversation logs on a turn's path. #4527: under one id per tool,
// `<server>/<tool>`, whatever name the engine gave the call.
//
// Fixture: 25 bots of one person, 40 conversations each (and two more past
// the window), plus one bot of another person. Logs are generated here
// (never a real one): every other conversation sealed at rest through the
// log writer's own sealing (sealLogLines), the rest plain lines. Each
// conversation calls a few MCP tools of three servers, chosen by its index,
// with a tool start and end per call. The oracle is the log reader
// (readToolRuns), on the same logs.
import { appendFileSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { EVENTS_DIR } from "../config.ts";
import { configureContentEncryption } from "../messages/message-db.ts";
import { WORKSPACE_OWNER } from "../encryption/content-keys.ts";
import { resetAtRestState, sealLogLines } from "../encryption/content-at-rest.ts";
import { looksSealed } from "../encryption/content-file-crypto.ts";
import { stepToolId } from "../../shared/searched-tool-call.ts";
import { forgetToolKeepInMemory, toolKeepDir, toolKeepTurn, readToolKeep } from "../tools/tool-keep.ts";
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
  // a built-in tool and a gate's own search, never counted
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
/** What the log reader counts in one conversation, by tool id: the oracle. */
const oracleCounts = (threadId: string) => {
  const counts: Record<string, number> = {};
  for (const run of readToolRuns(EVENTS_DIR, threadId)) {
    const id = stepToolId({ title: run.tool });
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
};

/** A bot's conversations, the newest first. */
const threadsOf = (bot: Bot) => [...(tasks.get(bot.id) ?? [])].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, THREADS).map((task) => task.threadId);

function buildFixture() {
  rmSync(EVENTS_DIR, { recursive: true, force: true });
  rmSync(toolUsesDir(), { recursive: true, force: true });
  mkdirSync(EVENTS_DIR, { recursive: true });
  bots = [];
  tasks.clear();
  forgetToolUsesInMemory();
  forgetToolKeepInMemory();
  rmSync(toolKeepDir(), { recursive: true, force: true });
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

/** Every count of the bots known (loaded in the background). */
async function countAll() {
  for (const bot of bots) for (const threadId of threadsOf(bot)) toolUsesOf(threadId);
  await toolUsesSettled();
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

describe("tool use counts (#3679)", () => {
  it("a first read after a start reads zero bytes of conversation logs and holds the loop under 50 ms", async () => {
    const before = toolUsesLogBytesRead();
    let longest = 0;
    for (const bot of bots) {
      const started = performance.now();
      for (const threadId of threadsOf(bot)) expect(toolUsesOf(threadId)).toBeUndefined();
      longest = Math.max(longest, performance.now() - started);
    }
    expect(toolUsesLogBytesRead()).toBe(before);
    expect(longest).toBeLessThan(50);
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

  it("counts what the log reader reads, for every conversation", async () => {
    await countAll();
    const before = toolUsesLogBytesRead();
    for (const bot of bots) for (const threadId of threadsOf(bot)) expect(toolUsesOf(threadId)).toEqual(oracleCounts(threadId));
    expect(toolUsesLogBytesRead()).toBe(before);
  });

  it("a tool run moves the count, a start written twice counts once, as the log reader counts", async () => {
    await countAll();
    const before = toolUsesLogBytesRead();
    for (const [threadId, sealed] of [["a0-t39", false], ["a0-t38", true]] as const) {
      const count = toolUsesOf(threadId)!["crm/list"] ?? 0;
      const start = event(threadId, 900, { type: "item.started", itemType: "tool", turnId: "turn-late", itemId: "late", title: "mcp__crm__list" });
      append(threadId, [start, { ...start, eventId: `${threadId}-again` }], sealed);
      expect(toolUsesOf(threadId)!["crm/list"]).toBe(count + 1);
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
    expect(stored.includes("crm/")).toBe(false);
    expect(statSync(join(toolUsesDir(), "a0-t2.json")).mode & 0o777).toBe(0o600);
    forgetToolUsesInMemory();
    const before = toolUsesLogBytesRead();
    await countAll();
    // loaded from the kept counts: no log read again
    expect(toolUsesLogBytesRead()).toBe(before);
    for (const bot of [bots[3]!, bots[20]!]) for (const threadId of threadsOf(bot)) expect(toolUsesOf(threadId)).toEqual(oracleCounts(threadId));
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

  it("counts each engine's spelling of a call under the one id of the tool", () => {
    const threadId = "engines-t0";
    const step = (n: number, extra: Event) => event(threadId, n, { type: "item.started", itemType: "tool", turnId: "t", itemId: `i${n}`, ...extra });
    append(threadId, [
      // Claude Code
      step(1, { title: "mcp__agents__ask_bot" }),
      // Codex: the tool alone, the id on the step (red before #4527: not counted)
      step(2, { title: "ask_bot", tool: "agents/ask_bot" }),
      // an ACP engine
      step(3, { title: "agents__ask_bot" }),
      // a chat-completions engine, the agents tool by its own name
      step(4, { title: "agents_ask_bot" }),
      // a chat-completions engine, a connector's tool with its id on the step
      step(5, { title: "crm_get_ticket", tool: "crm/get_ticket" }),
      // Pi's gateway and Grok's use_tool
      step(6, { title: "mcp__crm__get_ticket" }),
      step(7, { title: "crm__get_ticket" }),
      // a renamed Sagax tool counts as its current name
      step(8, { title: "agents__propose_team_memory" }),
      // never counted: a built-in tool, a command, finding tools
      step(9, { title: "Bash" }),
      step(10, { title: "bin/test" }),
      step(11, { title: "agents_call_tool" }),
      step(12, { title: "tool_search" }),
      step(13, { title: "search", tool: "crm/search_tools" }),
    ], false);
    expect(toolUsesOf(threadId)).toEqual({ "agents/ask_bot": 4, "crm/get_ticket": 3, "agents/save_team_memory": 1 });
  });

  it("hands a live call to the conversation's open session, never a recount from the log", async () => {
    const threadId = "a5-t41";
    await countAll();
    toolKeepTurn({ botId: "bot-a5", person: "person-a", threadId, prompt: true });
    append(threadId, [event(threadId, 950, { type: "item.started", itemType: "tool", turnId: "late", itemId: "late", title: "ask_bot", tool: "agents/ask_bot" })], true);
    // the log is counted again from scratch: nothing reaches the session twice
    forgetToolUsesInMemory();
    toolUsesOf(threadId);
    await toolUsesSettled();
    const open = Object.values(readToolKeep("bot-a5", "person-a").open);
    expect(open.map((session) => session.used)).toEqual([["agents/ask_bot"]]);
  });
});
