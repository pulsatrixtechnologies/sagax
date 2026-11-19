// @vitest-environment happy-dom
// #4910: the form wizard: follow-ups under their answer (and an old card
// without the link), the keyboard (1-9, Enter, Esc), the review, the Other
// row, and the same component inline and pinned.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { questionAnswersByQuestion, type AskQuestion } from "../../shared/ask-question";
import { parseAskChoiceInput } from "../../shared/options-card";
import { setLocale } from "@/lib/i18n";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rowsOf(linked: boolean): AskQuestion[] {
  const link = (when: Record<string, string>) => (linked ? { when } : {});
  const parsed = parseAskChoiceInput({
    question: "Three entries.",
    questions: [
      { question: "Design review: how long?", header: "Duration", kind: "choice", options: ["As scheduled", "Enter it", "Do not bill"], details: ["Calendar length", "Type it below", "No entry"] },
      { question: "Real length", kind: "duration", optional: true, ...link({ question: "Duration", option: "Enter it" }) },
      { question: "Migration call: which ticket?", header: "Ticket", kind: "choice", options: ["The usual one", "Enter a ticket"] },
      { question: "Ticket number", kind: "text", optional: true, ...link({ question: "Ticket", option: "Enter a ticket" }) },
      { question: "Taxi receipt: expense code", header: "Expense", kind: "choice", options: ["Travel", "Meals", "Office"] },
      { question: "Note for accounting", kind: "long_text", optional: true, ...link({ question: "Expense", option: "Office" }) },
    ],
  });
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error("fixture does not parse");
  return parsed.value.questions;
}

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();
const decides = () => dispatch.mock.calls.map((call) => call[0]).filter((action) => action.type === "decideRequest");

function mount(questions: AskQuestion[], props: { embedded?: boolean; onCollapse?: () => void } = {}) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "Time for November 16", subtitle: "Three entries.", options: [], requestId: "req-1", questionRequest: { version: 1, questions } },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Nimbus" }, message, ...props }) })));
}

const wizard = (id: "back" | "next" | "submit") => host.querySelector<HTMLButtonElement>(`[data-wizard-action="${id}"]`);
const body = () => host.querySelector<HTMLElement>("[data-wizard-body]")!;
const option = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-ask-choice]")).find((button) => button.textContent?.includes(label))!;
const chips = () => Array.from(host.querySelectorAll<HTMLElement>("[data-wizard-chip]"));
const sheet = () => host.querySelector<HTMLElement>("[data-question-sheet]")!;
const press = (key: string, target: Element = body()) => act(() => { target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  setLocale("en");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  dispatch.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a follow-up shows only under the answer that needs it", () => {
  it("is not on screen until its answer is picked, then hangs right under that answer", () => {
    mount(rowsOf(true));
    expect(host.querySelector("[data-form-followup]")).toBeNull();
    expect(host.textContent).not.toContain("Real length");
    act(() => option("As scheduled").click());
    // a pick without a follow-up moves on to the next question
    expect(body().textContent).toContain("Migration call: which ticket?");
    act(() => chips()[0]!.click());
    act(() => option("Enter it").click());
    // it stays on its step: the follow-up opened under "Enter it"
    expect(body().textContent).toContain("Design review: how long?");
    const followUp = host.querySelector<HTMLElement>("[data-form-followup]")!;
    expect(followUp.textContent).toContain("Real length");
    expect(followUp.previousElementSibling).toBe(option("Enter it"));
    expect(followUp.querySelectorAll('input[type="number"]')).toHaveLength(2);
    // another answer takes it away again
    act(() => option("Do not bill").click());
    expect(host.textContent).not.toContain("Real length");
  });

  it("leaves a hidden follow-up out of the answer, and sends a shown one", () => {
    mount(rowsOf(true));
    act(() => option("Enter it").click());
    const hours = host.querySelector<HTMLInputElement>('[data-form-followup] input[type="number"]')!;
    setValue(hours, "2");
    act(() => wizard("next")!.click());
    act(() => option("The usual one").click());
    act(() => option("Travel").click());
    expect(body().dataset.wizardBody).toBe("review");
    act(() => wizard("submit")!.click());
    const answers = questionAnswersByQuestion(decides()[0]!.message, rowsOf(true));
    expect(answers["Real length"]).toBe("120 min");
    // the ticket and note follow-ups were never asked: no line at all
    expect(answers["Ticket number"]).toBeUndefined();
    expect(answers["Note for accounting"]).toBeUndefined();
    expect(answers["Design review: how long?"]).toBe("Enter it");
  });

  it("counts a shown required follow-up as owed", () => {
    const questions = rowsOf(true).map((row) => (row.question === "Real length" ? { ...row, optional: undefined } : row)) as AskQuestion[];
    mount(questions);
    act(() => option("Enter it").click());
    expect(wizard("next")!.disabled).toBe(true);
    const hours = host.querySelector<HTMLInputElement>('[data-form-followup] input[type="number"]')!;
    setValue(hours, "1");
    expect(wizard("next")!.disabled).toBe(false);
  });
});

