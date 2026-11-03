import { afterEach, describe, expect, it } from "vitest";

import { buildRecall } from "./recall.ts";
import { fusePassages, prepareSemanticRecall, semanticPassages, setSemanticIndex, type SemanticIndex } from "./semantic-recall.ts";

afterEach(() => setSemanticIndex(null));

const lexical = [
  { source: "memory" as const, label: "memory/notes.md", snippet: "the invoice is in the drawer" },
];

describe("semantic recall beside FTS5", () => {
  it("keeps FTS5 in front and adds only a new file or a new message", () => {
    const fused = fusePassages([...lexical, { source: "conversation", label: "your main chat", at: 5, snippet: "Ada: the drawer" }], [
      { source: "memory", label: "memory/notes.md", snippet: "same file, ignore" },
      { source: "conversation", label: "your main chat", at: 5, snippet: "Ada: same message, ignore" },
      { source: "conversation", label: "your main chat", at: 9, snippet: "Ada: another message" },
      { source: "memory", label: "memory/places.md", snippet: "the quiet room upstairs" },
    ], 4);
    expect(fused.map((passage) => passage.snippet)).toEqual(["the invoice is in the drawer", "Ada: the drawer", "Ada: another message", "the quiet room upstairs"]);
  });

  it("stays on FTS5 when no local index is registered", async () => {
    expect(semanticPassages("bot-a", "where is the quiet room", 4)).toEqual([]);
    await prepareSemanticRecall("bot-a", "where is the quiet room");
    const input = { botId: "bot-missing", message: "where is the invoice?", threadIds: [] as string[], label: () => "", author: () => "" };
    expect(buildRecall({ ...input, semantic: true })).toEqual(buildRecall(input));
  });

  it("names a conversation hit like FTS5 does and never passes one outside the allowed threads", () => {
    const local: SemanticIndex = {
      ready: (botId) => botId === "bot-a",
      search: () => [
        { source: "memory", label: "memory/places.md", snippet: "the quiet room upstairs", score: 2 },
        { source: "conversation", label: "t-private", threadId: "t-private", role: "user", snippet: "a private aside", score: 3 },
        { source: "conversation", label: "t-ok", threadId: "t-ok", role: "assistant", snippet: "the quiet room is booked", score: 2, at: 7 },
      ],
    };
    setSemanticIndex(local);
    const block = buildRecall({
      botId: "bot-a",
      message: "where is the quiet room tonight",
      threadIds: ["t-ok"],
      label: (id) => `chat ${JSON.stringify(id)}`,
      author: (hit) => (hit.role === "user" ? "Sam" : "Memo"),
      semantic: true,
    });
    expect(block?.text).toContain("quiet room upstairs");
    expect(block?.text).toContain('chat "t-ok" (');
    expect(block?.text).toContain("Memo: the quiet room is booked");
    expect(block?.text).not.toContain("private aside");
    expect(buildRecall({ botId: "bot-a", message: "where is the quiet room tonight", threadIds: [], label: () => "", author: () => "", semantic: true })?.text).not.toContain("booked");
    expect(buildRecall({ botId: "bot-a", message: "where is the quiet room tonight", threadIds: [], label: () => "", author: () => "" })?.text ?? "").not.toContain("quiet room");
  });

  it("bounds the async step and never throws from it", async () => {
    setSemanticIndex({ ready: () => true, search: () => [], prepare: () => new Promise<void>(() => {}) });
    const started = Date.now();
    await prepareSemanticRecall("bot-a", "a slow endpoint", 50);
    expect(Date.now() - started).toBeLessThan(1_000);
    setSemanticIndex({ ready: () => true, search: () => [], prepare: async () => { throw new Error("down"); } });
    await expect(prepareSemanticRecall("bot-a", "a broken endpoint")).resolves.toBeUndefined();
  });
});
