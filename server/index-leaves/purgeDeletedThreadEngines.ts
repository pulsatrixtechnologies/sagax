// @ts-nocheck
/** purgeDeletedThreadEngines (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPurgeDeletedThreadEngines(getHost: () => Host): any {
function purgeDeletedThreadEngines(threads: ReadonlyArray<{ threadId: string; keys: readonly string[] }>, why: string) {
  const host = getHost();

  if (!threads.length) return;
  for (const { threadId } of threads) {
    host.forgetThreadLogs(threadId);
    host.releaseThreadEngines(threadId);
  }
  const keys = [...new Set(threads.flatMap((thread) => thread.keys))];
  const run = () => {
    try { host.purgeConfidentialEngineKeys(keys, why, { recheck: true }); } catch (error) {
      console.warn(`confidential thread: could not purge its engine transcripts (${error instanceof Error ? error.message : "unknown"})`);
    }
  };
  setImmediate(run);
  setTimeout(run, 3_000).unref();

}
  return purgeDeletedThreadEngines;
}
