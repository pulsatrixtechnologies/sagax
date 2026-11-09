import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { pendingQuestions, pinnedItems, pinnedQuestionAnswer } from "./pending-question";

const question = (id: string, card: Record<string, unknown> = {}): Message =>
  ({ id, at: 1, role: "bot", kind: "options", card: { title: "q", options: [], requestId: `r-${id}`, questionRequest: { version: 1, questions: [] }, ...card } }) as unknown as Message;

describe("pendingQuestions", () => {
  it("keeps only open question cards", () => {
    const list = [
      question("a"),
      question("b", { answered: "answer" }),
      question("c", { dismissed: true }),
      question("d", { expired: true }),
      question("e", { tool: "Bash", questionRequest: undefined }),
      { id: "f", at: 1, role: "bot", kind: "text", text: "hi" } as Message,
    ];
    expect(pendingQuestions(list).map((m) => m.id)).toEqual(["a"]);
  });
});

describe("pinnedItems (#3214)", () => {
  const approval = (id: string, at: number) =>
    ({ message: { id: `m-${id}`, at, role: "bot", kind: "options", card: { requestId: id, tool: "Bash", title: "", subtitle: "" } }, requestId: id, tool: "Bash", detail: "" }) as unknown as import("@/components/PendingApproval").Pending;
  it("holds approvals and questions together, oldest first", () => {
    const items = pinnedItems([approval("ap-late", 30), approval("ap-early", 5)], [{ ...question("q"), at: 10 }]);
    expect(items.map((item) => item.key)).toEqual(["approval::ap-early", "question:r-q", "approval::ap-late"]);
  });
  it("is empty when nothing waits", () => {
    expect(pinnedItems([], [])).toEqual([]);
  });
});

describe("pinnedQuestionAnswer (#3214)", () => {
  const one = (more: Record<string, unknown> = {}, q: Record<string, unknown> = {}) =>
    pinnedItems([], [question("q", { questionRequest: { version: 1, questions: [{ question: "Which one?", options: [{ label: "A" }], ...q }] }, ...more })])[0];
  it("turns the typed text into the question's free answer", () => {
    expect(pinnedQuestionAnswer(one(), "  the second one ")).toEqual({ requestId: "r-q", answer: "The user answered your questions.\n\nQ: Which one?\nA: the second one" });
  });
  it("answers nothing for an empty line, a closed question or a page choice", () => {
    expect(pinnedQuestionAnswer(one(), "   ")).toBeNull();
    expect(pinnedQuestionAnswer(one({}, { custom: false }), "x")).toBeNull();
    expect(pinnedQuestionAnswer(one({ pageTargetChoice: true }), "x")).toBeNull();
    expect(pinnedQuestionAnswer(undefined, "x")).toBeNull();
  });
  it("leaves a multi-question ask and an approval to their own buttons", () => {
    expect(pinnedQuestionAnswer(one({ questionRequest: { version: 1, questions: [{ question: "a" }, { question: "b" }] } }), "x")).toBeNull();
    const approval = pinnedItems([{ message: { id: "m", at: 1, card: { requestId: "ap" } }, requestId: "ap", tool: "Bash", detail: "" } as unknown as import("@/components/PendingApproval").Pending], [])[0];
    expect(pinnedQuestionAnswer(approval, "x")).toBeNull();
  });
});
