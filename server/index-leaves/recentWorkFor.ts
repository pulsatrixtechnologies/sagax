// @ts-nocheck
/** recentWorkFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRecentWorkFor(getHost: () => Host): any {
function recentWorkFor(bot: BotRecord, threadId: string, opts: { userName: string }) {
  const host = getHost();

  const sources = host.recentWorkSources(bot);
  const allow = host.privateRecallFilter(bot, threadId);
  // A Cloud home also keeps out what anyone but its owner wrote in.
  const filter = host.recentWorkFilter();
  if (!allow) return recentWork(sources, bot, { ...opts, currentThreadId: threadId, ...filter });
  return recentWork(
    { ...sources, groups: sources.groups.filter((group) => allow(group.threadId)) },
    { ...bot, threadId, tasks: (bot.tasks ?? []).filter((task) => allow(task.threadId)) },
    { ...opts, currentThreadId: threadId, ...filter },
  );

}
  return recentWorkFor;
}
