// @vitest-environment happy-dom
// #4585: a form card is one row per question: the question at the left, its
// control at the right of the same row; the wrap rule, the single question
// card, keyboard order and an answered row.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BotEditorStore, type Message, type useStore } from "@/state/store";
import { formatQuestionAnswers, type AskQuestion } from "../../shared/ask-question";
import { parseAskChoiceInput } from "../../shared/options-card";
import { GOOD_TIME_CARD } from "../../shared/card-rules.fixtures";
import { QuestionCard } from "./QuestionCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function rowsOf(input: unknown): AskQuestion[] {
  const parsed = parseAskChoiceInput(input);
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error("fixture does not parse");
  return parsed.value.questions;
}
const TIME = rowsOf(GOOD_TIME_CARD);

let host: HTMLDivElement;
let root: Root;
const dispatch = vi.fn();

function mount(questions: AskQuestion[], card: Record<string, unknown> = {}) {
  const message = {
    id: "m1", role: "bot", kind: "options", at: 1,
    card: { title: "Time entries to confirm (routine Evening timesheet)", subtitle: "Seven entries drafted from today's calendar. Confirm each one.", options: [], requestId: "req-1", questionRequest: { version: 1, questions }, ...card },
  } as unknown as Message;
  const store = { state: {}, dispatch } as unknown as ReturnType<typeof useStore>;
  act(() => root.render(createElement(BotEditorStore, { value: store, children: createElement(QuestionCard, { threadId: "t1", bot: { name: "Nimbus" }, message }) })));
}

const formRow = (index: number) => host.querySelectorAll<HTMLElement>("[data-form-row]")[index]!;

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

const control = (index: number) => formRow(index).querySelector<HTMLElement>("[data-form-control]")!;
const six = ["One", "Two", "Three", "Four", "Five", "Six"].map((label) => ({ label }));

describe("a form row: the question at the left, its control at the right (#4585)", () => {
  it("names a layout per kind", () => {
    mount([
      ...TIME,
      { question: "Notes", kind: "long_text", options: [] },
      { question: "Rooms", kind: "multi", multiSelect: true, options: [{ label: "N" }, { label: "S" }] },
    ]);
    const shapes = Array.from(host.querySelectorAll<HTMLElement>("[data-form-row]")).map((row) => row.dataset.formShape);
    expect(shapes).toEqual(["pills", "fields", "text", "fields", "pills", "pills", "pills", "area", "pills"]);
  });

  it("puts the question first and its control second on the same flex row, one height", () => {
    mount(TIME);
    for (const index of [0, 1, 5]) {
      const row = formRow(index);
      expect(row.className).toContain("flex-wrap");
      expect(row.className).toContain("items-center");
      expect(row.className).toContain("min-h-[54px]");
      expect(row.children[0]!.id).toMatch(/-row-/);
      expect(row.children[1]).toBe(control(index));
      expect(control(index).className).toContain("ms-auto");
    }
    // the pills of a choice stay one group, right-aligned
    expect(control(0).querySelectorAll('[role="radiogroup"]')).toHaveLength(1);
    expect(control(0).querySelector('[role="radiogroup"]')!.className).toContain("justify-end");
  });

  it("wraps instead of clipping: the label has a basis, the control may drop under it, pills wrap inside", () => {
    mount([{ question: "Pick one of many", kind: "choice", options: six.concat(six.map((o) => ({ label: `${o.label} and a long label` }))) }, { question: "Which?", kind: "choice", options: [{ label: "A" }, { label: "B" }] }]);
    const label = formRow(0).children[0] as HTMLElement;
    expect(label.className).toContain("flex-[1_1_12rem]");
    expect(control(0).className).toContain("max-w-full");
    expect(control(0).className).toContain("min-w-0");
    expect(control(0).querySelector('[role="radiogroup"]')!.className).toContain("flex-wrap");
    expect(host.querySelector('[class*="overflow-x"]')).toBeNull();
  });

  it("gives a long text its own line and a short text the width left up to a maximum", () => {
    mount([
      { question: "Name", kind: "text", options: [] },
      { question: "Notes", kind: "long_text", options: [] },
    ]);
    expect(control(0).className).toContain("max-w-[24rem]");
    expect(control(1).className).toContain("basis-full");
    expect((formRow(1).children[0] as HTMLElement).className).toContain("basis-full");
  });

  it("keeps a card with one question as it was: A / B / C rows, no form rows", () => {
    mount([{ question: "Which room?", options: [{ label: "North" }, { label: "South" }] }]);
    expect(host.querySelector("[data-form-row]")).toBeNull();
    expect(host.textContent).toContain("A");
    expect(host.textContent).toContain("North");
  });

  it("keeps the keyboard order of the rows and a label for every control", () => {
    mount(TIME);
    const focusable = Array.from(host.querySelectorAll<HTMLElement>("button, input, textarea"));
    const rowOf = (element: HTMLElement) => Array.from(host.querySelectorAll("[data-form-row]")).indexOf(element.closest("[data-form-row]")!);
    const order = focusable.filter((element) => element.closest("[data-form-row]")).map(rowOf);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    for (let index = 0; index < 7; index += 1) {
      const row = formRow(index);
      const labelled = row.getAttribute("aria-labelledby")!;
      expect(host.querySelector(`#${labelled}`)?.textContent).toContain(TIME[index]!.question);
    }
    expect(host.querySelector("textarea")!.getAttribute("aria-label")).toBe(TIME[2]!.question);
  });

  it("shows an answered row's answer at the right of its question", () => {
    const answer = formatQuestionAnswers(TIME, [["Done"], ["90 min"], ["4512"], ["45 min"], ["Travel"], ["yes"], ["(left empty)"]]);
    mount(TIME, { answered: "answer", answeredText: answer });
    const row = formRow(0);
    expect(row.className).toContain("justify-between");
    expect(row.children[0]!.textContent).toBe(TIME[0]!.question);
    expect(row.children[1]).toBe(row.querySelector("[data-form-answer]"));
  });
});
