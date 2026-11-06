// @ts-nocheck
/** currentBrowserSession (#1388). Pure move from server/index.ts. */
import { browserProfilePartitionTarget } from "../config.ts";
export type Host = Record<string, any>;

export function createCurrentBrowserSession(getHost: () => Host): any {
function currentBrowserSession(botId: string, requestedProfile: string | undefined, threadId?: string) {
  const host = getHost();
  const { MY_CHROME_PROFILE, browserSessionId, confidentialBrowserSession, randomUUID } = host;
  const profile = host.effectiveBrowserProfile(botId, requestedProfile);
  if (threadId && host.store.isConfidentialThread(threadId)) {
    let session = host.confidentialBrowserSessions.get(threadId);
    if (!session) {
      session = confidentialBrowserSession(threadId, randomUUID().slice(0, 8));
      host.confidentialBrowserSessions.set(threadId, session);
    }
    return session;
  }
  if (profile === MY_CHROME_PROFILE) return browserSessionId(botId, `${host.MY_CHROME_SESSION_PREFIX}${botId}`);
  if (profile === "guest") {
    let session = host.temporaryBrowserSessions.get(botId);
    if (!session) {
      session = browserSessionId(botId, "guest");
      host.temporaryBrowserSessions.set(botId, session);
    }
    return session;
  }
  const target = profile ? browserProfilePartitionTarget(host.cfg, profile) ?? host.personalProfileTarget(botId, profile) : null;
  return browserSessionId(botId, target?.partitionId ?? "");

}
  return currentBrowserSession;
}
