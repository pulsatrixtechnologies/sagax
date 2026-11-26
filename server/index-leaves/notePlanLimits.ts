// @ts-nocheck
/** notePlanLimits (#1388). Pure move from server/index.ts. */
import { limitScopeOfPayer } from "../usage/plan-report-watch.ts";
export type Host = Record<string, any>;

export function createNotePlanLimits(getHost: () => Host): any {
function notePlanLimits(report: PlanUsageReport, scope: string) {
  const host = getHost();

  const payer = scope.toLowerCase();
  const now = Date.now();
  let spent = false;
  for (const row of report.providers) {
    const until = host.spentPlanUntil(row);
    // #2192: fullest window used-percent per payer and engine, from the last report.
    const used = host.planUsedPercent(row);
    // #0867: every instance folded on this row's login shares its plan, so the
    // quick pick and the same-provider rotation skip all of them together.
    const ids = new Set([row.instanceId ?? row.id, ...(row.instanceIds ?? [])].filter(Boolean));
    // #5014: each window's reading, for the account strategy (account-meter.ts)
    if (row.state === undefined || row.state === "windows") host.accountMeter?.notePlan(payer, [...ids], row);
    for (const id of ids) {
      const key = `${payer}\u0000${id}`;
      if (until !== null && until > now) { host.spentPlans.set(key, until); spent = true; }
      else host.spentPlans.delete(key);
      if (used !== null) host.planUsedPercents.set(key, used);
      else host.planUsedPercents.delete(key);
      // A turn that works on any of them clears the hold on all of them (planWorked).
      if (host.planSiblings) {
        if (ids.size > 1) host.planSiblings.set(key, [...ids]);
        else host.planSiblings.delete(key);
      }
    }
  }
  while (host.spentPlans.size > 2_000) host.spentPlans.delete(host.spentPlans.keys().next().value as string);
  while (host.planUsedPercents.size > 2_000) host.planUsedPercents.delete(host.planUsedPercents.keys().next().value as string);
  while (host.planSiblings && host.planSiblings.size > 2_000) host.planSiblings.delete(host.planSiblings.keys().next().value as string);
  // M-20261126-101: a plan read as spent keeps its account out of the modes'
  // picks, so the payer's limit clock exists and reads usage again by itself
  // (plan-report-watch.ts); the next reading that shows room clears it here.
  if (spent) host.limitReset?.clockFor(limitScopeOfPayer(payer));

}
  return notePlanLimits;
}

/** A turn on this engine worked for this payer, so the plan window its login
 * shares is not spent: the hold and the used percent go for every instance
 * folded on that login (#0867), not only the one that ran. */
export function createPlanWorked(getHost: () => Host): (payer: string, instanceId: string) => void {
  return function planWorked(payer: string, instanceId: string) {
    const host = getHost();
    const key = `${payer}\u0000${instanceId}`;
    const ids = new Set([instanceId, ...(host.planSiblings?.get(key) ?? [])]);
    // #5014: a reading that said the window was used up was wrong; the others stand
    host.accountMeter?.worked(payer, [...ids]);
    for (const id of ids) {
      const sibling = `${payer}\u0000${id}`;
      host.spentPlans.delete(sibling);
      host.planUsedPercents.delete(sibling);
      host.planSiblings?.delete(sibling);
    }
  };
}
