// 2026-11-02: a routine run's permission waits as long as its turn says (its
// person is not watching it ask); a live chat keeps the 15 minutes.
import { describe, expect, it } from "vitest";

import { approvalWaitMs } from "./session-permission.ts";

describe("approvalWaitMs", () => {
  it("is the turn's own wait when it gives one, else 15 minutes", () => {
    expect(approvalWaitMs(2 * 60 * 60_000)).toBe(2 * 60 * 60_000);
    expect(approvalWaitMs(undefined)).toBe(15 * 60_000);
    expect(approvalWaitMs(0)).toBe(15 * 60_000);
    expect(approvalWaitMs(Number.NaN)).toBe(15 * 60_000);
  });
});
