// M-20261126-101 (#5403, review H1): a mode's pick now skips an account the
// payer's usage report shows at 100 %. Only an app asking for the report
// (GET /api/plan-usage) wrote that reading, so with no desktop open (iPhone
// only, routines, unattended bots) a reading gone stale kept the account out
// until the old reset. While a payer has such a reading the server reads the
// report again by itself, on the limit clock's own cadence and by its reading.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNotePlanLimits } from "../index-leaves/notePlanLimits.ts";
import { createLimitFailoverHost, type LimitFailoverHostDeps } from "./limit-failover-host.ts";
import { LimitFailoverStore } from "./limit-failover.ts";
import { createLimitResetHost } from "./limit-reset-host.ts";
import { LIMIT_POLL_MS } from "./limit-resets.ts";
import { createPlanReportWatch, limitScopeOfPayer, payerOfLimitScope } from "./plan-report-watch.ts";
import { planUsedPercent, spentPlanUntil } from "./plan-usage-alerts.ts";
import { parseClaudeUsage, type PlanAccount, type PlanProviderRow, type PlanUsageReport } from "./plan-usage.ts";

const NOW = Date.parse("2026-11-26T15:00:00Z");
const HOUR = 3_600_000;
const iso = (at: number) => new Date(at).toISOString();
const PERSON = "p_0123456789abcdef";

/** The person's Claude account as the usage endpoint answers: the 5-hour window at `used` %. */
function claude(used: number): PlanProviderRow {
  return {
    id: "claude", name: "Claude", driver: "claude", ok: true, error: null, state: "windows", access: "subscription", instanceId: "claude", failure: null,
    ...parseClaudeUsage({
      five_hour: { utilization: used, resets_at: iso(NOW + 5 * HOUR) },
      seven_day: { utilization: 30, resets_at: iso(NOW + 100 * HOUR) },
    }),
  } as PlanProviderRow;
}
const report = (...providers: PlanProviderRow[]): PlanUsageReport => ({ fetchedAt: iso(Date.now()), providers });
const ENGINES = [{ instanceId: "claude", driverKind: "claudeAgent" }, { instanceId: "grok", driverKind: "grokAgent" }];

/** The server's pieces as server/index.ts wires them: the report's verdict
 * (spentPlans, written by notePlanLimits, read by the failover's planLimitUntil)
 * and the limit clocks. `payer`: "server" on a solo server, the person on an
 * organization server. */
function server(payer: string) {
  const usage = { now: report(claude(100)), reads: 0 };
  const spentPlans = new Map<string, number>();
  const leaf: Record<string, unknown> = { spentPlans, planUsedPercents: new Map<string, number>(), spentPlanUntil, planUsedPercent };
  const notePlanLimits = createNotePlanLimits(() => leaf) as (report: PlanUsageReport, scope: string) => void;
  const account = { id: "claude", name: "Claude", driver: "claude", environment: {}, instanceId: "claude" } as PlanAccount;
  const limitReset = createLimitResetHost({
    accounts: () => payer === "server" ? [account] : [],
    scopeAccounts: (scope) => scope === limitScopeOfPayer(payer) ? [account] : [],
    loadUsage: async () => { usage.reads += 1; return { ...usage.now, fetchedAt: iso(Date.now()) }; },
    routines: () => [],
    retime: () => undefined,
    ...createPlanReportWatch({ spentPlans, note: notePlanLimits }),
  });
  leaf.limitReset = limitReset;
  limitReset.start();
  const failover = createLimitFailoverHost({
    store: new LimitFailoverStore({ file: null, now: () => Date.now() }),
    now: () => Date.now(),
    config: () => undefined,
    planLimitUntil: (who: string, instanceId: string) => {
      const until = spentPlans.get(`${who}\u0000${instanceId}`);
      return until !== undefined && until > Date.now() ? until : null;
    },
  } as unknown as LimitFailoverHostDeps);
  /** The accounts a mode's pick and the menu's preview leave out for this payer. */
  const out = () => [...failover.autoExcluded(payer, ENGINES, "report")];
  /** An app asks for the report: GET /api/plan-usage notes it for the payer. */
  const appReads = () => notePlanLimits(report(...usage.now.providers), payer);
  return { usage, out, appReads, stop: () => limitReset.stop() };
}

describe("M-20261126-101: a report at 100 % is read again by the server while it keeps an account out", () => {
  let stop = () => {};
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW); });
  afterEach(() => { stop(); vi.useRealTimers(); });

  for (const payer of ["server", PERSON]) {
    it(`brings the account back at the next reading with no app asking (${payer === "server" ? "solo" : "organization"})`, async () => {
      const s = server(payer);
      stop = s.stop;
      s.appReads();
      expect(s.out()).toEqual(["claude"]);
      // the window is still used up at the server's own readings: the account stays out
      await vi.advanceTimersByTimeAsync(LIMIT_POLL_MS + 60_000);
      expect(s.usage.reads).toBeGreaterThan(0);
      expect(s.out()).toEqual(["claude"]);
      // the provider resets early (or the person buys extra usage); no app reads anything
      s.usage.now = report(claude(12));
      await vi.advanceTimersByTimeAsync(LIMIT_POLL_MS + 60_000);
      expect(s.out()).toEqual([]);
      // nothing is flagged any more: the server stops reading
      const reads = s.usage.reads;
      await vi.advanceTimersByTimeAsync(6 * LIMIT_POLL_MS);
      expect(s.usage.reads).toBe(reads);
    });
  }

  it("reads on the limit clock's cadence, never more often", async () => {
    const s = server("server");
    stop = s.stop;
    s.appReads();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(s.usage.reads).toBeGreaterThanOrEqual(10);
    expect(s.usage.reads).toBeLessThanOrEqual(60 * 60_000 / (LIMIT_POLL_MS - 1_000) + 1);
  });

  it("reads nothing by itself while no account is flagged", async () => {
    const s = server("server");
    stop = s.stop;
    s.usage.now = report(claude(40));
    s.appReads();
    await vi.advanceTimersByTimeAsync(6 * LIMIT_POLL_MS);
    expect(s.usage.reads).toBe(0);
    expect(s.out()).toEqual([]);
  });

  it("names the clock of the payer, and the payer of a clock", () => {
    expect(limitScopeOfPayer("server")).toBe("server");
    expect(limitScopeOfPayer(PERSON)).toBe(`person:${PERSON}`);
    for (const payer of ["server", PERSON]) expect(payerOfLimitScope(limitScopeOfPayer(payer))).toBe(payer);
  });
});
