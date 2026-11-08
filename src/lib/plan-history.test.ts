// #2757: plan usage history rows for the Usage page.
import { describe, expect, it } from "vitest";
import { formatLimitShare, planHistoryAccounts, planHistoryGroups, type PlanHistory, type PlanPeriod } from "./plan-history";

const period = (window: PlanPeriod["window"], startsAt: string, resetsAt: string, peakPercent: number, account = "claude"): PlanPeriod => ({
  account, name: account === "claude" ? "Claude" : "Codex", driver: account, window, startsAt, resetsAt, peakPercent, lastPercent: peakPercent,
  firstSeenAt: startsAt, lastSeenAt: startsAt, samples: 4,
});

const history: PlanHistory = {
  updatedAt: "2026-11-07T12:00:00.000Z",
  accounts: [{ id: "claude", name: "Claude", driver: "claude", plan: "max" }, { id: "codex", name: "Codex", driver: "codex", plan: "plus" }],
  periods: [
    period("weekly", "2026-11-01T00:00:00.000Z", "2026-11-08T00:00:00.000Z", 47),
    period("weekly", "2026-10-25T00:00:00.000Z", "2026-11-01T00:00:00.000Z", 88),
    period("5-hour", "2026-11-03T09:00:00.000Z", "2026-11-03T14:00:00.000Z", 65),
    period("5-hour", "2026-10-30T09:00:00.000Z", "2026-10-30T14:00:00.000Z", 30),
    period("5-hour", "2026-11-05T09:00:00.000Z", "2026-11-05T14:00:00.000Z", 12, "codex"),
  ],
};

describe("planHistoryGroups", () => {
  it("makes one row per week, newest first, with its own sessions inside", () => {
    const groups = planHistoryGroups(history, "claude", Date.parse("2026-11-07T12:00:00.000Z"));
    expect(groups.map((group) => [group.kind, group.percent, group.current, group.sessions.map((session) => session.peakPercent)])).toEqual([
      ["weekly", 47, true, [65]],
      ["weekly", 88, false, [30]],
    ]);
  });

  it("groups 5-hour sessions by day for a plan without a weekly window", () => {
    const groups = planHistoryGroups(history, "codex", Date.parse("2026-11-07T12:00:00.000Z"));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "day", percent: 12, current: false });
  });

  it("is empty without history", () => {
    expect(planHistoryGroups(null, "claude")).toEqual([]);
  });
});

describe("formatLimitShare and planHistoryAccounts", () => {
  it("says <1% for a share above zero that rounds to none", () => {
    expect([formatLimitShare(0), formatLimitShare(0.2), formatLimitShare(47.4), formatLimitShare(130)]).toEqual(["0%", "<1%", "47%", "100%"]);
  });

  it("lists the accounts with periods, the busiest first", () => {
    expect(planHistoryAccounts(history).map((account) => account.id)).toEqual(["claude", "codex"]);
  });
});
