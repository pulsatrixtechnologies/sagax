// #4407: a thread made confidential stayed in the engine sessions of the
// bot's other conversations. A stream turn's "Earlier topics" block (its id,
// title and digest) and the "Recent work" lines ride in the volatile half,
// inside each session's own history; after the change the next turn only
// sent a section without them, and the earlier copy stayed in the live
// process, its native transcript and every resume of it.
import { describe, expect, it, vi } from "vitest";
import { createAutoRecallPrompt } from "./autoRecallPrompt.ts";
import { createForgetThreadEngineSessions } from "./forgetThreadEngineSessions.ts";
import { createMakeThreadConfidential } from "./makeThreadConfidential.ts";

// what automatic recall found for the turn: passages of topic-b only
vi.mock("../recall/recall.ts", () => ({
  buildRecall: vi.fn(() => ({ text: "Recalled ... chat \"Harbour\": the harbour contract ...", notes: 0, conversations: 1, threadIds: ["topic-b"] })),
}));

type Task = { threadId: string; title?: string; resumeCursors?: Record<string, unknown>; engineSessions?: string[]; carriedThreads?: string[]; confidential?: boolean; forgetSessionsAtNextTurn?: true };

function hostWith(tasks: Task[], groups: Array<{ threadId: string; memberIds: string[]; tasks?: Task[] }> = [], busy: string[] = []) {
  const host = {
    threadBusy: (_botId: string, threadId: string) => busy.includes(threadId),
    DATA_DIR: "/data",
    TASK_WORKSPACES_DIR: "/data/task-workspaces",
    store: {
      groups,
      tasks: vi.fn(() => tasks),
      taskByThread: (_botId: string, threadId: string) => tasks.find((t) => t.threadId === threadId),
      // as server/store.ts noteCarriedThreads
      noteCarriedThreads: vi.fn((_botId: string, threadId: string, carried: Iterable<string>) => {
        const task = tasks.find((t) => t.threadId === threadId);
        if (!task) return;
        task.carriedThreads = [...new Set([...(task.carriedThreads ?? []), ...[...carried].filter((id) => id !== threadId)])];
      }),
      makeTaskConfidential: vi.fn((_botId: string, threadId: string) => {
        const task = tasks.find((t) => t.threadId === threadId)!;
        task.confidential = true;
      }),
      forgetEngineSessions: vi.fn((_botId: string, threadId: string) => {
        const task = tasks.find((t) => t.threadId === threadId);
        if (task) { task.resumeCursors = {}; delete task.engineSessions; delete task.carriedThreads; delete task.forgetSessionsAtNextTurn; }
        return [];
      }),
      markForgetSessionsAtNextTurn: vi.fn((_botId: string, threadId: string) => {
        const task = tasks.find((t) => t.threadId === threadId);
        if (task) task.forgetSessionsAtNextTurn = true;
      }),
    },
    routableSteers: { forgetThread: vi.fn() },
    memoryUpkeep: { dropThread: vi.fn() },
    scrubThreadDecisions: vi.fn(async () => undefined),
    reportBackgroundError: vi.fn(),
    forgetConfidentialCoordination: vi.fn(),
    releaseThreadEngines: vi.fn(),
    roomMemberContexts: { forgetSession: vi.fn() },
    cfg: {},
    autoRecallEnabled: () => true,
    semanticRecallEnabled: () => false,
    roomFeedsBot: () => true,
    privateRecallFilter: () => null,
    autoRecallLogLine: () => "recall",
    recordMastery: vi.fn(),
    achievementThreadPerson: () => "",
    threadEngineKeys: vi.fn((_botId: string, threadId: string) => [`key:${threadId}`]),
    threadKeys: vi.fn((threadId: string) => [`live:${threadId}`]),
    purgeConfidentialEngineKeys: vi.fn(),
    forgetThreadEngineSessions: (() => undefined) as (botId: string, threadIds: string | readonly string[], why: string) => void,
  };
  host.forgetThreadEngineSessions = createForgetThreadEngineSessions(() => host);
  return host;
}

