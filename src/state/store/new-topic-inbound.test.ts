// #2312 (JC 2026-11-06): after New topic, a routine's report, a bot-to-bot
// message or a bot's notice landed in the previous topic, under the empty
// view: the sidebar showed it, the topic on screen did not. The server
// delivers what arrives to the bot's newest segment (shared/single-stream.ts),
// so New topic must make that segment on the server at once.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationThreadId } from "../../../shared/single-stream";
import { resetFreshTopicMemory, startedByNewChat } from "@/lib/fresh-topic";
import { initialState, startNewTopic, type Action, type AppState, type Bot, type Message } from "./model";
import { reducer } from "./reducer";
import { dispatchSendEffects } from "./dispatch-send";
import type { DispatchEnv } from "./dispatch-types";

const apiCalls: Array<{ path: string; method?: string }> = [];
let created: Bot;
vi.mock("./api", () => ({
  api: vi.fn(async (path: string, init?: RequestInit) => {
    apiCalls.push({ path, method: init?.method });
    if (path === "/api/bots/a/tasks" && init?.method === "POST") return { bot: created, task: { threadId: created.threadId } };
    return {};
  }),
}));

const NOW = 1_000_000_000;

function oldBot(): Bot {
  return {
    id: "a", threadId: "a-now", mainThreadId: "a-now", name: "a", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, hasMore: false,
    messages: [{ id: "m1", role: "bot", kind: "text", text: "old answer", at: NOW - 10_000 } as Message],
    modelSelection: { instanceId: "x", model: "m" },
    tasks: [
      { threadId: "a-first", title: "First", createdAt: NOW - 30_000, updatedAt: NOW - 29_000 },
      { threadId: "a-now", title: "Now", createdAt: NOW - 20_000, updatedAt: NOW - 10_000 },
    ],
  } as Bot;
}

let state: AppState;
const stateRef = { get current() { return state; } };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function env(): DispatchEnv {
  const freshTopicsCreating = new Map<string, Promise<string>>();
  const self = {
    stateRef,
    rawDispatch: (action: Action) => { state = reducer(state, action); },
    botPatchQueue: { enqueue: () => {}, flush: async () => null, cancel: () => {} },
    threadPages: { get: () => undefined, set: () => {}, delete: () => {} },
    withTaskWrites: (bot: unknown) => bot,
    showThreadsRef: { current: false },
    taskWrites: new Map(),
    navigation: new Map<string, number>(),
    freshTopicsCreating,
    shared: { selectionRevision: 0, creatingBot: false },
    olderPagesInFlight: new Set<string>(),
    showError: (error: unknown) => { throw error; },
    dispatch: (action: Action) => run(action),
    freshSendBefore: false,
  } as unknown as DispatchEnv;
  return self;
}

let dispatchEnv: DispatchEnv;
const dispatched: Action[] = [];
function run(action: Action) {
  dispatched.push(action);
  state = reducer(state, action);
  dispatchSendEffects(action, dispatchEnv);
}

beforeEach(() => {
  resetFreshTopicMemory();
  apiCalls.length = 0;
  dispatched.length = 0;
  const now = oldBot();
  created = {
    ...now, threadId: "a-new", mainThreadId: "a-new", messages: [],
    tasks: [...now.tasks!, { threadId: "a-new", title: "", createdAt: NOW }],
  } as Bot;
  state = { ...initialState, hydrated: true, bots: [now], selectedId: "a", activeView: "chat" } as AppState;
  dispatchEnv = env();
});
afterEach(() => resetFreshTopicMemory());

describe("New topic receives what arrives (#2312)", () => {
  it("is made on the server at once, so a routine's report lands in the topic on screen", async () => {
    startNewTopic(run, state.bots[0]!);
    await settle();
    await settle();

    expect(apiCalls.filter((call) => call.method === "POST" && call.path === "/api/bots/a/tasks")).toHaveLength(1);
    const a = state.bots[0]!;
    // the topic on screen is the new one, no draft hiding it
    expect(a.threadId).toBe("a-new");
    expect(state.freshTopic.a).toBeUndefined();
    expect(startedByNewChat("a-new")).toBe(true);
    // where the server delivers a routine's report or a peer's message
    expect(conversationThreadId(a.tasks)).toBe("a-new");

    // a routine's report (or a bot-to-bot message) arriving there is shown live
    run({ type: "messageAdded", threadId: "a-new", botId: "a", message: { id: "r1", role: "bot", kind: "text", text: "routine report", at: NOW + 1 } } as unknown as Action);
    expect(state.bots[0]!.messages.map((message) => message.id)).toContain("r1");
  });

  it("Back before the server answered drops the empty topic and stays on the previous one", async () => {
    startNewTopic(run, state.bots[0]!);
    run({ type: "freshTopic", botId: "a", threadId: null });
    await settle();
    await settle();
    expect(state.bots[0]!.threadId).toBe("a-now");
    expect(state.freshTopic.a).toBeUndefined();
    expect(dispatched).toContainEqual({ type: "deleteTask", botId: "a", threadId: "a-new" });
  });
});
