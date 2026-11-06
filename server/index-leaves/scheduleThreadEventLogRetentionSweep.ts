// @ts-nocheck
/** scheduleThreadEventLogRetentionSweep (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createScheduleThreadEventLogRetentionSweep(getHost: () => Host): any {
function scheduleThreadEventLogRetentionSweep() {
  const host = getHost();

  const run = () => {
    void host.sweepThreadEventLogsDeferred().catch((error) => {
      console.warn(`thread event log retention sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  // After listen and the first turns: setImmediate alone can still race a
  // boot-time resume; a short delay keeps the sweep off the hot path.
  setTimeout(run, 5_000).unref();
  setInterval(run, host.THREAD_LOG_RETENTION_SWEEP_MS).unref();

}
  return scheduleThreadEventLogRetentionSweep;
}
