// @ts-nocheck
/** routineFullReport (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineFullReport(getHost: () => Host): any {
function routineFullReport(run: RoutineRun) {
  const host = getHost();

  if (run.status !== "completed" || run.quiet || !run.output || !run.threadId) return undefined;
  const last = host.store.messagesFor(run.threadId).findLast((message) => message.role === "bot" && !message.kind && typeof message.text === "string" && message.text.trim());
  if (!last?.text) return undefined;
  const report = host.routineReportOutcome(host.redactSecretsInText(last.text)).report;
  const head = run.output.slice(0, 200);
  const body = report.length > run.output.length && report.startsWith(head) ? report : undefined;
  if (!body) return undefined;
  // 2026-11-01: dry runs recorded on a proactive wake are visible in its report.
  const dryRuns = run.proactive?.dryRuns;
  if (!dryRuns?.length) return body;
  const lines = dryRuns.map((entry) => `- ${entry.summary}`).join("\n");
  return `${body}\n\nDry runs before writes:\n${lines}`;

}
  return routineFullReport;
}
