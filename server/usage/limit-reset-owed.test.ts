// Upstream #5958: a usage read in the minute after a limit reset already shows
// the next window; re-timing a limit-reset automation then skipped its run.
import { describe, expect, it } from "vitest";

import { AFTER_RESET_MS, type LimitResetSchedule } from "../../shared/limit-reset.ts";
import { createLimitResetHost } from "./limit-reset-host.ts";
import { limitResetRunOwed } from "./limit-reset-owed.ts";
import type { PlanProviderRow, PlanUsageReport } from "./plan-usage.ts";

const HOUR = 3_600_000;
const RESET = Date.parse("2026-11-03T10:00:00Z");
const DUE = RESET + AFTER_RESET_MS;

function grokRow(resetsAt: number): PlanProviderRow {
  return {
    id: "grok", name: "Grok", driver: "grok", plan: null, ok: true, error: null, state: "windows", access: "subscription", instanceId: "grok", failure: null,
    fiveHour: { available: false, remainingPercent: null, usedPercent: null, resetsAt: null },
    weekly: { available: true, remainingPercent: 90, usedPercent: 10, resetsAt: new Date(resetsAt).toISOString() },
    extra: [], models: [],
  };
}

describe("limitResetRunOwed", () => {
  const routine = { id: "r1", enabled: true, nextRunAt: DUE, schedule: { type: "limit_reset" } };

  it("is owed once the reset passed and no run was made for it", () => {
    expect(limitResetRunOwed(routine, [], RESET + 30_000)).toBe(true);
    expect(limitResetRunOwed(routine, [{ routineId: "r1", scheduledFor: DUE }], RESET + 30_000)).toBe(false);
  });

  it("is not owed before the reset, when off, or when nothing is timed", () => {
    expect(limitResetRunOwed(routine, [], RESET - HOUR)).toBe(false);
    expect(limitResetRunOwed({ ...routine, enabled: false }, [], RESET + 30_000)).toBe(false);
    expect(limitResetRunOwed({ ...routine, nextRunAt: null }, [], RESET + 30_000)).toBe(false);
    expect(limitResetRunOwed({ ...routine, schedule: { type: "daily" } }, [], RESET + 30_000)).toBe(false);
  });
});

describe("the limit-reset host", () => {
  it("keeps a routine on the reset it still owes a run for, and re-times it once that run exists", async () => {
    let now = RESET + 30_000;
    const runs: Array<{ routineId: string; scheduledFor: number }> = [];
    const schedule: LimitResetSchedule = { type: "limit_reset", engine: "grok", repeat: "every_reset", at: DUE };
    const routine = { id: "r1", enabled: true, nextRunAt: DUE as number | null, schedule };
    const retimed: number[] = [];
    const host = createLimitResetHost({
      accounts: () => [{ id: "grok", name: "Grok", driver: "grok", environment: {}, instanceId: "grok" }],
      loadUsage: async (): Promise<PlanUsageReport> => ({ fetchedAt: new Date(now).toISOString(), providers: [grokRow(RESET + 168 * HOUR)] }),
      now: () => now,
      routines: () => [routine],
      retime: (_id, next) => { retimed.push(next.at as number); routine.schedule = next; },
      runs: () => runs,
    });
    await host.clock.refresh(true);
    expect(retimed).toEqual([]);
    runs.push({ routineId: "r1", scheduledFor: DUE });
    routine.nextRunAt = null;
    now += 10 * 60_000;
    await host.clock.refresh(true);
    expect(retimed).toEqual([RESET + 168 * HOUR + AFTER_RESET_MS]);
  });
});
