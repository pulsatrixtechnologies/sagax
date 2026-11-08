// #2757: plan usage history, one row per window period, peak share kept.
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { PlanProviderRow, PlanUsageReport } from "./plan-usage.ts";
import { createPlanHistoryStore, mergePlanSnapshot, planHistoryFile } from "./plan-history.ts";

const closed = { available: false, remainingPercent: null, usedPercent: null, resetsAt: null };
function row(fiveHour: number | null, fiveReset: string, weekly: number | null, weekReset: string, state: PlanProviderRow["state"] = "windows"): PlanProviderRow {
  const window = (used: number | null, resetsAt: string) => used === null ? closed : { available: true, remainingPercent: 100 - used, usedPercent: used, resetsAt };
  return {
    id: "claude", name: "Claude", driver: "claude", plan: "max", ok: state === "windows", error: null, state, access: "subscription",
    instanceId: "claude", failure: null, fiveHour: window(fiveHour, fiveReset), weekly: window(weekly, weekReset), extra: [], models: [],
  };
}
const report = (fetchedAt: string, ...providers: PlanProviderRow[]): PlanUsageReport => ({ fetchedAt, providers });
const empty = { version: 1 as const, updatedAt: null, accounts: [], periods: [] };

describe("mergePlanSnapshot", () => {
  it("keeps the peak of a period and folds a reset that moved by seconds into it", () => {
    let history = mergePlanSnapshot(empty, report("2026-11-03T10:00:00.000Z", row(20, "2026-11-03T14:00:00.000Z", 40, "2026-11-08T00:00:00.000Z")));
    history = mergePlanSnapshot(history, report("2026-11-03T12:00:00.000Z", row(65, "2026-11-03T14:00:04.000Z", 46, "2026-11-08T00:00:02.000Z")));
    history = mergePlanSnapshot(history, report("2026-11-03T15:00:00.000Z", row(3, "2026-11-03T19:00:00.000Z", 47, "2026-11-08T00:00:00.000Z")));
    const five = history.periods.filter((period) => period.window === "5-hour");
    expect(five.map((period) => [period.resetsAt, period.peakPercent, period.lastPercent])).toEqual([
      ["2026-11-03T19:00:00.000Z", 3, 3],
      ["2026-11-03T14:00:00.000Z", 65, 65],
    ]);
    const week = history.periods.find((period) => period.window === "weekly")!;
    expect(week).toMatchObject({ peakPercent: 47, samples: 3, startsAt: "2026-11-01T00:00:00.000Z" });
    expect(history.accounts).toEqual([{ id: "claude", name: "Claude", driver: "claude", plan: "max" }]);
  });

  it("ignores rows without windows and leaves the history as it was", () => {
    const history = mergePlanSnapshot(empty, report("2026-11-03T10:00:00.000Z", row(null, "", null, "", "signed-out")));
    expect(history).toBe(empty);
  });

  it("drops periods older than the kept span", () => {
    let history = mergePlanSnapshot(empty, report("2025-01-01T00:00:00.000Z", row(10, "2025-01-01T04:00:00.000Z", null, "")));
    history = mergePlanSnapshot(history, report("2026-11-03T10:00:00.000Z", row(10, "2026-11-03T14:00:00.000Z", null, "")));
    expect(history.periods.map((period) => period.resetsAt)).toEqual(["2026-11-03T14:00:00.000Z"]);
  });
});

describe("createPlanHistoryStore", () => {
  let dir = "";
  afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

  it("writes one 0600 file per scope, counts a re-announced report once, and reads it back after a restart", () => {
    dir = mkdtempSync(join(tmpdir(), "plan-history-"));
    const store = createPlanHistoryStore(dir);
    const first = report("2026-11-03T10:00:00.000Z", row(20, "2026-11-03T14:00:00.000Z", 40, "2026-11-08T00:00:00.000Z"));
    store.record(first, "pr_ada");
    store.record(first, "pr_ada");
    const file = planHistoryFile(dir, "pr_ada");
    expect(file).not.toContain("pr_ada");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(file, "utf8")).periods).toHaveLength(2);
    const reopened = createPlanHistoryStore(dir).read("pr_ada", 90, Date.parse("2026-11-04T00:00:00.000Z"));
    expect(reopened.periods.map((period) => period.samples)).toEqual([1, 1]);
    expect(createPlanHistoryStore(dir).read("server").periods).toEqual([]);
  });
});
