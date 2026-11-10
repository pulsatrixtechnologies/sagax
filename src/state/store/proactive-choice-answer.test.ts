// #3457: the choice card's answer goes on its own route with the card's
// switches (`watches`, the watches kept on), so a switch the person turned
// off in the details is not turned on by the yes (server: ProactiveAsk.answer).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState, type Bot, type Message } from "./model";
import { reducer } from "./reducer";
import { dispatchSendEffects } from "./dispatch-send";
import type { DispatchEnv } from "./dispatch-types";

const calls: Array<{ path: string; body: unknown }> = [];
vi.mock("./api", () => ({
  api: vi.fn(async (path: string, init?: { body?: string }) => {
    calls.push({ path, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true };
  }),
}));

let state: AppState;

function env(): DispatchEnv {
  return {
    stateRef: { get current() { return state; } },
    rawDispatch: (action: Action) => { state = reducer(state, action); },
    showError: () => {},
    waitForExecutionSettings: async () => {},
    executionBotsBeforeAction: [],
    cardTarget: (action: { botId: string; messageId: string }) => {
      const host = state.bots.find((b) => b.id === action.botId);
      return { host, card: host?.messages.find((m) => m.id === action.messageId)?.card, inRoom: false };
    },
    persistCard: () => {},
    dispatch: (action: Action) => run(action),
  } as unknown as DispatchEnv;
}

function run(action: Action) {
  state = reducer(state, action);
  dispatchSendEffects(action, env());
}

const choice = {
  id: "c1", role: "bot", kind: "options", text: "", at: 1,
  card: {
    title: "Receive dispatch alerts?", subtitle: "", options: ["Yes", "Not now"], proactiveProposal: { id: "pp-1" },
    proactiveChoice: { domain: "dispatch", label: "Dispatch", botName: "Atlas", watches: [
      { id: "w-a", label: "A", cadence: "every hour", on: true, tools: [] },
      { id: "w-b", label: "B", cadence: "every hour", on: true, tools: [] },
    ] },
  },
} as unknown as Message;

function bot(): Bot {
  return {
    id: "a", threadId: "a-now", mainThreadId: "a-now", name: "Atlas", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, hasMore: false, messages: [choice],
    modelSelection: { instanceId: "x", model: "m" },
  } as Bot;
}

beforeEach(() => {
  calls.length = 0;
  state = { ...initialState, hydrated: true, bots: [bot()], selectedId: "a", activeView: "chat" } as AppState;
});

describe("the choice card's answer (#3457)", () => {
  it("a yes sends the switches the person kept on, never the one turned off", async () => {
    run({ type: "answerCard", botId: "a", threadId: "a-now", messageId: "c1", answer: "Yes", proactiveWatches: ["w-a"] } as Action);
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toEqual([{ path: "/api/bots/a/proactive/pp-1", body: { accept: true, watches: ["w-a"] } }]);
  });

  it("« Not now » declines and keeps nothing on", async () => {
    run({ type: "answerCard", botId: "a", threadId: "a-now", messageId: "c1", answer: "Not now", proactiveWatches: ["w-a", "w-b"] } as Action);
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toEqual([{ path: "/api/bots/a/proactive/pp-1", body: { accept: false } }]);
  });

  it("a proposal card without switches answers as before", async () => {
    run({ type: "answerCard", botId: "a", threadId: "a-now", messageId: "c1", answer: "Yes" } as Action);
    await new Promise((done) => setTimeout(done, 0));
    expect(calls).toEqual([{ path: "/api/bots/a/proactive/pp-1", body: { accept: true } }]);
  });
});
