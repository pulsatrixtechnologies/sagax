import { describe, expect, it } from "vitest";
import { voiceCostUsd } from "./voice-cost.ts";

describe("estimated cost of xAI voice", () => {
  it("prices speech by characters and transcription by audio size, as an estimate", () => {
    expect(voiceCostUsd("grok-tts", 1_000_000)).toBeCloseTo(4.2, 6);
    expect(voiceCostUsd("grok-tts", 1000)).toBeCloseTo(0.0042, 8);
    expect(voiceCostUsd("grok-stt", 32_000 * 3600)).toBeCloseTo(0.1, 6);
  });
  it("is never negative, never NaN, and null for a model it does not know", () => {
    expect(voiceCostUsd("grok-tts", -5)).toBe(0);
    expect(voiceCostUsd("grok-stt", Number.NaN)).toBe(0);
    expect(voiceCostUsd("grok-live", 10)).toBeNull();
  });
});
