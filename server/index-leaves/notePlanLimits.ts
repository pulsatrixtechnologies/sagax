// @ts-nocheck
/** notePlanLimits (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNotePlanLimits(getHost: () => Host): any {
function notePlanLimits(report: PlanUsageReport, scope: string) {
  const host = getHost();

  const payer = scope.toLowerCase();
  const now = Date.now();
  for (const row of report.providers) {
    const key = `${payer}\u0000${row.instanceId ?? row.id}`;
    const until = host.spentPlanUntil(row);
    if (until !== null && until > now) host.spentPlans.set(key, until);
    else host.spentPlans.delete(key);
  }
  while (host.spentPlans.size > 2_000) host.spentPlans.delete(host.spentPlans.keys().next().value as string);

}
  return notePlanLimits;
}
