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
import { setLocale } from "@/lib/i18n";
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
const wizard = (id: "back" | "next" | "submit") => host.querySelector<HTMLButtonElement>(`[data-wizard-action="${id}"]`);
const submit = () => wizard("submit")!;
const nextStep = () => act(() => wizard("next")!.click());
/** the answer of the open step with this label */
const option = (label: string) =>
  Array.from(host.querySelectorAll<HTMLButtonElement>("[data-ask-choice]")).find((button) => button.textContent?.includes(label))!;
const chips = () => Array.from(host.querySelectorAll<HTMLElement>("[data-wizard-chip]"));
const field = () => host.querySelector<HTMLTextAreaElement | HTMLInputElement>('[data-wizard-body] textarea, [data-wizard-body] input')!;
const durationInputs = () => Array.from(host.querySelectorAll<HTMLInputElement>('[data-wizard-body] input[type="number"]'));
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
  setLocale("en");
});

describe("a form card is answered one question at a time (#4910)", () => {
  it("shows the title, one line of context, a chip per question and one question", () => {
    mount(TIME);
    expect(host.textContent).toContain("Time entries to confirm (routine Evening timesheet)");
    expect(host.querySelector("[data-form-context]")?.textContent).toContain("Seven entries drafted");
    expect(chips().map((chip) => chip.textContent)).toEqual(["Standup", "Design review", "Ticket", "Call length", "Expense code", "Summary", "Backup check", "Review"]);
    // the question on top, its answers as a vertical list, nothing of the other six
    expect(host.querySelector("[data-wizard-body]")?.textContent).toContain(TIME[0]!.question);
    expect(host.querySelector("[data-wizard-body]")?.textContent).not.toContain(TIME[1]!.question);
    expect(host.textContent).toContain("Step 1 of 7");
    expect(wizard("back")).toBeNull();
    expect(wizard("next")!.disabled).toBe(true);
  });

  it("draws a numbered vertical list with Other, specify as its last row", () => {
    mount(TIME);
    const rows = Array.from(host.querySelectorAll<HTMLButtonElement>("[data-ask-choice]"));
    expect(rows.map((row) => row.getAttribute("aria-keyshortcuts"))).toEqual(["1", "2", "3", "4"]);
    expect(rows[3]!.textContent).toContain("Other, specify");
    expect(host.querySelector('[data-wizard-body="step"] [role="radiogroup"]')!.className).toContain("flex-col");
  });

  it("draws the right control per kind, one step each", () => {
    mount(TIME);
    act(() => option("Done").click());
    // a pick moves on by itself
    expect(durationInputs()).toHaveLength(2);
    setValue(durationInputs()[0]!, "1");
    nextStep();
    // a row in words is the answer field of every question card
    expect(host.querySelector("[data-wizard-body] textarea[data-question-field]")).not.toBeNull();
    setValue(field(), "4512");
    nextStep();
    expect(durationInputs()).toHaveLength(2);
    act(() => chips()[5]!.click());
    expect(option("Yes")).toBeTruthy();
    expect(option("No")).toBeTruthy();
    // a yes / no row has no Other
    expect(host.querySelectorAll("[data-ask-choice]")).toHaveLength(2);
  });

  it("marks an optional question", () => {
    mount(TIME);
    act(() => chips()[6]!.click());
    expect(host.querySelector("[data-wizard-body]")?.textContent).toMatch(/Optional/);
    expect(wizard("next")!.textContent).toBe("Skip");
    expect(wizard("next")!.disabled).toBe(false);
  });

  it("draws time, date, number, long text and multi", () => {
    setLocale("en");
    mount([
      { question: "Start", kind: "time", options: [] },
      { question: "Day", kind: "date", options: [] },
      { question: "Guests", kind: "number", options: [] },
      { question: "Notes", kind: "long_text", options: [] },
      { question: "Rooms", kind: "multi", multiSelect: true, options: [{ label: "North" }, { label: "South" }] },
    ]);
    const body = () => host.querySelector("[data-wizard-body]")!;
    expect(body().querySelector('input[type="time"]')).not.toBeNull();
    act(() => chips()[1]!.click());
    expect(body().querySelector('input[type="date"]')).not.toBeNull();
    expect(body().querySelector("[data-date-shown]")?.textContent).toBe("mm/dd/yyyy");
    act(() => chips()[2]!.click());
    expect(body().querySelector('input[type="number"]')).not.toBeNull();
    act(() => chips()[3]!.click());
    expect(body().querySelector("textarea")).not.toBeNull();
    act(() => chips()[4]!.click());
    expect(body().querySelectorAll('[role="checkbox"]')).toHaveLength(3);
  });

  it("shows a date in the interface language", () => {
    setLocale("fr");
    mount([{ question: "Jour", kind: "date", options: [] }]);
    expect(host.querySelector("[data-date-shown]")?.textContent).toBe("yyyy-mm-dd");
    setValue(host.querySelector("[data-wizard-body] input")! as HTMLInputElement, "2026-11-18");
    expect(host.querySelector("[data-date-shown]")?.textContent).toBe("2026-11-18");
  });

  it("walks the questions, reviews them, and sends only once every required one is answered, per row", () => {
    mount(TIME);
    act(() => option("Done").click());
    setValue(durationInputs()[0]!, "1");
    setValue(durationInputs()[1]!, "30");
    nextStep();
    setValue(field(), "4512");
    nextStep();
    setValue(durationInputs()[1]!, "45");
    nextStep();
    act(() => option("Travel").click());
    // the last required one is open: the review says what is missing and holds Submit
    act(() => chips()[7]!.click());
    expect(host.querySelector("[data-wizard-body]")?.textContent).toContain("Not answered");
    expect(submit().disabled).toBe(true);
    act(() => chips()[5]!.click());
    act(() => option("Yes").click());
    // the optional row stays empty
    act(() => chips()[7]!.click());
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
  it("keeps Next off for 0 h 0 min", () => {
    mount([{ question: "How long?", kind: "duration", options: [] }]);
    const next = () => wizard("next")!;
    setValue(durationInputs()[0]!, "0");
    setValue(durationInputs()[1]!, "0");
    expect(next().disabled).toBe(true);
    setValue(durationInputs()[1]!, "0.2");
    expect(next().disabled).toBe(true);
    setValue(durationInputs()[1]!, "15");
    expect(next().disabled).toBe(false);
    nextStep();
    expect(submit().disabled).toBe(false);
  });
});

describe("a row in words has no send of its own (#4490 second review)", () => {
  it("shows no arrow in a text or long text row: Next and the review's Submit send", () => {
    mount([{ question: "Ticket?", kind: "text", options: [] }, { question: "Notes", kind: "long_text", options: [] }]);
    setValue(field(), "4512");
    expect(host.querySelector("[data-wizard-body] button")).toBeNull();
    nextStep();
    setValue(field(), "All done");
    expect(host.querySelector("[data-wizard-body] button")).toBeNull();
    nextStep();
    expect(submit().disabled).toBe(false);
  });
});
