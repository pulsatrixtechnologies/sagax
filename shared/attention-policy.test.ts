import { describe, expect, it } from "vitest";

import {
  attentionLogLine,
  channelsForLevel,
  DEFAULT_LEVEL_CHANNELS,
  decideAttention,
  levelChannelsValue,
  levelOfNotification,
  readLevelChannels,
} from "./attention-policy.ts";
import { attentionVectors, vectorInput } from "./attention-policy-vectors.ts";
import type { ReachChannelId } from "./reach-me.ts";

describe("the one attention policy (#4250 S2, shared vectors)", () => {
  it("has cases", () => expect(attentionVectors.cases.length).toBeGreaterThan(10));
  for (const vector of attentionVectors.cases) {
    it(vector.name, () => {
      const decision = decideAttention(vectorInput(vector.input));
      expect({ verdict: decision.verdict, level: decision.level, reason: decision.reason, channels: decision.channels }).toEqual({
        verdict: vector.expected.verdict, level: vector.expected.level, reason: vector.expected.reason, channels: vector.expected.channels,
      });
      if (vector.expected.counts !== undefined) expect(decision.counts).toBe(vector.expected.counts);
    });
  }
});

describe("level and channels", () => {
  it("the writer's level wins over the kind's", () => {
    expect(levelOfNotification({ kind: "approval", botId: "b" })).toBe("urgent");
    expect(levelOfNotification({ kind: "done", botId: "b" })).toBe("card");
    expect(levelOfNotification({ kind: "done", botId: "b", level: "urgent" })).toBe("urgent");
    expect(levelOfNotification({ kind: "approval", botId: "b", level: "nonsense" })).toBe("urgent");
  });
  it("reads the stored channels per level, the default for what it does not name", () => {
    expect(readLevelChannels(null)).toEqual(DEFAULT_LEVEL_CHANNELS);
    expect(readLevelChannels("not json")).toEqual(DEFAULT_LEVEL_CHANNELS);
    const value = levelChannelsValue({ card: ["push"], urgent: ["push", "sms", "sms", "pager" as ReachChannelId] });
    expect(readLevelChannels(value)).toEqual({ card: ["push"], urgent: ["push", "sms"] });
    expect(readLevelChannels(JSON.stringify({ card: [] }))).toEqual({ card: [], urgent: DEFAULT_LEVEL_CHANNELS.urgent });
  });
  it("a bot with no channel saved reaches by push; FYI never leaves the app", () => {
    expect(channelsForLevel("card", null, null)).toEqual(["push"]);
    expect(channelsForLevel("fyi", null, ["push", "sms"])).toEqual([]);
  });
  it("one log line names the decision, never the words", () => {
    const line = attentionLogLine(decideAttention({ kind: "approval", botId: "b1", at: 0 }), { kind: "approval", bot: "b1", person: undefined });
    expect(line).toBe("[attention] kind=approval bot=b1 level=urgent verdict=ring reason=urgent channels=push");
  });
});
