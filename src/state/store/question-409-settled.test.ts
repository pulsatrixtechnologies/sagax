// A question card answered here while someone else had already settled it
// (409 team_memory_settled): the card was settled optimistically with the
// local answer, which never reached the bot. The settled patch must clear that
// answer, through the real reducer, or the card reads it as answered and an
// entry that is gone never reads "Closed without an answer".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState, type Bot, type Message } from "./model";
import { reducer } from "./reducer";
import { dispatchSendEffects } from "./dispatch-send";
import type { DispatchEnv } from "./dispatch-types";

let refusal: Record<string, unknown> = {};
vi.mock("./api", () => ({
  api: vi.fn(async (path: string) => {
    if (path.endsWith("/respond")) throw Object.assign(new Error("settled"), { status: 409, body: refusal });
    return {};
  }),
}));

let state: AppState;
const shown: unknown[] = [];
const errors: Array<{ message: string; settledElsewhere?: boolean }> = [];
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function env(): DispatchEnv {
  return {
    stateRef: { get current() { return state; } },
    rawDispatch: (action: Action) => { state = reducer(state, action); },
    showError: (error: unknown) => { shown.push(error); },
    waitForExecutionSettings: async () => {},
    executionBotsBeforeAction: [],
    dispatch: (action: Action) => run(action),
  } as unknown as DispatchEnv;
}

function run(action: Action) {
  state = reducer(state, action);
  dispatchSendEffects(action, env());
}

function bot(): Bot {
  return {
    id: "a", threadId: "a-now", mainThreadId: "a-now", name: "a", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, hasMore: false,
    messages: [{ id: "q1", role: "bot", kind: "card", text: "", at: 1, card: { requestId: "r1", options: [] } } as unknown as Message],
    modelSelection: { instanceId: "x", model: "m" },
  } as Bot;
}

const card = () => state.bots[0]!.messages.find((m) => m.id === "q1")!.card!;

/** What QuestionCard shows once settled (src/components/QuestionCard.tsx). */
function shownOnCard() {
  const c = card();
  const answer = c.answeredText ?? null;
  return { answer, closed: !answer && Boolean(c.answered) && c.answered !== "answer" };
}

async function answerLocally() {
  // QuestionCard settles the card at once with the local answer...
  run({ type: "cardSettled", threadId: "a-now", requestId: "r1", patch: { answered: "answer", answeredText: "Oui" } } as Action);
  expect(card().answeredText).toBe("Oui");
  // ...then sends it; the server answers 409.
  run({
    type: "decideRequest", threadId: "a-now", requestId: "r1", behavior: "answer", message: "Oui",
    onError: (message: string, settledElsewhere?: boolean) => errors.push({ message, settledElsewhere }),
  } as unknown as Action);
  await settle();
  await settle();
}

beforeEach(() => {
  shown.length = 0;
  errors.length = 0;
  state = { ...initialState, hydrated: true, bots: [bot()], selectedId: "a", activeView: "chat" } as AppState;
});
afterEach(() => { refusal = {}; });

describe("question card settled elsewhere (409)", () => {
  it("accepted or declined elsewhere: the real outcome, never the answer that was not delivered", async () => {
    for (const [outcome, answered] of [["allowed-once", "allow"], ["rejected", "deny"]] as const) {
      state = { ...state, bots: [bot()] };
      refusal = { code: "team_memory_settled", outcome, settledBy: "Dana" };
      await answerLocally();
      expect(card().answered).toBe(answered);
      expect(card().answeredText).toBeUndefined();
      expect(shownOnCard()).toEqual({ answer: null, closed: true });
      expect(errors.at(-1)?.settledElsewhere).toBe(true);
    }
  });

  it("gone: the card reads closed without an answer", async () => {
    refusal = { code: "team_memory_settled", outcome: "unavailable" };
    await answerLocally();
    expect(card()).toMatchObject({ answered: "unavailable", dismissed: true });
    expect(card().answeredText).toBeUndefined();
    expect(shownOnCard()).toEqual({ answer: null, closed: true });
  });
});
