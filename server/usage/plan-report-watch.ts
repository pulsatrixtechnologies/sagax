// M-20261126-101 (#5403): a mode's pick skips an account the payer's usage
// report shows at 100 % (spentPlans, server/index.ts). Only an app asking for
// the report wrote that reading, so one gone stale (an early reset, extra
// usage bought since) kept the account out until the old reset whenever no
// desktop was open. While a payer has such a reading, the limit clock of that
// payer (limit-resets.ts) reads usage again on its own cadence, and what it
// reads is noted as an app's reading is (notePlanLimits): one reading, one
// verdict.
import { personPayer } from "../models/model-access-refusals.ts";
import { SERVER_LIMIT_SCOPE } from "./limit-reset-host.ts";
import type { PlanUsageReport } from "./plan-usage.ts";

/** The limit clock that reads a payer's accounts (payer: autoPayerKey, "server" on a solo server). */
export function limitScopeOfPayer(payer: string): string {
  return payer === SERVER_LIMIT_SCOPE ? SERVER_LIMIT_SCOPE : personPayer(payer);
}

/** The payer whose accounts a limit clock reads. */
export function payerOfLimitScope(scope: string): string {
  return scope.startsWith("person:") ? scope.slice("person:".length) : SERVER_LIMIT_SCOPE;
}

/** The two options createLimitResetHost takes for this. */
export function createPlanReportWatch(deps: {
  /** Per payer and engine, until when the last report showed its plan spent. */
  spentPlans: ReadonlyMap<string, number>;
  /** Notes a report for a payer (notePlanLimits). */
  note: (report: PlanUsageReport, payer: string) => void;
  now?: () => number;
}): { reportHeld: (scope: string) => boolean; onScopeUsage: (scope: string, report: PlanUsageReport) => void } {
  return {
    reportHeld(scope) {
      const prefix = `${payerOfLimitScope(scope)}\u0000`;
      const now = deps.now?.() ?? Date.now();
      for (const [key, until] of deps.spentPlans) if (until > now && key.startsWith(prefix)) return true;
      return false;
    },
    onScopeUsage(scope, report) {
      deps.note(report, payerOfLimitScope(scope));
    },
  };
}
