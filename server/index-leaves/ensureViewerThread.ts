// @ts-nocheck
/** ensureViewerThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEnsureViewerThread(getHost: () => Host): any {
function ensureViewerThread(bot: BotRecord, viewerId: string) {
  const host = getHost();
  const { canOnBot, isPrincipalId } = host;

  const mine = host.viewerThreadOf(bot, viewerId);
  if (mine || !isPrincipalId(viewerId)) return mine;
  const viewer = host.authzViewerFromId(viewerId);
  if (!viewer || !canOnBot(viewer, "bot.use", host.botFacts(bot))) return undefined;
  // the organization's default holds for a person's first thread too
  const task = host.store.createTask(bot.id, undefined, false, undefined, undefined, undefined, viewerId, undefined, false, undefined, host.confidentialThreadsByDefault());
  if (task) console.log(`[private-threads] bot ${bot.id}: a person's first private thread started`);
  return task?.threadId;

}
  return ensureViewerThread;
}
