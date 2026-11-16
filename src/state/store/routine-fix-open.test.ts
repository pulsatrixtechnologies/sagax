// #4438: "Open the routine" on a routine fix card really opens the
// routine's page. Both answer paths (the pinned card and Today answer
// through decideRequest, the chat's own card through answerCard) tell the
// server this device opens the place (`opens`), and the server's `open`
// in the reply brings up Routines on that routine. Never a note saying the
// page is open while nothing opened.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState, type Bot, type Message } from "./model";
import { reducer } from "./reducer";
import { dispatchSendEffects } from "./dispatch-send";
import type { DispatchEnv } from "./dispatch-types";

const sent: Array<{ path: string; body: Record<string, unknown> }> = [];
let reply: Record<string, unknown> = {};
vi.mock("./api", () => ({
  api: vi.fn(async (path: string, init?: { body?: string }) => {
    sent.push({ path, body: init?.body ? JSON.parse(init.body) as Record<string, unknown> : {} });
    return path.endsWith("/respond") ? reply : {};
  }),
}));

let state: AppState;
const dispatched: Action[] = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function env(): DispatchEnv {
  return {
    stateRef: { get current() { return state; } },
    rawDispatch: (action: Action) => { state = reducer(state, action); },
    showError: () => {},
    waitForExecutionSettings: async () => {},
    executionBotsBeforeAction: [],
    cardTarget: (action: { botId: string; messageId: string }) => {
      const host = state.bots.find((entry) => entry.id === action.botId);
      const card = host?.messages.find((message) => message.id === action.messageId)?.card;
      return { host, card, inRoom: false };
    },
    persistCard: () => {},
    dispatch: (action: Action) => {
      dispatched.push(action);
      state = reducer(state, action);
    },
  } as unknown as DispatchEnv;
}

function run(action: Action) {
  state = reducer(state, action);
  dispatchSendEffects(action, env());
}

const OPEN = "Open the routine";
function bot(): Bot {
  return {
    id: "a", threadId: "a-now", mainThreadId: "a-now", name: "a", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, hasMore: false,
    messages: [{
      id: "q1", role: "bot", kind: "options", text: "", at: 1,
      card: {
        requestId: "r1", requestType: "question", askKey: "routine-problem:rt-7", title: "", subtitle: "Mail triage needs a fix", options: [OPEN],
        questionRequest: { questions: [{ question: "Mail triage needs a fix", options: [{ label: OPEN }] }] },
      },
    } as unknown as Message],
    modelSelection: { instanceId: "x", model: "m" },
  } as Bot;
}

beforeEach(() => {
  sent.length = 0;
  dispatched.length = 0;
  reply = { ok: true, outcome: "answered", late: true, direct: true, open: { type: "open_routine", routineId: "rt-7", botId: "a" } };
  state = { ...initialState, hydrated: true, bots: [bot()], selectedId: "a", activeView: "chat" } as AppState;
});

const opened = () => dispatched.filter((action) => action.type === "showRoutines");

describe("Open the routine opens the routine's page (#4438)", () => {
  it("decideRequest (pinned card, Today): the body says this device opens, the reply opens Routines on it", async () => {
    run({ type: "decideRequest", threadId: "a-now", requestId: "r1", behavior: "answer", message: OPEN } as unknown as Action);
    await settle();
    await settle();
    const respond = sent.find((entry) => entry.path.endsWith("/respond"));
    expect(respond?.body).toMatchObject({ requestId: "r1", behavior: "answer", message: OPEN, opens: true });
    expect(opened()).toEqual([{ type: "showRoutines", routineId: "rt-7", botId: "a" }]);
    expect(state.activeView).toBe("routines");
  });

  it("answerCard (the chat's card): same body, same page", async () => {
    run({ type: "answerCard", botId: "a", messageId: "q1", answer: OPEN, threadId: "a-now" } as unknown as Action);
    await settle();
    await settle();
    const respond = sent.find((entry) => entry.path.endsWith("/respond"));
    expect(respond?.body).toMatchObject({ requestId: "r1", behavior: "answer", message: OPEN, opens: true });
    expect(opened()).toEqual([{ type: "showRoutines", routineId: "rt-7", botId: "a" }]);
  });

  it("a permission's answer never claims to open anything", async () => {
    reply = { ok: true };
    run({ type: "decideRequest", threadId: "a-now", requestId: "r1", behavior: "allow" } as unknown as Action);
    await settle();
    await settle();
    expect(sent.find((entry) => entry.path.endsWith("/respond"))?.body.opens).toBeUndefined();
    expect(opened()).toEqual([]);
  });
});
