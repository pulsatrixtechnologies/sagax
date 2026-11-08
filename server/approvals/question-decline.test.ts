import { describe, expect, it } from "vitest";
import { closeDeclinedQuestion, isQuestionDecline } from "./question-decline.ts";

function store(card: Record<string, unknown>) {
  const rows = [{ id: "q1", role: "bot", kind: "options", card }] as never[];
  const patches: unknown[] = [];
  return {
    patches,
    messagesFor: () => rows,
    patchMessage: (_t: string, id: string, patch: { card?: unknown }) => { patches.push({ id, ...(patch.card as Record<string, unknown>) }); (rows[0] as { card: unknown }).card = patch.card; },
  };
}

describe("declined question (#2634)", () => {
  it("only a question answer marked declined is a decline", () => {
    const question = { requestId: "r", requestType: "question" } as never;
    expect(isQuestionDecline({ behavior: "answer", declined: true }, question)).toBe(true);
    expect(isQuestionDecline({ behavior: "answer" }, question)).toBe(false);
    expect(isQuestionDecline({ behavior: "answer", declined: true }, { requestId: "r", requestType: "permission", tool: "Bash" } as never)).toBe(false);
  });

  it("closes the card as declined without a message, once", () => {
    const s = store({ requestId: "r", requestType: "question", options: ["A"] });
    expect(closeDeclinedQuestion(s, "t", "q1")).toEqual({ status: 200, body: { ok: true, outcome: "declined" } });
    expect(s.patches).toEqual([{ id: "q1", requestId: "r", requestType: "question", options: ["A"], answered: "deny", dismissed: true }]);
    expect(closeDeclinedQuestion(s, "t", "q1").status).toBe(409);
    expect(closeDeclinedQuestion(s, "t", "missing").status).toBe(404);
  });
});
