import { describe, expect, it } from "vitest";

import {
  hasSensitiveTopic,
  redactPinDigits,
  scrubCallResult,
  scrubSummaryPoints,
  scrubTranscript,
} from "./phone-transcript-scrub.ts";

describe("redactPinDigits", () => {
  it("redacts 4 to 8 digit PIN-shaped runs", () => {
    expect(redactPinDigits("my pin is 1234 thanks")).toBe("my pin is [PIN redacted] thanks");
    expect(redactPinDigits("code 12-34-56")).toBe("code [PIN redacted]");
    expect(redactPinDigits("ok 98765432 done")).toBe("ok [PIN redacted] done");
  });

  it("leaves longer digit runs and short ones alone", () => {
    expect(redactPinDigits("call +15145550142")).toContain("15145550142");
    expect(redactPinDigits("room 12")).toBe("room 12");
  });
});

describe("hasSensitiveTopic", () => {
  it("flags money, health, credentials and family", () => {
    expect(hasSensitiveTopic("ask about the billing total")).toBe(true);
    expect(hasSensitiveTopic("santé de maman")).toBe(true);
    expect(hasSensitiveTopic("mot de passe du wifi")).toBe(true);
    expect(hasSensitiveTopic("calendar for tomorrow")).toBe(false);
  });
});

describe("scrubSummaryPoints", () => {
  it("drops inference and sensitive points, keeps plain restatements", () => {
    expect(scrubSummaryPoints([
      "They said the meeting is at 3",
      "Probably busy tomorrow",
      "Asked about the salary",
      "",
    ])).toEqual(["They said the meeting is at 3"]);
  });
});

describe("scrubTranscript and scrubCallResult", () => {
  it("redacts PIN digits and sensitive lines in a transcript", () => {
    const lines = scrubTranscript([
      { speaker: "bot", text: "What is the code?" },
      { speaker: "callee", text: "It is 4321" },
      { speaker: "callee", text: "Also my salary went up" },
    ]);
    expect(lines[1]?.text).toBe("It is [PIN redacted]");
    expect(lines[2]?.text).toBe("[redacted: not for the phone]");
  });

  it("scrubs a whole call_result payload", () => {
    const scrubbed = scrubCallResult({
      points: ["Meeting at 3", "Je pense qu'il est fâché"],
      commitments: ["Call back about billing"],
      transcript: [{ speaker: "callee" as const, text: "PIN 998877" }],
    });
    expect(scrubbed.points).toEqual(["Meeting at 3"]);
    expect(scrubbed.commitments).toEqual([]);
    expect(scrubbed.transcript?.[0]?.text).toBe("PIN [PIN redacted]");
  });
});
