// @ts-nocheck
/** notePlanLimits (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNotePlanLimits(getHost: () => Host): any {
function notePlanLimits(report: PlanUsageReport, scope: string) {
  const host = getHost();

  const payer = scope.toLowerCase();
  const now = Date.now();
  for (const row of report.providers) {
    const until = host.spentPlanUntil(row);
    // #2192: fullest window used-percent per payer and engine, from the last report.
    const used = host.planUsedPercent(row);
    // #0867: every instance folded on this row's login shares its plan, so the
    // quick pick and the same-provider rotation skip all of them together.
    const ids = new Set([row.instanceId ?? row.id, ...(row.instanceIds ?? [])].filter(Boolean));
    for (const id of ids) {
      const key = `${payer}\u0000${id}`;
      if (until !== null && until > now) host.spentPlans.set(key, until);
      else host.spentPlans.delete(key);
      if (used !== null) host.planUsedPercents.set(key, used);
      else host.planUsedPercents.delete(key);
    }
  }
  while (host.spentPlans.size > 2_000) host.spentPlans.delete(host.spentPlans.keys().next().value as string);
  while (host.planUsedPercents.size > 2_000) host.planUsedPercents.delete(host.planUsedPercents.keys().next().value as string);

}
  return notePlanLimits;
}
