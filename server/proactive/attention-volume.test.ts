/** #4528: one golden day of events, replayed through the attention policy.
 * The count is what would reach the person. CI runs this with the suite,
 * off this machine. */
import { describe, expect, it } from "vitest";

import { decideAttention, type LevelChannels } from "../../shared/attention-policy.ts";
import type { SignalLevel } from "../../shared/signal-levels.ts";

const QUIET = { start: "22:00", end: "07:00", timeZone: "UTC" };
const CHANNELS: LevelChannels = { card: ["push", "sms"], urgent: ["push", "sms"] };
const DAY = "2026-11-18";

interface DayEvent {
  at: string;
  level: SignalLevel;
  looking?: boolean;
}

const EVENTS: readonly DayEvent[] = [
  { at: "08:00", level: "card" },
  { at: "08:30", level: "card", looking: true },
  { at: "09:00", level: "card" },
  { at: "10:00", level: "fyi" },
  { at: "11:00", level: "card" },
  { at: "12:00", level: "card" },
  { at: "13:00", level: "urgent" },
  { at: "23:00", level: "card" },
  { at: "23:30", level: "urgent" },
];

describe("a golden day through the attention policy", () => {
  it("counts the interruptions and the channel deliveries", () => {
    let sent = 0;
    const verdicts: string[] = [];
    let deliveries = 0;
    for (const event of EVENTS) {
      const decision = decideAttention({
        level: event.level,
        at: Date.parse(`${DAY}T${event.at}:00Z`),
        quiet: QUIET,
        budget: 3,
        sentToday: sent,
        presence: event.looking ? { looking: true } : undefined,
        levelChannels: CHANNELS,
        botChannels: ["push", "sms"],
      });
      if (decision.counts) sent += 1;
      verdicts.push(decision.verdict);
      if (decision.verdict === "ring") deliveries += decision.channels.length;
    }
    expect(verdicts).toEqual(["ring", "seen", "ring", "hold", "ring", "hold", "ring", "hold", "ring"]);
    expect(verdicts.filter((verdict) => verdict === "ring")).toHaveLength(5);
    expect(deliveries).toBe(10);
  });
});
