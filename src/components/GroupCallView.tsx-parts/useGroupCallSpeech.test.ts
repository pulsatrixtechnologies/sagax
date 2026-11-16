import { describe, expect, it } from "vitest";

import { CALL_ENDPOINT_MS } from "./useGroupCallSpeech";

// upstream #5557: at 850 ms of silence the bot took the turn during a short
// thinking pause; a call now waits 1.7 s.
describe("CALL_ENDPOINT_MS", () => {
  it("keeps listening through a short thinking pause and still ends a finished turn", () => {
    expect(CALL_ENDPOINT_MS).toBeGreaterThanOrEqual(1_500);
    expect(CALL_ENDPOINT_MS).toBeLessThanOrEqual(2_500);
  });
});
