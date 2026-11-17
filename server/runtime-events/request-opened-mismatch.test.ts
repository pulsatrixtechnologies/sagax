import { describe, expect, it } from "vitest";
import { nativeChoiceMismatch, sentBackAnswer } from "./request-opened-present.ts";
import { BAD_DRAFTS_CARD, BAD_TIME_CARD } from "../../shared/card-rules.fixtures.ts";
import { questionAnswersByQuestion } from "../../shared/ask-question.ts";

// #2909: an engine question tool offering Yes / No on "A or B?" is sent
// back (the person could not answer it by a tap), like ask_choice.
describe("nativeChoiceMismatch", () => {
  const ask = (question: string, labels: string[], multiSelect = false) => [
    { question, multiSelect, options: labels.map((label) => ({ label })) },
  ];

  it("sends back Yes / No on a pick between alternatives", () => {
    expect(nativeChoiceMismatch({}, ask("Je garde la locale ou la distante ?", ["Oui", "Non"]), false)).toMatch(/alternatives/);
    expect(nativeChoiceMismatch({ summary: "Which copy do I keep?", choices: ["Yes", "No"] }, undefined, false)).toMatch(/alternatives/);
  });

  it("keeps real choices, yes / no questions, permissions, forms and multi-select", () => {
    expect(nativeChoiceMismatch({}, ask("Je garde la locale ou la distante ?", ["Locale", "Distante"]), false)).toBeUndefined();
    expect(nativeChoiceMismatch({}, ask("Je continue ?", ["Oui", "Non"]), false)).toBeUndefined();
    expect(nativeChoiceMismatch({ summary: "Which copy?", choices: ["Yes", "No"] }, undefined, true)).toBeUndefined();
    expect(nativeChoiceMismatch({}, ask("Which copy?", ["Yes", "No"], true), false)).toBeUndefined();
    expect(nativeChoiceMismatch({}, [...ask("Which copy?", ["Yes", "No"]), ...ask("Why?", ["A", "B"])], false)).toBeUndefined();
  });
});

// #4490: an engine's own question tool is held to the same card rules as
// ask_choice; the engine reads why and how to ask again, in the same turn.
describe("a badly made engine question is sent back (#4490)", () => {
  it("sends back the time card: one text holding seven questions", () => {
    const reason = nativeChoiceMismatch({}, [{ question: BAD_TIME_CARD.question, options: [] }], false);
    expect(reason).toMatch(/^Card refused \(rule several-questions/);
    expect(reason).toMatch(/one entry per question/);
  });

  it("sends back the drafts card from ask_user's flat choices", () => {
    const reason = nativeChoiceMismatch({ summary: BAD_DRAFTS_CARD.question, choices: [...BAD_DRAFTS_CARD.options] }, undefined, false);
    expect(reason).toMatch(/^Card refused \(rule list-in-prose/);
    expect(reason).toMatch(/multiSelect/);
  });

  it("keeps a well formed set of questions", () => {
    expect(nativeChoiceMismatch({}, [
      { question: "Standup at 9:00?", header: "Standup", options: [{ label: "Done" }, { label: "Not done" }] },
      { question: "Is the summary billable?", header: "Summary", options: [{ label: "Yes" }, { label: "No" }] },
    ], false)).toBeUndefined();
  });

  it("answers a set's first question with the reason, so the engine reads it", () => {
    const questions = [{ question: "One?", options: [] }, { question: "Two?", options: [] }];
    const answer = sentBackAnswer("Card refused (rule wall-of-text: x).", questions);
    expect(questionAnswersByQuestion(answer, questions)["One?"]).toMatch(/^Sagax: not asked\. Card refused/);
    expect(questionAnswersByQuestion(answer, questions)["Two?"]).toMatch(/see the first answer/);
    expect(sentBackAnswer("Why.", [questions[0]!])).toBe("Sagax: not asked. Why.");
  });
});
