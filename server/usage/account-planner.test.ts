import { describe, expect, it } from "vitest";

import { PLAN_HISTORY_MS, buildAccountProgram, planAccounts, type PlannerAccount, type PlannerInput } from "./account-planner.ts";
import { solveLinearProgram } from "./lp-simplex.ts";

const NOW = Date.UTC(2026, 10, 19, 15, 0);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

function account(instanceId: string, used: number | null, resetsInMin: number | null, scale: number | null = 1): PlannerAccount {
  return {
    instanceId,
    label: `Account ${instanceId.toUpperCase()}`,
    fiveHour: { usedPercent: used, resetsAt: resetsInMin === null ? null : NOW + resetsInMin * MIN },
    weekly: { usedPercent: null, resetsAt: null },
    scale,
  };
}
const plan = (extra: Partial<PlannerInput> & Pick<PlannerInput, "accounts">): PlannerInput => ({
  now: NOW, threshold: 80, demand: Array.from({ length: 8 }, () => 30), history: 8 * DAY, fresh: true, ...extra,
});

describe("the rolling horizon planner (M-20261119-016)", () => {
  it("uses first the quota a near reset would lose (a known case)", () => {
    // A: 60 % left, resets in 1 h; B: 90 % left, resets in 4 h; 30 units an hour at 1 point each
    const result = planAccounts(plan({ accounts: [account("a", 40, 60), account("b", 10, 240)] }));
    expect(result.status).toBe("planned");
    if (result.status !== "planned") return;
    // only the first decision is applied: hour 0 runs on A, whose 60 % would be lost at its reset
    expect(result.shares).toEqual({ a: 30, b: 0 });
    expect(result.pick).toEqual({ instanceId: "a", why: { kind: "planned", resetsAt: NOW + 60 * MIN, unused: 60 } });
  });

  it("serves all the demand it can under the 5-hour caps, and spreads it", () => {
    const input = plan({ accounts: [account("a", 90, 45), account("b", 0, null)], demand: [50, 50, 50, 0, 0, 0, 0, 0] });
    const accounts = input.accounts;
    const { objective, constraints, index } = buildAccountProgram(input, accounts, [1, 1]);
    const solution = solveLinearProgram({ objective, constraints });
    expect(solution.status).toBe("optimal");
    if (solution.status !== "optimal") return;
    // A has 10 points left before its reset in 45 min, then a whole window
    expect(solution.values[index(0, 0)]).toBeCloseTo(10, 6);
    expect(solution.values[index(1, 0)]).toBeCloseTo(40, 6);
    const served = solution.values.reduce((sum, value) => sum + value, 0);
    expect(served).toBeCloseTo(150, 6);
  });

  it("keeps a conversation on its account under the threshold while the plan serves this hour there", () => {
    const result = planAccounts(plan({ accounts: [account("a", 20, 240), account("b", 10, 260)], current: "b", fresh: false }));
    expect(result.status).toBe("planned");
    if (result.status === "planned") expect(result.pick).toEqual({ instanceId: "b", why: { kind: "keeps", used: 10, threshold: 80 } });
  });

  it("moves a conversation earlier when another account is about to lose its quota", () => {
    const result = planAccounts(plan({ accounts: [account("a", 40, 60), account("b", 10, 240)], current: "b", fresh: false }));
    expect(result.status).toBe("planned");
    if (result.status === "planned") expect(result.pick.instanceId).toBe("a");
  });

  it("falls back on the simple rule with under 7 days of history", () => {
    const result = planAccounts(plan({ accounts: [account("a", 40, 60), account("b", 10, 240)], history: PLAN_HISTORY_MS - DAY }));
    expect(result).toMatchObject({ status: "fallback", reason: "history" });
  });

  it("falls back when no account's scale is known, or nothing is expected", () => {
    expect(planAccounts(plan({ accounts: [account("a", 40, 60, null), account("b", 10, 240, null)] }))).toMatchObject({ status: "fallback", reason: "scale" });
    expect(planAccounts(plan({ accounts: [account("a", 40, 60), account("b", 10, 240)], demand: Array.from({ length: 8 }, () => 0) }))).toMatchObject({ status: "fallback", reason: "demand" });
  });

  it("falls back past 50 ms", () => {
    let at = 0;
    const clock = () => (at += 60);
    const result = planAccounts(plan({ accounts: [account("a", 40, 60), account("b", 10, 240)] }), { clock });
    expect(result).toMatchObject({ status: "fallback", reason: "time" });
  });

  it("never plans on an account at its limit", () => {
    const held = { ...account("a", 40, 60), blocked: true };
    const result = planAccounts(plan({ accounts: [held, account("b", 10, 240), account("c", 50, 200)] }));
    expect(result.status).toBe("planned");
    if (result.status === "planned") expect(Object.keys(result.shares)).toEqual(["b", "c"]);
  });
});
