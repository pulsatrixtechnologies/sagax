// @ts-nocheck
/** noteWakeDryRun (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createNoteWakeDryRun(getHost: () => Host): any {
function noteWakeDryRun(threadId: string, botId: string, tool: string, command?: string) {
  const host = getHost();

  const run = host.proactiveWakeForThread(threadId);
  if (!run?.proactive || !host.routines) return;
  const decision = host.proactiveEngine.decideStep(botId, { tool, ...(command ? { command } : {}) });
  if (!decision.dryRun) return;
  // #2698: each write step of a wake counts on the bot's proactivity metrics
  host.proactiveMetrics?.count(botId, "writes");
  host.routines.noteProactiveDryRun(run.id, {
    tool,
    summary: host.proactiveDryRunSummary({ tool, ...(command ? { command } : {}) })
  });

}
  return noteWakeDryRun;
}
