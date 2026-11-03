import { describe, expect, it } from "vitest";

import { TYPING_PREWAKE_WINDOW_MS, TypingPrewakeThrottle } from "./sandbox-typing-prewake.ts";

describe("typing pre-wake throttle", () => {
  it("asks once per person and bot per window", () => {
    const throttle = new TypingPrewakeThrottle();
    expect(throttle.take("pr_a", "b1", 0)).toBe(true);
    expect(throttle.take("pr_a", "b1", 30_000)).toBe(false);
    expect(throttle.take("pr_a", "b2", 30_000)).toBe(true);
    expect(throttle.take("pr_b", "b1", 30_000)).toBe(true);
    expect(throttle.take("pr_a", "b1", TYPING_PREWAKE_WINDOW_MS)).toBe(true);
  });
});
