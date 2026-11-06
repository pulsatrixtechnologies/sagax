// @ts-nocheck
/** appliesDirectly (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAppliesDirectly(getHost: () => Host): any {
function appliesDirectly(botId: string, threadId: string, targetBotId: string) {
  const host = getHost();

  return host.directApply({
    fullAccess: host.fullAccessForSource(botId, threadId),
    botId,
    targetBotId,
    blocked: host.selfApplyBlocked(threadId) || !host.connectorThread(botId, threadId),
    // another bot of the same person applies like the bot itself
    ownerOf: (id) => { const bot = host.store.bot(id); return bot ? host.effectiveBotOwner(bot) : undefined; }
  });

}
  return appliesDirectly;
}
