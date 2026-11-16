import { describe, expect, it } from "vitest";

import { BAD_DRAFTS_CARD, BAD_TIME_CARD, GOOD_DRAFTS_CARD, GOOD_TIME_CARD } from "./card-rules.fixtures";
import { CARD_LIMITS, cardRefusalText, cardRuleBreak, nativeCardRuleBreak } from "./card-rules";

const single = (question: string, options: string[] = []) => ({ questions: [{ question, options: options.map((label) => ({ label })) }] });

describe("cardRuleBreak (#4490)", () => {
  it("refuses the time card: one text holding seven questions", () => {
    const broken = cardRuleBreak(single(BAD_TIME_CARD.question, [...BAD_TIME_CARD.options]));
    expect(broken?.rule).toBe("several-questions");
  });

  it("refuses the drafts card: a list in prose where items are picked", () => {
    const broken = cardRuleBreak(single(BAD_DRAFTS_CARD.question, [...BAD_DRAFTS_CARD.options]));
    expect(broken?.rule).toBe("list-in-prose");
  });

  it("refuses actions named in the text that the card does not carry", () => {
    const broken = cardRuleBreak(single("Two drafts are ready. Post selected sends them. Skip tonight sends nothing.", ["OK", "Cancel"]));
    expect(broken).toMatchObject({ rule: "choices-in-text" });
    expect(broken?.missing).toEqual(["Post selected", "Skip tonight"]);
  });

  it("refuses an answer to type that is not a choice on the card", () => {
    expect(cardRuleBreak(single("Reply \"ship\" to deploy now, or \"hold\" to wait.", []))?.rule).toBe("choices-in-text");
    expect(cardRuleBreak(single("Réponds « garder » pour la garder.", ["Supprimer", "Archiver"]))?.rule).toBe("choices-in-text");
  });

  it("keeps a card whose named answers are its own choices", () => {
    expect(cardRuleBreak(single("Reply \"Ship\" to deploy now.", ["Ship", "Hold"]))).toBeNull();
    expect(cardRuleBreak({ context: "Uncheck any you do not want. Post selected sends them.", questions: [{ question: "Drafts", multiSelect: true, options: [{ label: "A" }, { label: "B" }], actions: ["Post selected", "Skip tonight"] }] })).toBeNull();
  });

  it("refuses a text over a sensible length", () => {
    expect(cardRuleBreak(single("Go on with the import? ".padEnd(CARD_LIMITS.single + 1, "x"), ["Import", "Wait"]))?.rule).toBe("wall-of-text");
    expect(cardRuleBreak({ context: "x".repeat(CARD_LIMITS.context + 1), questions: [{ question: "A", options: [], kind: "text" }] })?.rule).toBe("wall-of-text");
    expect(cardRuleBreak({ context: "Rows", questions: [{ question: "x".repeat(CARD_LIMITS.row + 1), options: [], kind: "text" }, { question: "B", options: [], kind: "text" }] })?.rule).toBe("wall-of-text");
  });

  it("refuses a form row that asks two things", () => {
    const broken = cardRuleBreak({ context: "Tonight", questions: [{ question: "Which ticket? And how long?", options: [], kind: "text" }, { question: "Done?", options: [], kind: "yes_no" }] });
    expect(broken?.rule).toBe("several-questions");
  });

  it("keeps the two rebuilt cards", () => {
    expect(cardRuleBreak({ context: GOOD_TIME_CARD.question, questions: GOOD_TIME_CARD.questions.map((row) => ({ question: row.question, kind: row.kind, options: ("options" in row ? row.options : []).map((label) => ({ label })) })) })).toBeNull();
    expect(cardRuleBreak({ context: GOOD_DRAFTS_CARD.question, questions: [{ question: GOOD_DRAFTS_CARD.question, multiSelect: true, options: GOOD_DRAFTS_CARD.items.map((item) => ({ label: item.label, description: item.detail })), actions: [...GOOD_DRAFTS_CARD.actions] }] })).toBeNull();
  });

  // The heuristics never refuse a good card: real asks the bots make.
  it.each([
    ["Should I operate purely on-demand, or set up a weekly restock check?", ["On-demand only", "Weekly restock"]],
    ["Je garde la locale ou la distante ?", ["Locale", "Distante"]],
    ["The deploy holds three changes:\n- the sidebar fix\n- the new export\n- the sync retry\nDeploy them now?", ["Deploy now", "Wait"]],
    ["The build failed on `npm run test?` (see https://example.com/run?id=4). Retry it?", ["Retry", "Stop"]],
    ["Ada asked to move the review. The calendar has 14:00 free. Is 14:00 OK? It would push the demo.", ["14:00", "Keep 10:00"]],
    ["Which of these do you want first?\n1. Export\n2. Import\n3. Sync", ["Export", "Import", "Sync"]],
    ["This script sends a report every Monday. The report skips weekends. Keep it?", ["Keep", "Remove"]],
    ["Tu veux que je publie le brouillon maintenant ? Il est prêt depuis ce matin.", ["Publier", "Attendre"]],
    ["What should the routine be called?", []],
  ])("keeps %j", (question, options) => {
    expect(cardRuleBreak(single(question, options))).toBeNull();
  });
});

