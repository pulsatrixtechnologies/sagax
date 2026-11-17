import { describe, expect, it } from "vitest";

import { answerResponse, cardAnswerOpen, dismissResponse } from "./card-answer";

describe("answerResponse", () => {
  it("answers a question with the chosen text", () => {
    expect(answerResponse({}, "Software Engineer")).toEqual({
      behavior: "answer",
      message: "Software Engineer",
      // #4438: this device opens what a server card's answer names
      opens: true,
    });
  });

  it("answers a question whose option is literally 'Allow' with the TEXT, not an allow", () => {
    // the case the old label-matching rule got wrong: the broker refuses an
    // allow on a question, the card closes unreachable, and the bot waits
    // out its whole timeout
    expect(answerResponse({}, "Allow")).toEqual({ behavior: "answer", message: "Allow", opens: true });
    expect(answerResponse({}, "Deny")).toEqual({ behavior: "answer", message: "Deny", opens: true });
  });

  it("decides a permission card by its refusal, not by matching 'Allow'", () => {
    expect(answerResponse({ tool: "Bash" }, "Allow")).toEqual({ behavior: "allow" });
    expect(answerResponse({ tool: "Bash" }, "Deny")).toEqual({ behavior: "deny" });
    // peer-approval cards offer this third option; the grant is written
    // separately, so this one action is simply allowed
    expect(answerResponse({ tool: "ask_bot" }, "Always allow")).toEqual({ behavior: "allow" });
    // a card that says "Yes" rather than "Allow" still lets the action run
    expect(answerResponse({ tool: "Bash" }, "Yes")).toEqual({ behavior: "allow" });
  });
});

describe("dismissResponse", () => {
  it("denies a permission but ANSWERS a question", () => {
    expect(dismissResponse({ tool: "Bash" })).toMatchObject({ behavior: "deny" });
    // a deny on a question is refused by the broker, so closing the card
    // used to leave the bot waiting on a card that was already gone. The
    // explicit dismiss marker is rejected while the question is unresolved.
    expect(dismissResponse({})).toMatchObject({ behavior: "answer", dismiss: true });
    expect(dismissResponse({}).message).toContain("without answering");
  });
});

describe("the place a server card's answer opens (#4438)", () => {
  it("reads the routine's page from the respond answer, and nothing else", () => {
    expect(cardAnswerOpen({ ok: true, outcome: "answered", direct: true, open: { type: "open_routine", routineId: "r1", botId: "b1" } })).toEqual({ routineId: "r1", botId: "b1" });
    expect(cardAnswerOpen({ open: { type: "open_routine", routineId: "r1" } })).toEqual({ routineId: "r1" });
    expect(cardAnswerOpen({ ok: true, outcome: "answered", late: true })).toBeNull();
    expect(cardAnswerOpen({ open: { type: "open_page", routineId: "r1" } })).toBeNull();
    expect(cardAnswerOpen({ open: { type: "open_routine", routineId: "" } })).toBeNull();
    expect(cardAnswerOpen(undefined)).toBeNull();
  });
});
