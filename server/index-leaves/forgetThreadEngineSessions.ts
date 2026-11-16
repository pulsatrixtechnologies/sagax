// @ts-nocheck
/** forgetThreadEngineSessions (#1388). Pure move from server/index.ts. */
import { join } from "node:path";
export type Host = Record<string, any>;

export function createForgetThreadEngineSessions(getHost: () => Host): any {
/** Forget the engine sessions of one thread, or of several of one bot in a
 * single purge pass: their idle processes close, their cursors go and their
 * native transcripts are purged, so each next turn starts a new session with
 * its own transcript replayed. */
function forgetThreadEngineSessions(botId: string, threadIds: string | readonly string[], why: string) {
  const host = getHost();
  const { TASK_WORKSPACES_DIR, threadKeys } = host;
  const keys: string[] = [];
  const live: string[] = [];
  for (const threadId of typeof threadIds === "string" ? [threadIds] : threadIds) {
    host.releaseThreadEngines(threadId);
    keys.push(...host.threadEngineKeys(botId, threadId));
    host.store.forgetEngineSessions(botId, threadId);
    live.push(...threadKeys(threadId, [join(TASK_WORKSPACES_DIR, botId, threadId)]));
  }
  try {
    // in the request: the thread's next turn must not start before its old
    // sessions' files are gone (its new ones live under the same folder)
    host.purgeConfidentialEngineKeys(keys, why, { live });
  } catch (error) {
    console.warn(`confidential thread: could not purge its engine transcripts (${error instanceof Error ? error.message : "unknown"})`);
  }

}
  return forgetThreadEngineSessions;
}
