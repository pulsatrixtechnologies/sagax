// @vitest-environment happy-dom
// No way to skip a waiting question (JC #885, 2026-10-21), and the error
// shown when an answer does not reach the bot.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import type { AskQuestion } from "../../shared/ask-question";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const plan: AskQuestion = { question: "Which plan should the workspace use?", options: [{ label: "Free" }, { label: "Pro" }] };
const name: AskQuestion = { question: "What should the repository be called?", options: [] };

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();

function mount(questions: AskQuestion[]) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "q", subtitle: questions[0]!.question, options: [], requestId: "req-1", questionRequest: { version: 1, questions } },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Dev" }, message }) })));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  dispatch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("QuestionCard has no skip", () => {
  it("offers no X, Ignore or countdown, and never answers by itself", () => {
    mount([plan]);
    expect(host.querySelector("button[aria-label]")).toBeNull();
    expect(host.textContent).not.toMatch(/Ignore|closes automatically/);
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(dispatch).not.toHaveBeenCalled();
    expect(host.querySelector('[data-ask-card="pending"]')).not.toBeNull();
  });

  it("stays open under a half typed answer", () => {
    mount([name]);
    const field = host.querySelector("textarea")!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    act(() => { setter.call(field, "my-repo"); field.dispatchEvent(new Event("input", { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(600_000); });
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("QuestionCard answer error", () => {
  it("says the answer did not go through, and brings the choices back", () => {
    mount([plan]);
    const pro = Array.from(host.querySelectorAll<HTMLElement>("[data-ask-choice]")).find((el) => el.textContent?.includes("Pro"))!;
    act(() => pro.click());
    const { onError } = dispatch.mock.calls[0]![0] as { onError: () => void };
    expect(host.querySelector('[role="alert"]')).toBeNull();
    act(() => onError());
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Your answer didn't go through. Check your connection and try again.");
    expect(host.querySelector('[data-ask-card="pending"]')).not.toBeNull();
    // choosing again clears it
    const again = Array.from(host.querySelectorAll<HTMLElement>("[data-ask-choice]")).find((el) => el.textContent?.includes("Free"))!;
    act(() => again.click());
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });
});
