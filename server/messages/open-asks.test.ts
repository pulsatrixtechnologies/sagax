import { describe, expect, it } from "vitest";

import type { Message } from "../store.ts";
import { openAsksNote, stillOpenAsks, withOpenAsksNote } from "./open-asks.ts";

const card = (id: string, at: number, extra: Partial<NonNullable<Message["card"]>>): Message => ({
  id, role: "bot", kind: "options", at,
  card: { title: "Your bot has a question", subtitle: "", options: ["A", "B"], ...extra },
} as Message);

// #4475: a bot asked two things in one turn; the person answered one
describe("the questions still open when a person's turn starts", () => {
  const color = card("c1", 1, { subtitle: "Which color?", requestType: "question", answered: "Red" });
  const size = card("c2", 2, { subtitle: "Which size?", requestType: "question" });
  const raised = card("c3", 3, { requestId: "ask-choice-1", requestType: "question", questionRequest: { version: 1, questions: [{ question: "Which day?", options: [{ label: "Mon" }] }] } });
  const permission = card("p1", 4, { requestId: "req-p", requestType: "permission", tool: "Bash", subtitle: "rm -rf build" });
  const quiz = card("quiz", 0, { title: "What should we start with?", subtitle: "Pick one." });
  const offer = card("o1", 5, { subtitle: "Keep the daily brief?", proactiveProposal: { id: "x1" } } as Partial<NonNullable<Message["card"]>>);
  const expired = card("c4", 6, { subtitle: "Old one?", requestType: "question", expired: true });

  it("lists each bot question still open, a chat card or a raised one, never the answered one, a permission, an offer or the quiz", () => {
    expect(stillOpenAsks([quiz, color, size, raised, permission, offer, expired])).toEqual(["Which size?", "Which day?"]);
  });

  it("leaves out the card this turn answers (its answer is being delivered)", () => {
    expect(stillOpenAsks([size, raised], "c3")).toEqual(["Which size?"]);
  });

  it("tells the bot to go on with what is answered and leave the open card to the person", () => {
    const text = withOpenAsksNote("Red", [color, size]);
    expect(text.startsWith("Red\n\n[Still open:")).toBe(true);
    expect(text).toContain('- "Which size?"');
    expect(text).toContain("Do not ask these again and do not answer them for the person");
    expect(openAsksNote(["Which size?", "Which day?"])).toContain("these questions");
  });

  it("adds nothing when no question waits", () => {
    expect(withOpenAsksNote("Hello", [color, permission, quiz])).toBe("Hello");
  });
});
