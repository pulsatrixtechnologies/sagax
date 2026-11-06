// @ts-nocheck
/** viewerThreadOf (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createViewerThreadOf(getHost: () => Host): any {
function viewerThreadOf(bot: BotRecord, viewerId: string) {
  const host = getHost();

  return viewerThread({
    tasks: host.store.tasks(bot.id),
    viewerId,
    botOwnerPrincipalId: host.effectiveBotOwner(bot),
    selected: host.viewerSelections.get(host.selectionKey(bot.id, viewerId)),
    current: bot.threadId
  });

}
  return viewerThreadOf;
}