describe("nativeCardRuleBreak (#4490)", () => {
  it("reads an engine's own question set the same way", () => {
    expect(nativeCardRuleBreak([{ question: BAD_TIME_CARD.question, options: [] }])?.rule).toBe("several-questions");
    expect(nativeCardRuleBreak([{ question: "Ship it?", options: [{ label: "Ship" }, { label: "Hold" }] }, { question: "When?", options: [] }])).toBeNull();
  });
});

describe("cardRefusalText (#4490)", () => {
  it("names the rule, says nothing was shown and gives an example of the right call", () => {
    const text = cardRefusalText({ rule: "several-questions", reason: "the text asks 7 questions" }, "ask_choice");
    expect(text).toMatch(/Card refused/);
    expect(text).toMatch(/several-questions/);
    expect(text).toMatch(/nothing was shown/i);
    expect(text).toMatch(/"questions":\[/);
    expect(text).toMatch(/same turn/);
  });

  it("tells a checklist with action buttons for a list in prose", () => {
    const text = cardRefusalText({ rule: "list-in-prose", reason: "6 listed items to pick from" }, "ask_choice");
    expect(text).toMatch(/"items":\[/);
    expect(text).toMatch(/"actions":\[/);
  });

  it("tells an engine's own question tool its own shape", () => {
    const text = cardRefusalText({ rule: "several-questions", reason: "the text asks 7 questions" }, "native");
    expect(text).toMatch(/one entry per question/);
    expect(text).toMatch(/ask_choice/);
  });

  it("lists the actions the card must carry", () => {
    const text = cardRefusalText({ rule: "choices-in-text", reason: "names answers the card does not carry", missing: ["Post selected", "Skip tonight"] }, "ask_choice");
    expect(text).toContain("Post selected");
    expect(text).toContain("Skip tonight");
  });
});

describe("a checklist's answer read back (#4490)", () => {
  it("says the button pressed with the picks, in the chat and for the bot", async () => {
    const { formatQuestionAnswers, answeredAction, visibleQuestionAnswer } = await import("./ask-question");
    const questions = [{ question: "Drafts", multiSelect: true, options: [{ label: "A" }, { label: "B" }], actions: ["Post selected", "Skip tonight"] }];
    const answer = formatQuestionAnswers(questions, [["A"]], "Post selected");
    expect(answeredAction(answer)).toBe("Post selected");
    expect(visibleQuestionAnswer(answer, questions)).toBe("Drafts\nA\n\nAction\nPost selected");
    expect(formatQuestionAnswers(questions, [[]], "Skip tonight")).toContain("Q: Drafts\nA: (none)");
    expect(answeredAction(formatQuestionAnswers(questions, [["A"]]))).toBeUndefined();
  });
});

describe("a long single question in paragraphs (#4205, #4490)", () => {
  it("is kept: the card folds it", () => {
    const paragraphs = Array.from({ length: 5 }, () => "The import found rows it could not match to a customer. ".repeat(6).trim()).join("\n\n");
    expect(paragraphs.length).toBeGreaterThan(CARD_LIMITS.single);
    expect(cardRuleBreak(single(`${paragraphs}\n\nImport the rest?`, ["Import", "Wait"]))).toBeNull();
  });
});
