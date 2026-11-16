// #4407: automatic recall puts other conversations' words into a turn's
// message, so into that conversation's engine session. The block says which
// threads it showed, so a thread made confidential later forgets the
// sessions that recalled it.
import { describe, expect, it, vi } from "vitest";

vi.mock("../messages/message-db.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../messages/message-db.ts")>()),
  recallMessages: () => [
    { threadId: "topic-b", messageId: "m1", at: 1, role: "user", kind: "text", snippet: "the [harbour] [contract] renewal" },
    { threadId: "topic-c", messageId: "m2", at: 2, role: "bot", kind: "text", snippet: "[harbour] [contract] signed" },
  ],
}));

const { conversationPassages, renderRecall } = await import("./recall.ts");

describe("recalled conversations carry their thread (#4407)", () => {
  it("each conversation passage names its thread", () => {
    const passages = conversationPassages({
      botId: "bot-1",
      message: "where is the harbour contract",
      threadIds: ["topic-b", "topic-c"],
      label: (id) => `chat "${id}"`,
      author: () => "Sam",
    }, "where is the harbour contract");
    expect(passages.map((passage) => passage.threadId)).toEqual(["topic-b", "topic-c"]);
  });

  it("the block lists only the threads of the passages it shows", () => {
    const block = renderRecall([
      { source: "memory", label: "MEMORY.md", snippet: "a note" },
      { source: "conversation", label: 'chat "A"', threadId: "t-a", snippet: "Alice: the plan" },
      // the same words again: not shown, so not carried
      { source: "conversation", label: 'chat "B"', threadId: "t-b", snippet: "Alice:  the plan" },
      // past the cap: not shown, so not carried
      { source: "conversation", label: 'chat "C"', threadId: "t-c", snippet: "x".repeat(2_000) },
    ], 1_200)!;
    expect(block.threadIds).toEqual(["t-a"]);
    expect(renderRecall([{ source: "memory", label: "MEMORY.md", snippet: "a note" }])!.threadIds).toEqual([]);
  });
});
