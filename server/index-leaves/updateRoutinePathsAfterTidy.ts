// @ts-nocheck
/** updateRoutinePathsAfterTidy (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createUpdateRoutinePathsAfterTidy(getHost: () => Host): any {
function updateRoutinePathsAfterTidy(principalId: string, moves: readonly TidyMove[]) {
  const host = getHost();

  if (!host.routines) return;
  const person = principalId.trim().toLowerCase();
  for (const routine of host.routines.listRoutines()) {
    // Only the routines that run in this person's environment.
    const runsAs = host.effectiveRunAs({ botId: routine.botId, ...(routine.runAs ? { runAs: routine.runAs } : {}) })?.trim().toLowerCase();
    if (runsAs !== person) continue;
    const prompt = host.rewriteMovedPaths(routine.prompt, moves);
    const precheck = routine.precheck ? JSON.parse(host.rewriteMovedPaths(JSON.stringify(routine.precheck), moves)) as typeof routine.precheck : undefined;
    const promptChanged = prompt !== routine.prompt;
    const precheckChanged = Boolean(routine.precheck) && JSON.stringify(precheck) !== JSON.stringify(routine.precheck);
    if (!promptChanged && !precheckChanged) continue;
    try {
      host.routines.update(routine.id, { ...(promptChanged ? { prompt } : {}), ...(precheckChanged ? { precheck } : {}) });
      console.log(`[workspace-tidy] routine ${routine.id}: paths updated to the moved files`);
    } catch (error) {
      console.error(`[workspace-tidy] routine ${routine.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}
  return updateRoutinePathsAfterTidy;
}
