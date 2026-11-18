import { describe, expect, it } from "vitest";

import {
  dedupeLiveLines,
  formatLiveDuration,
  isPhoneCallPhase,
  liveCallElapsed,
  liveTimerStart,
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

describe("live call lines and timer", () => {
  it("drops a line sent twice, on speaker and instant, or on the same words in a row when it has no instant", () => {
    const lines = [
      { speaker: "bot", text: "Hello", at: 5 },
      { speaker: "bot", text: "Hello", at: 5 },
      { speaker: "callee", text: "Hello", at: 5 },
      { speaker: "bot", text: "Again" },
      { speaker: "bot", text: "Again" },
      { speaker: "bot", text: "Again", at: 9 },
    ];
    expect(dedupeLiveLines(lines).map((line) => `${line.speaker}:${line.text}:${line.at ?? "-"}`)).toEqual(["bot:Hello:5", "callee:Hello:5", "bot:Again:-", "bot:Again:9"]);
  });

  it("the timer starts at the pickup, never while dialing or ringing", () => {
    expect(liveTimerStart({ phase: "dialing", liveStartedAt: 1 })).toBeUndefined();
    expect(liveTimerStart({ phase: "ringing", liveStartedAt: 1 })).toBeUndefined();
    expect(liveTimerStart({ phase: "in_call", liveStartedAt: 1, liveAnsweredAt: 7 })).toBe(7);
    expect(liveTimerStart({ phase: "in_call", liveStartedAt: 1 })).toBe(1);
  });
});
