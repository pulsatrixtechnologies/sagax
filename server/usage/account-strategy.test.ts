import { describe, expect, it } from "vitest";

import { HOUR_MS, WEEK_MS, pickAccountByRule, rankAccounts, weeklyAhead, type StrategyAccount, type StrategyInput } from "./account-strategy.ts";

const NOW = Date.UTC(2026, 10, 19, 15, 0);
const MIN = 60_000;

/** A fictive account: 5-hour used and reset in minutes from NOW, weekly used and reset in hours. */
function account(instanceId: string, five: [number | null, number | null], week: [number | null, number | null] = [null, null], blocked = false): StrategyAccount {
  return {
    instanceId,
    label: `Account ${instanceId.toUpperCase()}`,
    fiveHour: { usedPercent: five[0], resetsAt: five[1] === null ? null : NOW + five[1] * MIN },
    weekly: { usedPercent: week[0], resetsAt: week[1] === null ? null : NOW + week[1] * HOUR_MS },
    blocked,
  };
}
const input = (accounts: StrategyAccount[], extra: Partial<StrategyInput> = {}): StrategyInput => ({
  strategy: "high-water", threshold: 80, now: NOW, accounts, fresh: false, ...extra,
});

describe("High-water (D-20261119-048)", () => {
  it("keeps a conversation on its account under the threshold, for its prompt cache", () => {
    const kept = pickAccountByRule(input([account("a", [70, 200]), account("b", [5, 240])], { current: "a" }));
    expect(kept).toEqual({ instanceId: "a", why: { kind: "keeps", used: 70, threshold: 80 } });
  });

  it("moves to the next account when the current one reaches its threshold in the 5-hour window", () => {
    const pick = pickAccountByRule(input([account("a", [82, 200]), account("b", [10, 240]), account("c", [20, 100])], { current: "a" }));
    // the quota that expires first among those under the threshold: c resets before b
    expect(pick).toEqual({ instanceId: "c", why: { kind: "threshold", from: "Account A", used: 82, threshold: 80 } });
  });

  it("moves earlier when another account is about to lose a lot of unused quota at a near reset", () => {
    const pick = pickAccountByRule(input([account("a", [30, 240]), account("b", [40, 40])], { current: "a" }));
    expect(pick).toEqual({ instanceId: "b", why: { kind: "expiring", resetsAt: NOW + 40 * MIN, unused: 60 } });
  });

  it("stays when its own window is about to lose as much", () => {
    const pick = pickAccountByRule(input([account("a", [30, 20]), account("b", [40, 40])], { current: "a" }));
    expect(pick?.instanceId).toBe("a");
  });

  it("does not move early for a little unused quota", () => {
    const pick = pickAccountByRule(input([account("a", [30, 240]), account("b", [75, 40])], { current: "a" }));
    expect(pick?.instanceId).toBe("a");
  });

  it("a new conversation takes the quota that expires first among the accounts under the threshold", () => {
    const pick = pickAccountByRule(input([account("a", [10, 280]), account("b", [50, 90]), account("c", [85, 10])], { current: "a", fresh: true }));
    expect(pick).toEqual({ instanceId: "b", why: { kind: "expiresFirst", resetsAt: NOW + 90 * MIN } });
  });

  it("a window not opened yet comes after one that resets, then the order of Providers", () => {
    const pick = pickAccountByRule(input([account("a", [null, null]), account("b", [0, null])], { fresh: true }));
    expect(pick).toEqual({ instanceId: "a", why: { kind: "first" } });
  });

  it("every account past the threshold: the one with the most room", () => {
    const pick = pickAccountByRule(input([account("a", [95, 200]), account("b", [85, 100])], { current: "a" }));
    expect(pick?.instanceId).toBe("b");
    const stays = pickAccountByRule(input([account("a", [84, 200]), account("b", [90, 100])], { current: "a" }));
    expect(stays).toEqual({ instanceId: "a", why: { kind: "mostRoom", threshold: 80 } });
  });

  it("follows the person's own threshold", () => {
    const pick = pickAccountByRule(input([account("a", [60, 200]), account("b", [10, 240])], { current: "a", threshold: 50 }));
    expect(pick?.why).toMatchObject({ kind: "threshold", used: 60, threshold: 50 });
  });
});

describe("the weekly guard", () => {
  it("says an account uses its week faster than time passes", () => {
    // 2 days into the week (5 days left): 2/7 = 29 % elapsed
    expect(weeklyAhead(account("a", [0, null], [50, 5 * 24]), NOW)).toBe(true);
    expect(weeklyAhead(account("a", [0, null], [20, 5 * 24]), NOW)).toBe(false);
    expect(weeklyAhead(account("a", [0, null], [null, null]), NOW)).toBe(false);
  });

  it("puts that account last", () => {
    const pick = pickAccountByRule(input([account("a", [10, 30], [60, 5 * 24]), account("b", [10, 200], [10, 5 * 24])], { fresh: true }));
    expect(pick?.instanceId).toBe("b");
    const ranked = rankAccounts({ strategy: "high-water", threshold: 80, now: NOW, accounts: [account("a", [10, 30], [60, 5 * 24]), account("b", [10, 200], [10, 5 * 24])] });
    expect(ranked.map((one) => one.instanceId)).toEqual(["b", "a"]);
  });
});

describe("Most-free", () => {
  it("gives a new conversation the account with the most quota left", () => {
    const pick = pickAccountByRule(input([account("a", [40, 100]), account("b", [10, 200], [70, WEEK_MS / HOUR_MS]), account("c", [25, 200])], { strategy: "most-free", fresh: true }));
    // b has 90 % of its window but 30 % of its week: c has the most left (75 %)
    expect(pick).toEqual({ instanceId: "c", why: { kind: "mostFree", remaining: 75 } });
  });

  it("leaves a conversation already started on its account", () => {
    const pick = pickAccountByRule(input([account("a", [90, 100]), account("b", [0, null])], { strategy: "most-free", current: "a" }));
    expect(pick).toEqual({ instanceId: "a", why: { kind: "started" } });
  });
});

describe("Fill-up", () => {
  it("fills the accounts in the order of the Providers list", () => {
    const pick = pickAccountByRule(input([account("a", [100, 60]), account("b", [70, 100]), account("c", [0, null])], { strategy: "fill-up", fresh: true }));
    expect(pick).toEqual({ instanceId: "b", why: { kind: "fillUp" } });
  });

  it("moves a conversation once its account has no room left", () => {
    const pick = pickAccountByRule(input([account("a", [100, 60]), account("b", [70, 100])], { strategy: "fill-up", current: "a" }));
    expect(pick).toEqual({ instanceId: "b", why: { kind: "full", from: "Account A" } });
  });
});

describe("an account at its limit", () => {
  it("is never picked, whatever the strategy", () => {
    for (const strategy of ["high-water", "most-free", "fill-up"] as const) {
      const pick = pickAccountByRule(input([account("a", [0, null], [null, null], true), account("b", [60, 100])], { strategy, fresh: true }));
      expect(pick?.instanceId).toBe("b");
    }
  });

  it("leaves nothing to pick when every account is held", () => {
    expect(pickAccountByRule(input([account("a", [0, null], [null, null], true), account("b", [100, 100])], { fresh: true }))).toBeNull();
  });
});
