import { describe, expect, it } from "vitest";

import {
  formatLiveDuration,
  isPhoneCallPhase,
  liveCallElapsed,
  parseDtmfDigits,
  PHONE_CALL_LIVE_PHASES,
} from "./phone-call-live.ts";

describe("phone-call-live helpers", () => {
  it("formats durations and elapsed seconds", () => {
    expect(formatLiveDuration(0)).toBe("0:00");
    expect(formatLiveDuration(67)).toBe("1:07");
    expect(formatLiveDuration(3661)).toBe("61:01");
    expect(liveCallElapsed(1_000, 1_000 + 67_000)).toBe(67);
    expect(liveCallElapsed(undefined, 1_000)).toBe(0);
    expect(liveCallElapsed(2_000, 1_000)).toBe(0);
  });

  it("accepts known phases and DTMF digits", () => {
    expect(isPhoneCallPhase("dialing")).toBe(true);
    expect(isPhoneCallPhase("on_hold")).toBe(true);
    expect(isPhoneCallPhase("waiting")).toBe(false);
    expect(PHONE_CALL_LIVE_PHASES.has("ended")).toBe(false);
    expect(parseDtmfDigits("1w2#")).toBe("1w2#");
    expect(parseDtmfDigits("nope")).toBeNull();
    expect(parseDtmfDigits("")).toBeNull();
  });
});
