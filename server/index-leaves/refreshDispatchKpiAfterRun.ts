// @ts-nocheck
/** refreshDispatchKpiAfterRun (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRefreshDispatchKpiAfterRun(getHost: () => Host): any {
function refreshDispatchKpiAfterRun(run: RoutineRun) {
  const host = getHost();

  if (run.status !== "completed" && run.status !== "failed") return;
  if (!run.botId || host.dispatchKpiRefreshedRuns.has(run.id)) return;
  host.dispatchKpiRefreshedRuns.add(run.id);
  if (host.dispatchKpiRefreshedRuns.size > 500) host.dispatchKpiRefreshedRuns.delete(host.dispatchKpiRefreshedRuns.values().next().value!);
  for (const artifact of host.artifactStore.all()) {
    if (artifact.botId !== run.botId || artifact.source?.kind !== "tool" || !host.isDispatchKpi(artifact.source.tool)) continue;
    const parsed = host.parseDispatchKpiArgs(artifact.source.args);
    if (!parsed.ok || !host.dispatchRoutineMatches(run.routineName ?? "", parsed.value.refreshAfter)) continue;
    host.dispatchKpiForced.add(artifact.id);
    void host.artifactRefresher.refreshNow(artifact.id).catch((error: unknown) => {
      console.warn(`[dispatch-kpi] refresh after ${run.routineName} failed: ${error instanceof Error ? error.message : "error"}`);
    });
  }

}
  return refreshDispatchKpiAfterRun;
}