describe("makeThreadConfidential (#4407)", () => {
  it("forgets, in one purge, the sessions of the bot's other conversations whose prompt carried it", () => {
    const tasks: Task[] = [
      { threadId: "topic-1", resumeCursors: { claude: "s-1" }, engineSessions: ["s-1"], carriedThreads: [] },
      // its "Earlier topics" block listed topic-1
      { threadId: "topic-2", resumeCursors: { claude: "s-2" }, engineSessions: ["s-2"], carriedThreads: ["topic-1", "x"] },
      // a session from before the record: unknown, so it counts
      { threadId: "older", resumeCursors: {}, engineSessions: ["s-old"] },
      // a session that never carried it keeps its history
      { threadId: "elsewhere", resumeCursors: { claude: "s-e" }, engineSessions: ["s-e"], carriedThreads: ["x"] },
      // carried it, but holds no session: nothing to forget
      { threadId: "never-ran", resumeCursors: {}, carriedThreads: ["topic-1"] },
    ];
    const host = hostWith(tasks);
    createMakeThreadConfidential(() => host)("bot-1", "topic-1");

    expect(host.store.makeTaskConfidential).toHaveBeenCalledWith("bot-1", "topic-1");
    const forgotten = host.store.forgetEngineSessions.mock.calls.map(([, threadId]) => threadId);
    expect(forgotten.sort()).toEqual(["older", "topic-1", "topic-2"]);
    expect(host.purgeConfidentialEngineKeys).toHaveBeenCalledTimes(1);
    const [keys, why, options] = host.purgeConfidentialEngineKeys.mock.calls[0]!;
    expect([...keys].sort()).toEqual(["key:older", "key:topic-1", "key:topic-2"]);
    expect(why).toBe("made confidential");
    expect([...options.live].sort()).toEqual(["live:older", "live:topic-1", "live:topic-2"]);
    for (const threadId of ["topic-1", "topic-2", "older"]) expect(host.releaseThreadEngines).toHaveBeenCalledWith(threadId);
    expect(host.releaseThreadEngines).not.toHaveBeenCalledWith("elsewhere");
    expect(tasks.find((t) => t.threadId === "elsewhere")!.resumeCursors).toEqual({ claude: "s-e" });
  });

  it("closes the idle engines of the rooms the bot is in, and only those", () => {
    const host = hostWith(
      [{ threadId: "topic-1", resumeCursors: { claude: "s-1" } }],
      [
        { threadId: "room-a", memberIds: ["bot-1", "bot-2"], tasks: [{ threadId: "room-a-task" }] },
        { threadId: "room-b", memberIds: ["bot-2"] },
      ],
    );
    createMakeThreadConfidential(() => host)("bot-1", "topic-1");
    const released = host.releaseThreadEngines.mock.calls.map(([threadId]) => threadId);
    expect(released).toEqual(expect.arrayContaining(["room-a", "room-a-task"]));
    expect(released).not.toContain("room-b");
  });

  it("forgets a session that only recalled the topic through automatic recall", () => {
    const tasks: Task[] = [
      { threadId: "topic-b", title: "Harbour", resumeCursors: { claude: "s-b" }, carriedThreads: [] },
      // its prompt never listed topic-b; automatic recall put its words in
      { threadId: "topic-c", title: "Other", resumeCursors: { claude: "s-c" }, engineSessions: ["s-c"], carriedThreads: [] },
    ];
    const host = hostWith(tasks);
    const bot = { id: "bot-1", name: "Ledger", threadId: "topic-c", tasks };
    const recalled = createAutoRecallPrompt(() => host)(bot, "topic-c", "where is the harbour contract", { conversations: true, userName: "Sam" });
    expect(recalled).toContain("harbour contract");
    expect(tasks[1]!.carriedThreads).toEqual(["topic-b"]);

    createMakeThreadConfidential(() => host)("bot-1", "topic-b");
    const forgotten = host.store.forgetEngineSessions.mock.calls.map(([, threadId]) => threadId);
    expect(forgotten.sort()).toEqual(["topic-b", "topic-c"]);
    expect(host.releaseThreadEngines).toHaveBeenCalledWith("topic-c");
  });

  it("starts the bot's next turn in each of its rooms on a new session, busy or idle", () => {
    const host = hostWith(
      [{ threadId: "topic-1", resumeCursors: { claude: "s-1" } }],
      [
        { threadId: "room-a", memberIds: ["bot-1", "bot-2"], tasks: [{ threadId: "room-a-task" }] },
        { threadId: "room-b", memberIds: ["bot-2"] },
      ],
    );
    createMakeThreadConfidential(() => host)("bot-1", "topic-1");
    const reset = host.roomMemberContexts.forgetSession.mock.calls;
    expect(reset).toEqual([["room-a", "bot-1"], ["room-a-task", "bot-1"]]);
  });

  it("forgets a carrier busy at the change again before its next turn, so that turn never reuses its session", () => {
    const tasks: Task[] = [
      { threadId: "topic-b", resumeCursors: { claude: "s-b" }, carriedThreads: [] },
      // a parallel task running a turn on a process whose history lists topic-b
      { threadId: "parallel", resumeCursors: { claude: "s-p" }, engineSessions: ["s-p"], carriedThreads: ["topic-b"] },
      // a routine run whose first turn has not announced its session yet
      { threadId: "routine-run", resumeCursors: {}, carriedThreads: ["topic-b"] },
      // busy, but never carried it: left alone
      { threadId: "other-busy", resumeCursors: { claude: "s-o" }, carriedThreads: ["x"] },
      // idle carrier: forgotten now, nothing left for its next turn
      { threadId: "idle", resumeCursors: { claude: "s-i" }, carriedThreads: ["topic-b"] },
    ];
    const host = hostWith(tasks, [], ["parallel", "routine-run", "other-busy"]);
    createMakeThreadConfidential(() => host)("bot-1", "topic-b");

    const forgotten = host.store.forgetEngineSessions.mock.calls.map(([, threadId]) => threadId);
    expect(forgotten.sort()).toEqual(["idle", "parallel", "routine-run", "topic-b"]);
    const marked = host.store.markForgetSessionsAtNextTurn.mock.calls.map(([, threadId]) => threadId);
    expect(marked.sort()).toEqual(["parallel", "routine-run"]);
    expect(tasks.find((t) => t.threadId === "parallel")!.forgetSessionsAtNextTurn).toBe(true);
    expect(tasks.find((t) => t.threadId === "idle")!.forgetSessionsAtNextTurn).toBeUndefined();
    expect(tasks.find((t) => t.threadId === "other-busy")!.forgetSessionsAtNextTurn).toBeUndefined();
  });

  it("still forgets one thread alone when called with its id", () => {
    const host = hostWith([{ threadId: "solo", resumeCursors: { claude: "s" } }]);
    host.forgetThreadEngineSessions("bot-1", "solo", "deleted");
    expect(host.store.forgetEngineSessions).toHaveBeenCalledWith("bot-1", "solo");
    expect(host.purgeConfidentialEngineKeys).toHaveBeenCalledWith(["key:solo"], "deleted", { live: ["live:solo"] });
  });
});
