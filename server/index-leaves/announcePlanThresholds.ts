// @ts-nocheck
/** announcePlanThresholds (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAnnouncePlanThresholds(getHost: () => Host): any {
function announcePlanThresholds(report: PlanUsageReport, scope: string) {
  const host = getHost();

  try {
    host.notePlanLimits(report, scope);
  } catch (failure) {
    console.warn(`[plan-usage] spent windows: ${failure instanceof Error ? failure.message : String(failure)}`);
  }
  try {
    for (const alert of host.newPlanUsageAlerts(report, scope.toLowerCase(), host.cfg.budgets?.warnAtPercent)) {
      const text = host.planUsageAlertText(alert);
      host.broadcast({ kind: "notify", notification: {
        kind: "spend", botId: "", botName: "", threadId: "", title: text.title, body: text.body,
        ...(scope !== "server" ? { audience: [scope] } : {})
      } }, scope === "server" && host.IDENTITY.kind === "perspicax" ? { adminOnly: true } : {});
    }
  } catch (failure) {
    console.warn(`[plan-usage] threshold alert: ${failure instanceof Error ? failure.message : String(failure)}`);
  }

}
  return announcePlanThresholds;
}
