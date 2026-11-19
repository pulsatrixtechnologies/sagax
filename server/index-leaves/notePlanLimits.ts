// @ts-nocheck
/** notePlanLimits (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNotePlanLimits(getHost: () => Host): any {
function notePlanLimits(report: PlanUsageReport, scope: string) {
  const host = getHost();

  const payer = scope.toLowerCase();
  for (const row of report.providers) {
    // #2192: fullest window used-percent per payer and engine, from the last report.
    const used = host.planUsedPercent(row);
    // #0867: every instance folded on this row's login shares its plan, so the
    // same-provider rotation skips all of them together.
    const ids = new Set([row.instanceId ?? row.id, ...(row.instanceIds ?? [])].filter(Boolean));
    for (const id of ids) {
      const key = `${payer}\u0000${id}`;
      if (used !== null) host.planUsedPercents.set(key, used);
      else host.planUsedPercents.delete(key);
      // A turn that works on any of them clears the used percent on all of them (planWorked).
      if (host.planSiblings) {
        if (ids.size > 1) host.planSiblings.set(key, [...ids]);
        else host.planSiblings.delete(key);
      }
    }
  }
  while (host.planUsedPercents.size > 2_000) host.planUsedPercents.delete(host.planUsedPercents.keys().next().value as string);
  while (host.planSiblings && host.planSiblings.size > 2_000) host.planSiblings.delete(host.planSiblings.keys().next().value as string);

}
  return notePlanLimits;
}

/** A turn on this engine worked for this payer, so the plan window its login
 * shares is not spent: the used percent goes for every instance folded on
 * that login (#0867), not only the one that ran. */
export function createPlanWorked(getHost: () => Host): (payer: string, instanceId: string) => void {
  return function planWorked(payer: string, instanceId: string) {
    const host = getHost();
    const key = `${payer}\u0000${instanceId}`;
    const ids = new Set([instanceId, ...(host.planSiblings?.get(key) ?? [])]);
    for (const id of ids) {
      const sibling = `${payer}\u0000${id}`;
      host.planUsedPercents.delete(sibling);
      host.planSiblings?.delete(sibling);
    }
  };
}
