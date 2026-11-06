// @ts-nocheck
/** isUnattended (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createIsUnattended(getHost: () => Host): any {
function isUnattended(botId?: string | null, threadId?: string) {
  const host = getHost();
  const { unattendedThreads } = host;

  if (!botId) return false;
  // Legacy peer callers without a thread fail closed if any of the bot's
  // work is unattended. Capability/event callers always pass the exact id.
  if (!threadId) return [...unattendedThreads].some(([id, mark]) => mark.botId === botId && isUnattended(botId, id));
  const mark = host.unattendedThreads.get(threadId);
  if (!mark || mark.botId !== botId) return false;
  // A long-running turn is still unattended even if its next approval comes
  // more than 30 minutes after the previous one. Only an idle bot may age
  // out; every positive read refreshes the inactivity window.
  if (Date.now() - mark.at > host.UNATTENDED_TTL_MS && !host.threadBusy(botId, threadId) && !host.groupSpeakers.has(threadId)) {
    host.unattendedThreads.delete(threadId);
    return false;
  }
  mark.at = Date.now();
  return true;

}
  return isUnattended;
}
