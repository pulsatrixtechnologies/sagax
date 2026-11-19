import { describe, expect, it } from "vitest";
import { retireOpenQuestions } from "./retire-open-questions.ts";

type Row = { id: string; card?: Record<string, unknown>; approval?: boolean };

function setup(rows: Row[]) {
  const patched: Array<{ id: string; card: Record<string, unknown> }> = [];
  const forgotten: string[] = [];
  const deps = {
    messagesFor: () => rows as never[],
    isPersistentQuestionCard: (card: { kind?: string }) => card.kind === "question",
    isApprovalCardMessage: (message: Row) => message.approval === true,
    patch: (_t: string, id: string, card: Record<string, unknown>) => { patched.push({ id, card }); },
    forget: (_t: string, requestId: string) => { forgotten.push(requestId); },
  };
  return { deps: deps as never, patched, forgotten };
}

describe("retireOpenQuestions (#2608)", () => {
  it("expires the open persistent question so the thread stops waiting", () => {
    const { deps, patched, forgotten } = setup([
      { id: "m1", card: { kind: "question", requestId: "ask-choice-1", options: ["A", "B"] } },
    ]);
    expect(retireOpenQuestions(deps, "t1")).toEqual(["ask-choice-1"]);
    expect(patched).toEqual([{ id: "m1", card: { kind: "question", requestId: "ask-choice-1", options: [], expired: true } }]);
    expect(forgotten).toEqual(["ask-choice-1"]);
  });

  it("leaves settled questions, approvals and plain cards alone", () => {
    const { deps, patched } = setup([
      { id: "a", card: { kind: "question", requestId: "r1", answered: "answer" } },
      { id: "b", card: { kind: "question", requestId: "r2", dismissed: true } },
      { id: "c", card: { kind: "question", requestId: "r3", expired: true } },
      { id: "d", card: { kind: "question", requestId: "r4" }, approval: true },
      { id: "e", card: { kind: "tool", requestId: "r5" } },
      { id: "f" },
    ]);
    expect(retireOpenQuestions(deps, "t1")).toEqual([]);
    expect(patched).toEqual([]);
  });
});
