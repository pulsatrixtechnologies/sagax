// #4910: a form row can hang under the one answer that needs it (`when`);
// a card written before that link existed still reads well: an optional
// text row right after a choice row hangs under it, always shown.
import { describe, expect, it } from "vitest";

import { followUpParent, formRowsShown, formSteps, parseAskQuestions, type AskQuestion } from "./ask-question.ts";
import { parseAskChoiceInput } from "./options-card.ts";

const rows = (input: Record<string, unknown>): AskQuestion[] => {
  const parsed = parseAskChoiceInput({ question: "Three entries.", ...input });
  if (!parsed.ok || !("value" in parsed) || !parsed.value.questions) throw new Error(parsed.ok ? "no rows" : parsed.error);
  return parsed.value.questions;
};
const refusal = (input: Record<string, unknown>): string => {
  const parsed = parseAskChoiceInput({ question: "Three entries.", ...input });
  return parsed.ok ? "" : parsed.error;
};

const LINKED = {
  questions: [
    { question: "Design review: how long?", header: "Duration", kind: "choice", options: ["As scheduled", "Enter it", "Do not bill"], details: ["Calendar length", "Type it below", "No entry"] },
    { question: "Real length", kind: "duration", optional: true, when: { question: "Duration", option: "enter it" } },
    { question: "Billable?", kind: "yes_no" },
    { question: "Why not?", kind: "text", optional: true, when: { question: "Billable?", option: "No" } },
  ],
};

describe("ask_choice form rows with a when link (#4910)", () => {
  it("stores the link on the parent's own question text and option key", () => {
    const form = rows(LINKED);
    expect(form[1]!.when).toEqual({ question: "Design review: how long?", option: "Enter it" });
    // a yes / no answer is keyed by its id
    expect(form[3]!.when).toEqual({ question: "Billable?", option: "no" });
  });

  it("carries the option details that run parallel to options", () => {
    const form = rows(LINKED);
    expect(form[0]!.options.map((option) => option.description)).toEqual(["Calendar length", "Type it below", "No entry"]);
  });

  it("refuses a link to a row that is not earlier, not a choice, or an answer it does not have", () => {
    const row = { question: "Ticket", kind: "text", optional: true };
    const parent = { question: "Which?", kind: "choice", options: ["A", "B"] };
    expect(refusal({ questions: [{ ...row, when: { question: "Which?", option: "A" } }, parent] })).toMatch(/questions\[0\]\.when/);
    expect(refusal({ questions: [{ question: "Name", kind: "text" }, { ...row, when: { question: "Name", option: "A" } }] })).toMatch(/questions\[1\]\.when/);
    expect(refusal({ questions: [parent, { ...row, when: { question: "Which?", option: "C" } }] })).toMatch(/"C" is not an answer of that row \("A", "B"\)/);
    expect(refusal({ questions: [parent, { ...row, when: "A" }] })).toMatch(/\.when: \{question, option\}/);
  });

  it("survives the question parser a stored card goes through", () => {
    const stored = parseAskQuestions({ questions: rows(LINKED) })!;
    expect(stored[1]!.when).toEqual({ question: "Design review: how long?", option: "Enter it" });
  });
});

describe("followUpParent and formSteps", () => {
  it("hangs a linked row under its parent, conditionally", () => {
    const form = rows(LINKED);
    expect(followUpParent(form, 0)).toBeNull();
    expect(followUpParent(form, 1)).toEqual({ parent: 0, conditional: true });
    expect(followUpParent(form, 3)).toEqual({ parent: 2, conditional: true });
    expect(formSteps(form)).toEqual([{ head: 0, followUps: [1] }, { head: 2, followUps: [3] }]);
  });

  it("falls back for an old card: an optional text row after a choice row hangs under it, always shown", () => {
    const old = rows({
      questions: [
        { question: "Which ticket?", kind: "choice", options: ["The usual one", "Enter a ticket"] },
        { question: "Ticket number", kind: "text", optional: true },
        { question: "Length", kind: "duration" },
        { question: "Notes", kind: "long_text", optional: true },
      ],
    });
    expect(followUpParent(old, 1)).toEqual({ parent: 0, conditional: false });
    // a required row, or a row after a non-choice row, is a step of its own
    expect(followUpParent(old, 2)).toBeNull();
    expect(followUpParent(old, 3)).toBeNull();
    expect(formSteps(old)).toEqual([{ head: 0, followUps: [1] }, { head: 2, followUps: [] }, { head: 3, followUps: [] }]);
    expect(formRowsShown(old, () => [])).toEqual([true, true, true, true]);
  });

  it("shows a linked row only while its parent holds that answer", () => {
    const form = rows(LINKED);
    const picks = (map: Record<number, string[]>) => (index: number) => map[index] ?? [];
    expect(formRowsShown(form, picks({}))).toEqual([true, false, true, false]);
    expect(formRowsShown(form, picks({ 0: ["Enter it"] }))).toEqual([true, true, true, false]);
    expect(formRowsShown(form, picks({ 0: ["Do not bill"], 2: ["no"] }))).toEqual([true, false, true, true]);
  });

  it("hides a follow-up of a hidden follow-up", () => {
    const form = rows({
      questions: [
        { question: "A?", kind: "choice", options: ["x", "y"] },
        { question: "B?", kind: "choice", options: ["p", "q"], optional: true, when: { question: "A?", option: "x" } },
        { question: "C", kind: "text", optional: true, when: { question: "B?", option: "p" } },
      ],
    });
    expect(formRowsShown(form, (index) => ({ 0: ["y"], 1: ["p"] } as Record<number, string[]>)[index] ?? [])).toEqual([true, false, false]);
    expect(formRowsShown(form, (index) => ({ 0: ["x"], 1: ["p"] } as Record<number, string[]>)[index] ?? [])).toEqual([true, true, true]);
  });
});
