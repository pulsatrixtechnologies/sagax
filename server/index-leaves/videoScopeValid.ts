// @ts-nocheck
/** videoScopeValid (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createVideoScopeValid(getHost: () => Host): any {
function videoScopeValid(scope: VideoScope) {
  const host = getHost();

  const bot = host.store.bot(scope.botId);
  if (!bot || bot.hidden) return false;
  const group = host.store.groupByThread(scope.threadId);
  if (!(host.store.taskByThread(bot.id, scope.threadId) || bot.threadId === scope.threadId || group?.memberIds.includes(bot.id))) return false;
  if (host.IDENTITY.kind !== "perspicax") return true;
  return Boolean(host.providerAccountOwner(scope.principalId)) && host.viewerMayAnswerOnThread(scope.threadId, scope.principalId);

}
  return videoScopeValid;
}
