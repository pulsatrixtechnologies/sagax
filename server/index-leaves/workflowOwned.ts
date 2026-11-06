// @ts-nocheck
/** workflowOwned (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWorkflowOwned(getHost: () => Host): any {
function workflowOwned(auth: RequestAuth, botId: string, threadId: string) {
  const host = getHost();
  const { sessionPrincipal } = host;

  const bot = host.store.bot(botId);
  if (!bot) return false;
  const onBot = bot.threadId === threadId || Boolean(bot.tasks?.some((task) => task.threadId === threadId));
  if (!onBot) return false;
  if (host.IDENTITY.kind === "perspicax") {
    if (auth.kind !== "session") return false;
    return sessionPrincipal(auth)?.toLowerCase() === host.effectiveBotOwner(bot).toLowerCase();
  }
  // One person on a desktop shares the local folder. On a shared server
  // each session only names conversations it started. The owner's own
  // devices on a personal Cloud still reach every conversation on their bots.
  const shared = host.HOSTED_WORKSPACE || host.sharedMembership();
  if (!shared) return true;
  if (auth.kind !== "session") return false;
  const person = host.personKey(auth.session);
  return host.threadStarters.get(threadId) === person;

}
  return workflowOwned;
}
