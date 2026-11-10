// #3438: the person's answer to a parked teammate settles every card that
// asks it in their conversation: the input request and the hand-off's card
// of the same ask, so the pinned card over the composer leaves too.
import { describe, expect, it } from "vitest";

import { createSettleInputRequests } from "./settleInputRequests.ts";

function host(rows: Array<Record<string, unknown>>) {
  const messages = new Map<string, Array<Record<string, unknown>>>([["conv", rows]]);
  const patches: Array<[string, string, Record<string, unknown>]> = [];
  const value = {
    openInputRequests: new Map([["work-1", [{ threadId: "conv", messageId: "ir" }]]]),
    store: {
      activePath: (threadId: string) => messages.get(threadId) ?? [],
      patchMessage: (threadId: string, id: string, patch: Record<string, unknown>) => {
        patches.push([threadId, id, patch]);
        const list = messages.get(threadId)!;
        const at = list.findIndex((row) => row.id === id);
        list[at] = { ...list[at], ...patch };
      },
    },
  };
  return { value, patches, messages };
}

describe("settleInputRequests (#3438)", () => {
  it("marks the input request answered and the hand-off's card of the same ask handled", () => {
    const { value, messages } = host([
      { id: "card", attention: { kind: "question", threadId: "work-1", items: [{ text: "Which site?" }] } },
      { id: "other", attention: { kind: "question", threadId: "work-2", items: [{ text: "Unrelated" }] } },
      { id: "ir", inputRequest: { botId: "b", threadId: "work-1", botName: "B", question: "Which site?" } },
    ]);
    createSettleInputRequests(() => value)("work-1");
    const rows = messages.get("conv")!;
    expect((rows[0]!.attention as { handledAt?: number }).handledAt).toBeGreaterThan(0);
    expect((rows[1]!.attention as { handledAt?: number }).handledAt).toBeUndefined();
    expect((rows[2]!.inputRequest as { answered?: boolean }).answered).toBe(true);
  });
});
