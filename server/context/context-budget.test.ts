import { expect, it } from "vitest";
import { compactBudget, contextWindowFor, defaultCompactAt, nativeCompactionPoint, shouldCompact, DEFAULT_CONTEXT_WINDOW } from "./context-budget.ts";

it("keeps compaction reachable below small model windows", () => {
  expect(compactBudget(8_000)).toBe(6_400);
  expect(compactBudget(2_000, 20_000)).toBe(1_800);
  expect(compactBudget(100_000, 0.7, 50_000)).toBe(45_000);
});

it("rejects invalid window values and ignores invalid provider readings", () => {
  for (const value of [NaN, Infinity, 0, -1]) {
    expect(() => compactBudget(value)).toThrow();
    expect(contextWindowFor(undefined, undefined, value)).toBe(DEFAULT_CONTEXT_WINDOW);
  }
});

it("prefers measured context, and otherwise estimates without using summed tool-round input", () => {
  expect(shouldCompact({ contextTokens: 1_000, estimatedBytes: 80_000, budget: 8_000, window: 10_000 })).toBe(false);
  expect(shouldCompact({ estimatedBytes: 40_000, budget: 8_000, window: 10_000 })).toBe(true);
});

it("does not let the regrowth floor defer compaction past window headroom", () => {
  expect(shouldCompact({ contextTokens: 9_000, estimatedBytes: 0, budget: 8_000, floor: 8_500, window: 10_000 })).toBe(true);
  expect(shouldCompact({ contextTokens: 8_600, estimatedBytes: 0, budget: 8_000, floor: 8_500, window: 10_000 })).toBe(false);
});

it("does not let the regrowth floor outrun a known native compaction threshold", () => {
  const window = 1_000_000;
  const nativeCompactAt = 200_000;
  const budget = compactBudget(window, undefined, nativeCompactAt);
  expect(budget).toBe(180_000);
  expect(shouldCompact({ contextTokens: 180_000, estimatedBytes: 0, budget, floor: 175_000, window, nativeCompactAt })).toBe(true);
  expect(shouldCompact({ contextTokens: 179_999, estimatedBytes: 0, budget, floor: 175_000, window, nativeCompactAt })).toBe(false);
});

it("folds before each engine's own compaction point", () => {
  expect(nativeCompactionPoint("claudeAgent", 1_000_000, 200_000)).toBe(200_000);
  expect(nativeCompactionPoint("claudeAgent", 1_000_000, NaN)).toBeUndefined();
  expect(nativeCompactionPoint("codex", 272_000)).toBe(244_800);
  expect(nativeCompactionPoint("geminiAgent", 1_000_000)).toBe(500_000);
  expect(nativeCompactionPoint("qwenAgent", 200_000)).toBe(167_000);
  expect(nativeCompactionPoint("piAgent", 131_072)).toBe(114_688);
  for (const kind of ["kimiAgent", "grokAgent", "opencodeGo", "customAcp"]) expect(nativeCompactionPoint(kind, 256_000)).toBe(204_800);
  // Engines rebuilt from the stored transcript have no session to lose.
  for (const kind of ["openai-compat", "grok", "minimax", "boxAgent"]) expect(nativeCompactionPoint(kind, 128_000)).toBeUndefined();
  // Sagax's own budget stays under the engine's point, Gemini's included.
  const gemini = nativeCompactionPoint("geminiAgent", 1_000_000);
  expect(compactBudget(1_000_000, undefined, gemini)).toBe(450_000);
  expect(shouldCompact({ contextTokens: 460_000, estimatedBytes: 0, budget: compactBudget(1_000_000, undefined, gemini), window: 1_000_000, nativeCompactAt: gemini })).toBe(true);
  expect(shouldCompact({ contextTokens: 440_000, estimatedBytes: 0, budget: compactBudget(1_000_000, undefined, gemini), window: 1_000_000, nativeCompactAt: gemini })).toBe(false);
});

it("folds Grok threads at half the window by default, configurable, and leaves other engines alone", () => {
  expect(defaultCompactAt("grokAgent", {})).toBe(0.5);
  expect(defaultCompactAt("grokAgent", { SAGAX_GROK_COMPACT_PERCENT: "35" })).toBe(0.35);
  expect(defaultCompactAt("grokAgent", { SAGAX_GROK_COMPACT_PERCENT: "nonsense" })).toBe(0.5);
  expect(defaultCompactAt("grokAgent", { SAGAX_GROK_COMPACT_PERCENT: "95" })).toBe(0.5);
  expect(defaultCompactAt("claudeAgent", {})).toBeUndefined();
  const window = 256_000;
  const native = nativeCompactionPoint("grokAgent", window);
  const budget = compactBudget(window, defaultCompactAt("grokAgent", {}), native);
  expect(budget).toBe(128_000);
  expect(shouldCompact({ contextTokens: 127_000, estimatedBytes: 0, budget, window, nativeCompactAt: native })).toBe(false);
  expect(shouldCompact({ contextTokens: 129_000, estimatedBytes: 0, budget, window, nativeCompactAt: native })).toBe(true);
});