describe("an old card with no link still renders", () => {
  it("hangs an optional text row under the choice before it, always shown, never its own step", () => {
    mount(rowsOf(false));
    // an optional duration is not text: it stays a step of its own
    expect(chips().map((chip) => chip.textContent)).toEqual(["Duration", "Question 2", "Ticket", "Expense", "Review"]);
    expect(host.querySelector("[data-form-followup]")).toBeNull();
    act(() => chips()[2]!.click());
    const shown = host.querySelector<HTMLElement>("[data-form-followup='after']")!;
    expect(shown.textContent).toContain("Ticket number");
    expect(shown.textContent).toContain("Optional");
    // a pick does not move on: the follow-up is still on this step
    act(() => option("The usual one").click());
    expect(body().textContent).toContain("Ticket number");
  });

  it("sends what an old card always sent: every row, an empty optional one as left empty", () => {
    mount(rowsOf(false));
    act(() => option("As scheduled").click());
    act(() => chips()[1]!.click());
    const hours = host.querySelector<HTMLInputElement>('[data-wizard-body] input[type="number"]')!;
    setValue(hours, "1");
    act(() => chips()[2]!.click());
    act(() => option("The usual one").click());
    act(() => wizard("next")!.click());
    act(() => option("Travel").click());
    act(() => wizard("next")!.click());
    act(() => wizard("submit")!.click());
    const answers = questionAnswersByQuestion(decides()[0]!.message, rowsOf(false));
    expect(answers["Ticket number"]).toBe("(left empty)");
    expect(answers["Note for accounting"]).toBe("(left empty)");
  });
});

describe("the keyboard", () => {
  it("picks the numbered answer, and Enter continues once the question is answered", () => {
    mount(rowsOf(true));
    press("3");
    expect(body().textContent).toContain("Migration call: which ticket?");
    press("2");
    // "Enter a ticket" opened its field: still on the step
    expect(body().textContent).toContain("Ticket number");
    act(() => chips()[0]!.click());
    expect(option("Do not bill").getAttribute("aria-checked")).toBe("true");
    press("Enter");
    expect(body().textContent).toContain("Migration call");
    press("9");
    expect(body().textContent).toContain("Migration call");
  });

  it("does not take a digit typed into a field", () => {
    mount(rowsOf(true));
    act(() => option("Enter it").click());
    const hours = host.querySelector<HTMLInputElement>('[data-form-followup] input[type="number"]')!;
    press("1", hours);
    expect(option("Enter it").getAttribute("aria-checked")).toBe("true");
  });

  it("folds the pinned card on Escape, or hands the focus back inline", () => {
    const collapse = vi.fn();
    mount(rowsOf(true), { embedded: true, onCollapse: collapse });
    press("Escape");
    expect(collapse).toHaveBeenCalledTimes(1);
    mount(rowsOf(true));
    expect(() => press("Escape")).not.toThrow();
    expect(collapse).toHaveBeenCalledTimes(1);
  });
});

describe("the review and the Other row", () => {
  it("lists every answer, jumps back on a click, and sends from the last step", () => {
    mount(rowsOf(true));
    act(() => option("Do not bill").click());
    act(() => option("The usual one").click());
    act(() => option("Meals").click());
    expect(body().dataset.wizardBody).toBe("review");
    const lines = Array.from(host.querySelectorAll<HTMLElement>("[data-review-row]")).map((row) => row.textContent);
    expect(lines).toEqual(["Design review: how long?Do not bill", "Migration call: which ticket?The usual one", "Taxi receipt: expense codeMeals"]);
    act(() => host.querySelector<HTMLElement>("[data-review-row]")!.click());
    expect(body().dataset.wizardBody).toBe("step");
    expect(wizard("back")).toBeNull();
    act(() => chips()[3]!.click());
    expect(wizard("back")!.textContent).toBe("Back");
    act(() => wizard("submit")!.click());
    expect(decides()).toHaveLength(1);
  });

  it("answers in the person's own words from the Other row, inside the list", () => {
    mount(rowsOf(true));
    act(() => option("Other, specify").click());
    expect(option("Other, specify").getAttribute("aria-checked")).toBe("true");
    const own = host.querySelector<HTMLTextAreaElement>("[data-form-other] textarea")!;
    expect(wizard("next")!.disabled).toBe(true);
    setValue(own, "Half an hour");
    expect(wizard("next")!.disabled).toBe(false);
    act(() => option("As scheduled").click());
    // a single pick replaces the typed answer
    expect(host.querySelector("[data-form-other]")).toBeNull();
  });

  it("is the same card inline and pinned", () => {
    mount(rowsOf(true), { embedded: true });
    expect(chips()).toHaveLength(4);
    expect(host.querySelector("[data-wizard-body]")).not.toBeNull();
    expect(sheet().className).not.toContain("rounded-2xl");
  });
});
