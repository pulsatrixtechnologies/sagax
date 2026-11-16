import { describe, expect, it } from "vitest";
import { autoRecallLogLine, conversationKind, turnStartLogLine } from "./turn-log.ts";

describe("turnStartLogLine", () => {
  const turn = { botId: "bot-1", text: "what is six times seven", images: 0, depth: 0, card: false };

  it("logs char counts only, never the prompt text (Loi 25)", () => {
    const line = turnStartLogLine({ ...turn, spoken: false });
    expect(line).toBe(`[omb-turn] bot=bot-1 text=chars=${turn.text.length} images=0 depth=0 card=false`);
    expect(line).not.toContain("six");
    expect(line).not.toContain("seven");
    expect(turnStartLogLine({ ...turn, text: "x".repeat(200), spoken: false })).toBe(
      "[omb-turn] bot=bot-1 text=chars=200 images=0 depth=0 card=false",
    );
  });

  it("never logs words spoken on a Live call", () => {
    const line = turnStartLogLine({ ...turn, images: 1, depth: 0, card: true, spoken: true });
    expect(line).not.toContain("six times seven");
    expect(line).toBe("[omb-turn] bot=bot-1 text=(spoken) images=1 depth=0 card=true");
  });

  it("never logs a confidential thread's prompt", () => {
    const line = turnStartLogLine({ ...turn, spoken: false, confidential: true });
    expect(line).toBe("[omb-turn] bot=bot-1 text=(confidential) images=0 depth=0 card=false");
    expect(line).not.toContain("six");
  });
});

describe("conversationKind (#4394)", () => {
  const base = { threadId: "thread-1234567890", createdAt: 1 };
  it("says which turns are a person's messages in a bot's one conversation and which open their own", () => {
    expect(conversationKind({ ...base })).toBe("chat");
    expect(conversationKind({ ...base, routineRunId: "run-1" })).toBe("routine");
    expect(conversationKind({ ...base, routineResults: true })).toBe("routine");
    expect(conversationKind({ ...base, hidden: true })).toBe("hidden");
    expect(conversationKind({ ...base, openedBy: { botId: "bot-2" } })).toBe("opened");
    expect(conversationKind({ ...base, parallelOf: "thread-0" })).toBe("parallel");
    expect(conversationKind({ ...base, confidential: true })).toBe("confidential");
    expect(conversationKind({ ...base, closedBy: "bot-1" })).toBe("closed");
    expect(conversationKind(undefined)).toBe("unknown");
  });
  it("puts the short thread and the kind on the turn's start line", () => {
    expect(turnStartLogLine({ botId: "bot-1", text: "hi", images: 0, depth: 0, card: false, spoken: false, threadId: "abcdef1234567890", conversation: "hidden" }))
      .toBe("[omb-turn] bot=bot-1 thread=abcdef12 conv=hidden text=chars=2 images=0 depth=0 card=false");
  });
});

describe("autoRecallLogLine", () => {
  it("logs bot id and counts only, never a display name or message text", () => {
    const line = autoRecallLogLine("bot-42", 3, 1, "thread-9");
    expect(line).toBe("auto-recall: bot=bot-42 notes=3 conversations=1 thread=thread-9");
    expect(line).not.toMatch(/Alice|Bob|Scout|note text|hello/i);
  });
});
