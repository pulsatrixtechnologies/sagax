import { describe, expect, it } from "vitest";
import { autoRecallLogLine, turnStartLogLine } from "./turn-log.ts";

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

describe("autoRecallLogLine", () => {
  it("logs bot id and counts only, never a display name or message text", () => {
    const line = autoRecallLogLine("bot-42", 3, 1, "thread-9");
    expect(line).toBe("auto-recall: bot=bot-42 notes=3 conversations=1 thread=thread-9");
    expect(line).not.toMatch(/Alice|Bob|Scout|note text|hello/i);
  });
});
