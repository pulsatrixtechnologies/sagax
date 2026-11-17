// @vitest-environment happy-dom
// #4490: a form card draws its rows with their controls (one question per
// control), a checklist draws a checkbox per item and its actions as
// buttons, the answer goes back per row, and the settled card shows what
// was answered per row, never only "Answer sent".
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { formatQuestionAnswers, questionAnswersByQuestion, type AskQuestion } from "../../shared/ask-question";
import { parseAskChoiceInput } from "../../shared/options-card";
import { GOOD_DRAFTS_CARD, GOOD_TIME_CARD } from "../../shared/card-rules.fixtures";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rowsOf(input: unknown): AskQuestion[] {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error("fixture does not parse");
  return parsed.value.questions;
}
const TIME = rowsOf(GOOD_TIME_CARD);
const DRAFTS = rowsOf(GOOD_DRAFTS_CARD);

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();
const decides = () => dispatch.mock.calls.map((call) => call[0]).filter((action) => action.type === "decideRequest");

function mount(questions: AskQuestion[], card: Record<string, unknown> = {}) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "Time entries to confirm (routine Evening timesheet)", subtitle: "Seven entries drafted from today's calendar. Confirm each one.", options: [], requestId: "req-1", questionRequest: { version: 1, questions }, ...card },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Nimbus" }, message }) })));
}

const formRow = (index: number) => host.querySelectorAll<HTMLElement>("[data-form-row]")[index]!;
const pill = (index: number, label: string) =>
  Array.from(formRow(index).querySelectorAll<HTMLButtonElement>("[data-form-choice]")).find((button) => button.textContent?.trim() === label)!;
const submit = () => host.querySelector<HTMLButtonElement>("[data-sheet-send]")!;
const action = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>("[data-sheet-send]")).find((button) => button.textContent?.trim() === label)!;

function setValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!;
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
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

describe("a form card draws a row per question with its control (#4490)", () => {
  it("shows the title, one line of context, and seven rows", () => {
    mount(TIME);
    expect(host.textContent).toContain("Time entries to confirm (routine Evening timesheet)");
    expect(host.querySelector("[data-form-context]")?.textContent).toContain("Seven entries drafted");
    expect(host.querySelectorAll("[data-form-row]")).toHaveLength(7);
  });

  it("draws the right control per kind", () => {
    mount(TIME);
    expect(formRow(0).querySelector('[role="radiogroup"]')).not.toBeNull();
    expect(formRow(0).querySelectorAll("[data-form-choice]")).toHaveLength(3);
    expect(formRow(1).querySelectorAll('input[type="number"]')).toHaveLength(2);
    // a row in words is the answer field of every question card
    expect(formRow(2).querySelector("textarea[data-question-field]")).not.toBeNull();
    expect(pill(5, "Yes")).toBeTruthy();
    expect(pill(5, "No")).toBeTruthy();
    expect(formRow(6).textContent).toMatch(/Optional/);
  });

  it("draws time, date, number, long text and multi", () => {
    mount([
      { question: "Start", kind: "time", options: [] },
      { question: "Day", kind: "date", options: [] },
      { question: "Guests", kind: "number", options: [] },
      { question: "Notes", kind: "long_text", options: [] },
      { question: "Rooms", kind: "multi", multiSelect: true, options: [{ label: "North" }, { label: "South" }] },
    ]);
    expect(formRow(0).querySelector('input[type="time"]')).not.toBeNull();
    expect(formRow(1).querySelector('input[type="date"]')).not.toBeNull();
    expect(formRow(2).querySelector('input[type="number"]')).not.toBeNull();
    expect(formRow(3).querySelector("textarea")).not.toBeNull();
    expect(formRow(4).querySelectorAll('[role="checkbox"]')).toHaveLength(2);
  });

  it("sends only once every required row is answered, per row", () => {
    mount(TIME);
    expect(submit().disabled).toBe(true);
    act(() => pill(0, "Done").click());
    const [hours, minutes] = Array.from(formRow(1).querySelectorAll<HTMLInputElement>('input[type="number"]'));
    setValue(hours!, "1");
    setValue(minutes!, "30");
    setValue(formRow(2).querySelector<HTMLTextAreaElement>("textarea")!, "4512");
    setValue(formRow(3).querySelectorAll<HTMLInputElement>('input[type="number"]')[1]!, "45");
    act(() => pill(4, "Travel").click());
    expect(submit().disabled).toBe(true);
    act(() => pill(5, "Yes").click());
    // the optional row stays empty
    expect(submit().disabled).toBe(false);
    act(() => submit().click());
    expect(decides()).toHaveLength(1);
    const answers = questionAnswersByQuestion(decides()[0]!.message, TIME);
    expect(answers[TIME[0]!.question]).toBe("Done");
    expect(answers[TIME[1]!.question]).toBe("90 min");
    expect(answers[TIME[2]!.question]).toBe("4512");
    expect(answers[TIME[3]!.question]).toBe("45 min");
    expect(answers[TIME[5]!.question]).toBe("yes");
    // the optional row left empty says so
    expect(answers[TIME[6]!.question]).toBe("(left empty)");
  });

  it("shows per row what was answered once settled", () => {
    const answer = formatQuestionAnswers(TIME, [["Done"], ["90 min"], ["4512"], ["45 min"], ["Travel"], ["yes"], ["(left empty)"]]);
    mount(TIME, { answered: "answer", answeredText: answer });
    expect(host.querySelector('[data-ask-card="settled"]')).not.toBeNull();
    expect(host.querySelectorAll("[data-form-row]")).toHaveLength(7);
    expect(formRow(0).querySelector("[data-form-answer]")?.textContent).toBe("Done");
    expect(formRow(1).querySelector("[data-form-answer]")?.textContent).toBe("1 h 30 min");
    expect(formRow(5).querySelector("[data-form-answer]")?.textContent).toBe("Yes");
    expect(formRow(6).querySelector("[data-form-answer]")?.textContent).toMatch(/Not answered/);
    expect(host.querySelector("[data-sheet-send]")).toBeNull();
  });
});

