import { describe, expect, it } from "vitest";

import type { Message } from "@/state/store";
import { pendingQuestions } from "./pending-question";

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
