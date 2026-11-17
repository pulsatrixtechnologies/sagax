// @vitest-environment happy-dom
// #4489 and #4519: a choice on the bot's own card resumes its turn, so the
// working line comes on at the click. A routine fix card's choice (Open the
// routine, Run a check, Pause) is the server's own card: it starts no turn,
// so the bot must never be left "working".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { initialState, type Action, type AppState, type Bot } from "@/state/store/model";
import { reducer } from "@/state/store/reducer";
import type { AskQuestion } from "../../shared/ask-question";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPEN = "Open the routine";
const fix: AskQuestion = { question: "Mail triage needs a fix", options: [{ label: OPEN }, { label: "Pause" }] };
const plan: AskQuestion = { question: "Which plan?", options: [{ label: "Free" }, { label: "Pro" }] };

let host: HTMLDivElement;
let root: Root;
let state: AppState;
const dispatch = vi.fn((action: Action) => { state = reducer(state, action); });

function card(question: AskQuestion, askKey?: string): Message {
  return {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "", subtitle: question.question, options: [], requestId: "req-1", ...(askKey ? { askKey } : {}), questionRequest: { version: 1, questions: [question] } },
  } as unknown as Message;
}

function mount(message: Message) {
  const bot = {
    id: "a", threadId: "t1", mainThreadId: "t1", name: "Dev", title: "", description: "", color: "green",
    notifications: true, unread: false, busy: false, activity: "idle", hasMore: false,
    messages: [message], modelSelection: { instanceId: "x", model: "m" },
  } as unknown as Bot;
  state = { ...initialState, hydrated: true, bots: [bot], selectedId: "a", activeView: "chat" } as AppState;
  const store = { state, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Dev" }, message }) })));
}

const pick = (label: string) => Array.from(host.querySelectorAll("button")).find((element) => {
  const text = element.textContent?.trim() ?? "";
  return text === label || (element.hasAttribute("data-ask-choice") && text.slice(1) === label);
})!;
const activity = () => state.bots[0]!.activity;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  dispatch.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a choice and the working line", () => {
  it("leaves the bot not working after a routine fix card's choice", () => {
    mount(card(fix, "routine-problem:rt-7"));
    act(() => pick(OPEN).click());
    const decide = dispatch.mock.calls.map((call) => call[0]).find((action) => action.type === "decideRequest");
    expect(decide).toBeDefined();
    expect(decide).not.toHaveProperty("resumes");
    expect(activity()).not.toBe("working");
    expect(state.bots[0]!.messages[0]!.card?.answered).toBe("answer");
  });

  it("shows the bot working at the click on its own card's choice", () => {
    mount(card(plan));
    act(() => pick("Pro").click());
    expect(dispatch.mock.calls.map((call) => call[0]).find((action) => action.type === "decideRequest")).toMatchObject({ resumes: true });
    expect(activity()).toBe("working");
  });

  it("leaves the bot not working when a fix card's choice is answered from the chat card", () => {
    mount(card(fix, "routine-problem:rt-7"));
    state = reducer(state, { type: "answerCard", botId: "a", messageId: "m1", answer: OPEN, threadId: "t1" } as Action);
    expect(activity()).not.toBe("working");
  });

  it("puts the turn back to waiting when the answer never reached the server", () => {
    mount(card(plan));
    state = reducer(state, { type: "decideRequest", threadId: "t1", requestId: "req-1", behavior: "allow", settle: { answered: "allow" }, resumes: true } as Action);
    expect(activity()).toBe("working");
    state = reducer(state, { type: "decideFailed", threadId: "t1", requestId: "req-1", settle: { answered: undefined }, resumes: true } as Action);
    expect(activity()).toBe("waiting-on-you");
    expect(state.bots[0]!.messages[0]!.card?.answered).toBeUndefined();
  });
});
