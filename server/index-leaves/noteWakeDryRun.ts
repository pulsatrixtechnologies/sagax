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
  host.routines.noteProactiveDryRun(run.id, {
    tool,
    summary: host.proactiveDryRunSummary({ tool, ...(command ? { command } : {}) })
  });

}
  return noteWakeDryRun;
}
