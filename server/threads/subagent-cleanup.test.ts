import { describe, expect, it } from "vitest";
import type { WireMessage as Message } from "../../shared/wire.ts";
import {
  closedTool, closeRowsLeftByRestart, CUT_TOOL_OUTPUT, ENDED_TOOL_OUTPUT, endedToolOutput, openedThreadRefs,
  openToolRows, ownSubagentThreads, RESTART_TOOL_OUTPUT, type RowSweepStore,
} from "./subagent-cleanup.ts";

const row = (id: string, at: number, tool?: Message["tool"]): Message => ({ id, at, role: "bot", kind: "activity", ...(tool ? { tool } : {}) }) as Message;

describe("rows a turn leaves open", () => {
  it("finds only the calls still marked as running", () => {
    const rows = [row("a", 1, { name: "Agent" }), row("b", 2, { name: "Bash", ok: true }), row("c", 3, { name: "Read", ok: false }), row("d", 4)];
    expect(openToolRows(rows).map((message) => message.id)).toEqual(["a"]);
  });

  it("closes a row as not finished, with why and how long it ran", () => {
    const closed = closedTool(row("a", 1_000, { name: "Agent", input: "{}" }), ENDED_TOOL_OUTPUT, 4_000);
    expect(closed).toEqual({ name: "Agent", input: "{}", ok: false, output: ENDED_TOOL_OUTPUT, durationMs: 3_000 });
  });

  it("says Stop when a person stopped the turn, and that the turn ended otherwise (an error, a limit)", () => {
    expect(endedToolOutput({ stopped: true })).toBe(CUT_TOOL_OUTPUT);
    expect(endedToolOutput({ stopped: false })).toBe(ENDED_TOOL_OUTPUT);
  });
});

describe("the start sweep", () => {
  function fakeStore(threads: Record<string, Message[]>, tasks: Array<{ threadId: string; createdAt: number; updatedAt?: number }>): RowSweepStore & { patched: Array<[string, string, Partial<Message>]> } {
    const patched: Array<[string, string, Partial<Message>]> = [];
    return {
      patched,
      bots: [{ id: "bot-1" }],
      tasks: () => tasks,
      messagesTail: (threadId) => ({ messages: threads[threadId] ?? [] }),
      patchMessage: (threadId, messageId, patch) => { patched.push([threadId, messageId, patch]); return {}; },
    };
  }

  it("closes the sub-agents and calls a cut run left open in recent threads", async () => {
    const store = fakeStore({
      recent: [row("agent", 100, { name: "Agent" }), row("done", 110, { name: "Bash", ok: true })],
      old: [row("old-agent", 1, { name: "Agent" })],
    }, [{ threadId: "recent", createdAt: 50, updatedAt: 1_000 }, { threadId: "old", createdAt: 1 }]);
    expect(await closeRowsLeftByRestart(store, 500, 2_000)).toBe(1);
    expect(store.patched).toEqual([["recent", "agent", { tool: { name: "Agent", ok: false, output: RESTART_TOOL_OUTPUT, durationMs: 1_900 } }]]);
  });

  it("goes on past a thread that cannot be read", async () => {
    const store = fakeStore({ ok: [row("a", 1, { name: "Agent" })] }, [{ threadId: "broken", createdAt: 10 }, { threadId: "ok", createdAt: 10 }]);
    const read = store.messagesTail;
    store.messagesTail = (threadId, limit) => { if (threadId === "broken") throw new Error("sealed"); return read(threadId, limit); };
    expect(await closeRowsLeftByRestart(store, 0, 5)).toBe(1);
  });

  // #3599: a busy server's start read the newest rows of every recent thread
  // in one synchronous pass (390 to 450 ms of the start on 1,850 threads).
  it("reads a slice of threads, gives the loop back, then finishes, leaving this run's rows open", async () => {
    const threads: Record<string, Message[]> = {};
    const tasks = Array.from({ length: 500 }, (_, index) => {
      threads[`t${index}`] = [row(`cut-${index}`, 100, { name: "Agent" }), row(`new-${index}`, 2_000, { name: "Bash" })];
      return { threadId: `t${index}`, createdAt: 50, updatedAt: 1_000 };
    });
    const store = fakeStore(threads, tasks);
    let reads = 0;
    let ticks = 0;
    const read = store.messagesTail;
    store.messagesTail = (threadId, limit) => { reads += 1; ticks += 1; return read(threadId, limit); };
    const sweep = closeRowsLeftByRestart(store, 500, 2_000, { sliceMs: 10, clock: () => ticks });
    // the start goes on after one slice: ten threads, not five hundred
    expect(reads).toBe(10);
    expect(await sweep).toBe(500);
    expect(reads).toBe(500);
    // only the rows the stop cut: a row written from the start on is this run's
    expect(store.patched.map(([, id]) => id).filter((id) => id.startsWith("new-"))).toEqual([]);
  });
});

describe("a Stop's own sub-agents", () => {
  const tasks = [
    { threadId: "parent" },
    // the bot routed it itself, still owed its result
    { threadId: "bot-parallel", parallelOf: { threadId: "parent", byBot: true } },
    // a person asked for it: it keeps running
    { threadId: "person-parallel", parallelOf: { threadId: "parent" } },
    // already reported back
    { threadId: "reported", parallelOf: { threadId: "parent", byBot: true, reportedAt: 5 } },
    // another conversation's task
    { threadId: "elsewhere", parallelOf: { threadId: "other", byBot: true } },
    // opened by the bot on itself from this conversation
    { threadId: "self-busy", openedBy: { botId: "bot-1" } },
    { threadId: "self-idle", openedBy: { botId: "bot-1" } },
    // a teammate's thread and a delegation are not the bot's own
    { threadId: "peer", openedBy: { botId: "bot-2" } },
    { threadId: "delegated", openedBy: { botId: "bot-1", delegationId: "d1" } },
    // a routine's run keeps its own lifecycle
    { threadId: "routine", openedBy: { botId: "bot-1" }, routineRunId: "r1" },
  ];

  it("names the bot's own working sub-agents of this conversation, nothing else", () => {
    const opened = new Set(["self-busy", "self-idle", "peer", "delegated", "routine"]);
    const result = ownSubagentThreads({ botId: "bot-1", threadId: "parent", tasks, opened, active: (id) => id !== "self-idle" });
    expect(result).toEqual({ parallel: ["bot-parallel"], threads: ["self-busy"] });
  });

  it("leaves a thread the bot opened from another conversation", () => {
    const result = ownSubagentThreads({ botId: "bot-1", threadId: "parent", tasks, opened: new Set(), active: () => true });
    expect(result.threads).toEqual([]);
  });

  it("reads the opened threads off the conversation's chips, on this bot only", () => {
    const messages = [
      { role: "bot", threadRef: { botId: "bot-1", threadId: "t1", title: "x" } },
      { role: "bot", threadRef: { botId: "bot-2", threadId: "t2", title: "y" } },
      { role: "user", threadRef: { botId: "bot-1", threadId: "t3", title: "z" } },
    ] as Array<Pick<Message, "threadRef" | "role">>;
    expect([...openedThreadRefs(messages, "bot-1")]).toEqual(["t1"]);
  });
});
