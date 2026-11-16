// @vitest-environment happy-dom
// #4468: an answer of their own ("Other", or a question with nothing to
// pick) sends from its field: Enter and the arrow both work as soon as the
// field holds text. In a set, the field's Enter and arrow answer that
// question and move on to the next one still owed, the way a pick does; the
// last one sends the set. Never a dead Enter or a greyed arrow that only
// comes back after switching tabs.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import type { AskQuestion } from "../../shared/ask-question";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan: AskQuestion = { question: "Which plan?", header: "Plan", options: [{ label: "Free" }, { label: "Pro" }] };
const region: AskQuestion = { question: "Which region?", header: "Region", options: [{ label: "East" }, { label: "West" }] };
const name: AskQuestion = { question: "What should the repository be called?", header: "Name", options: [] };
const owner: AskQuestion = { question: "Who owns it?", header: "Owner", options: [] };

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();
const decides = () => dispatch.mock.calls.map((call) => call[0]).filter((action) => action.type === "decideRequest");

function mount(questions: AskQuestion[]) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "Your bot has a question", subtitle: questions[0]!.question, options: [], requestId: "req-1", questionRequest: { version: 1, questions } },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Dev" }, message }) })));
}

const row = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("[data-ask-choice]")).find((element) => element.textContent?.trim().slice(1) === label)!;
const tab = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find((element) => element.textContent?.trim() === label)!;
const field = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
const arrow = () => field().parentElement!.querySelector<HTMLButtonElement>("button")!;
const selectedTab = () => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim();

function type(value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  act(() => {
    setter.call(field(), value);
    field().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function enter() {
  act(() => {
    field().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  dispatch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("an answer of their own sends from its field (#4468)", () => {
  it("one question with options: Other, type, Enter sends", () => {
    mount([plan]);
    act(() => row("Other").click());
    type("Enterprise");
    enter();
    expect(decides()).toHaveLength(1);
    expect(decides()[0]!.message).toContain("A: Enterprise");
  });

  it("one question with options: the arrow is live as soon as there is text, and sends on click", () => {
    mount([plan]);
    act(() => row("Other").click());
    type("Enterprise");
    expect(arrow().disabled).toBe(false);
    act(() => arrow().click());
    expect(decides()).toHaveLength(1);
    expect(decides()[0]!.message).toContain("A: Enterprise");
  });

  it("a set: Other on the first question, the arrow is live, Enter moves on, and the last answer sends the set", () => {
    mount([plan, region]);
    act(() => row("Other").click());
    type("Enterprise");
    // never a greyed arrow next to an answer in words
    expect(arrow().disabled).toBe(false);
    enter();
    // answered and moved on to the question still owed, nothing sent yet
    expect(decides()).toHaveLength(0);
    expect(selectedTab()).toBe("Region");
    expect(host.textContent).toContain("1 of 2 answered");
    act(() => row("Other").click());
    type("North");
    enter();
    expect(decides()).toHaveLength(1);
    expect(decides()[0]!.message).toContain("Enterprise");
    expect(decides()[0]!.message).toContain("North");
  });

  it("a set: the arrow on the first question's own answer moves on, the same as Enter", () => {
    mount([plan, region]);
    act(() => row("Other").click());
    type("Enterprise");
    act(() => arrow().click());
    expect(decides()).toHaveLength(0);
    expect(selectedTab()).toBe("Region");
    act(() => row("East").click());
    act(() => Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "Submit answers")!.click());
    expect(decides()).toHaveLength(1);
    expect(decides()[0]!.message).toContain("Enterprise");
    expect(decides()[0]!.message).toContain("East");
  });

  it("a set answered elsewhere first: Enter on the last question owed sends at once, no tab switch", () => {
    mount([plan, region]);
    act(() => tab("Region").click());
    act(() => row("West").click());
    expect(selectedTab()).toBe("Plan");
    act(() => row("Other").click());
    type("Enterprise");
    enter();
    expect(decides()).toHaveLength(1);
  });

  it("a set of questions in words only: Enter answers each in turn and the last sends", () => {
    mount([name, owner]);
    type("omb-preview");
    expect(arrow().disabled).toBe(false);
    enter();
    expect(decides()).toHaveLength(0);
    expect(selectedTab()).toBe("Owner");
    type("Ops");
    enter();
    expect(decides()).toHaveLength(1);
    expect(decides()[0]!.message).toContain("omb-preview");
    expect(decides()[0]!.message).toContain("Ops");
  });

  it("a card in words only: Enter sends, the arrow too", () => {
    mount([name]);
    type("omb-preview");
    expect(arrow().disabled).toBe(false);
    act(() => arrow().click());
    expect(decides()).toHaveLength(1);
  });
});
