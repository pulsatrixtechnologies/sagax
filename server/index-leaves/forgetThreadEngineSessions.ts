// @ts-nocheck
/** forgetThreadEngineSessions (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
export type Host = Record<string, any>;

export function createForgetThreadEngineSessions(getHost: () => Host): any {
function forgetThreadEngineSessions(botId: string, threadId: string, why: string) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR, threadKeys } = host;
  host.releaseThreadEngines(threadId);
  const keys = host.threadEngineKeys(botId, threadId);
  host.store.forgetEngineSessions(botId, threadId);
  try {
    // in the request: the thread's next turn must not start before its old
    // sessions' files are gone (its new ones live under the same folder)
    host.purgeConfidentialEngineKeys(keys, why, { live: threadKeys(threadId, [join(TASK_WORKSPACES_DIR, botId, threadId)]) });
  } catch (error) {
    console.warn(`confidential thread: could not purge its engine transcripts (${error instanceof Error ? error.message : "unknown"})`);
  }

}
  return forgetThreadEngineSessions;
}