describe("a checklist draws a checkbox per item and its actions as buttons (#4490)", () => {
  it("draws six rows pre-checked as the bot proposed, and two buttons", () => {
    mount(DRAFTS, { title: "Posts to publish tonight (routine Evening posts)", subtitle: GOOD_DRAFTS_CARD.question });
    const boxes = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(boxes).toHaveLength(6);
    expect(Array.from(boxes).filter((box) => box.getAttribute("aria-checked") === "true")).toHaveLength(5);
    expect(host.textContent).toContain("Nimbus 2.4 is out");
    expect(action("Post selected")).toBeTruthy();
    expect(action("Skip tonight")).toBeTruthy();
    expect(host.querySelector("[data-form-list]")).not.toBeNull();
  });

  it("sends the checked items with the button pressed", () => {
    mount(DRAFTS, { subtitle: GOOD_DRAFTS_CARD.question });
    const first = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')[0]!;
    act(() => first.click());
    act(() => action("Post selected").click());
    const message = decides()[0]!.message as string;
    expect(message).toContain("Q: Action\nA: Post selected");
    const picked = questionAnswersByQuestion(message, DRAFTS)[DRAFTS[0]!.question]!;
    expect(picked).not.toContain("Release notes for Nimbus 2.4");
    expect(picked).toContain("Maintenance reminder");
  });

  it("sends a button with nothing checked", () => {
    mount(DRAFTS, { subtitle: GOOD_DRAFTS_CARD.question });
    act(() => action("Skip tonight").click());
    expect(decides()[0]!.message).toContain("Q: Action\nA: Skip tonight");
  });

  it("shows the checked items and the button pressed once settled", () => {
    const answer = formatQuestionAnswers(DRAFTS, [["Release notes for Nimbus 2.4", "Maintenance reminder"]], "Post selected");
    mount(DRAFTS, { answered: "answer", answeredText: answer, subtitle: GOOD_DRAFTS_CARD.question });
    const boxes = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]');
    expect(Array.from(boxes).filter((box) => box.getAttribute("aria-checked") === "true")).toHaveLength(2);
    expect(host.querySelector("[data-form-action-sent]")?.textContent).toContain("Post selected");
    expect(host.querySelector("[data-sheet-send]")).toBeNull();
  });
});

describe("a duration of zero is no answer (#4490 review)", () => {
  it("keeps the send off for 0 h 0 min", () => {
    mount([{ question: "How long?", kind: "duration", options: [] }]);
    const [hours, minutes] = Array.from(formRow(0).querySelectorAll<HTMLInputElement>('input[type="number"]'));
    setValue(hours!, "0");
    setValue(minutes!, "0");
    expect(submit().disabled).toBe(true);
    setValue(minutes!, "0.2");
    expect(submit().disabled).toBe(true);
    setValue(minutes!, "15");
    expect(submit().disabled).toBe(false);
  });
});
