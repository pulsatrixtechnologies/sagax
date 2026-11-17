// #4417: the context size a bot's turn runs at, read the same by the server
// and the screens.
import { describe, expect, it } from "vitest";

import { cleanContextDefaults, contextSizeForTurn, contextSizeInForce, contextSizeWords, isContextSize, offeredContextSizes } from "./context-size.ts";
import { STATIC_CLAUDE_MODELS } from "../server/drivers/claude/config.ts";

const claude = { instanceId: "claude", driverKind: "claudeAgent", displayName: "Claude" };
const opus = STATIC_CLAUDE_MODELS.options.find((option) => option.id === "claude-opus-5-5");

describe("context size (#4417)", () => {
  it("Claude Code offers the 200K and the 1M window for its 1M models, one size for Haiku 4.5", () => {
    expect(offeredContextSizes(opus)).toEqual([200_000, 1_000_000]);
    for (const option of STATIC_CLAUDE_MODELS.options.filter((row) => row.contextWindow === 1_000_000)) {
      expect(offeredContextSizes(option), option.id).toEqual([200_000, 1_000_000]);
    }
    expect(offeredContextSizes(STATIC_CLAUDE_MODELS.options.find((option) => option.id === "claude-haiku-4-5"))).toEqual([]);
  });

  it("hides a single size: one size, or none, offers no choice", () => {
    expect(offeredContextSizes({ contextWindow: 500_000 })).toEqual([]);
    expect(offeredContextSizes({ contextWindows: [500_000] })).toEqual([]);
    expect(offeredContextSizes({ contextWindows: [1_000_000, 200_000, 200_000] })).toEqual([200_000, 1_000_000]);
    expect(offeredContextSizes(undefined)).toEqual([]);
  });

  it("runs the bot's own size, else the person's default for the provider, else the model's own", () => {
    const offered = [200_000, 1_000_000];
    expect(contextSizeInForce({ offered, chosen: 200_000, fallback: 1_000_000 })).toBe(200_000);
    expect(contextSizeInForce({ offered, chosen: null, fallback: 200_000 })).toBe(200_000);
    expect(contextSizeInForce({ offered, chosen: 128_000, fallback: undefined })).toBeUndefined();
    expect(contextSizeForTurn({ instance: claude, option: opus, chosen: undefined, defaults: { anthropic: 200_000 } })).toBe(200_000);
    expect(contextSizeForTurn({ instance: claude, option: opus, chosen: 1_000_000, defaults: { anthropic: 200_000 } })).toBe(1_000_000);
    expect(contextSizeForTurn({ instance: claude, option: opus, chosen: undefined, defaults: { openai: 200_000 } })).toBeUndefined();
    // a model with one size never takes a size
    expect(contextSizeForTurn({ instance: claude, option: { id: "claude-haiku-4-5" }, chosen: 200_000, defaults: {} })).toBeUndefined();
  });

  it("keeps only real sizes and says them as the vendors do", () => {
    expect(isContextSize(200_000)).toBe(true);
    expect(isContextSize(0)).toBe(false);
    expect(isContextSize("200000")).toBe(false);
    expect(isContextSize(1.5)).toBe(false);
    expect(cleanContextDefaults({ anthropic: 200_000, openai: "1M", "": 1_000_000 })).toEqual({ anthropic: 200_000 });
    expect(contextSizeWords(1_000_000)).toBe("1M");
    expect(contextSizeWords(200_000)).toBe("200K");
    expect(contextSizeWords(131_072)).toBe("131K");
  });
});
