// @ts-nocheck
/** markRoutineResultsThreads (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMarkRoutineResultsThreads(getHost: () => Host): any {
function markRoutineResultsThreads() {
  const host = getHost();

  for (const routine of host.routines?.listRoutines() ?? []) {
    if (!routine.resultsThreadId || !routine.botId) continue;
    const task = host.store.taskByThread(routine.botId, routine.resultsThreadId);
    if (task && task.routineResults !== true && !task.routineRunId && host.legacyResultsThread(routine.name, task)) {
      host.store.patchTask(routine.botId, task.threadId, { routineResults: true, unread: false });
    }
  }

}
  return markRoutineResultsThreads;
}
