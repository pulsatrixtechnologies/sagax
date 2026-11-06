// @ts-nocheck
/** healThreadModel (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHealThreadModel(getHost: () => Host): any {
function healThreadModel(botId: string, threadId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  const own = host.threadModelGivingWay(botId, threadId);
  if (!bot || !own || bot.approvalGrant || host.threadBusy(botId, threadId)) return;
  if (!host.store.followBotModel(botId, [threadId], (from, to) => host.hostedModels?.resetTask(from, to) ?? {}).length) return;
  host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: {
    name: `notice: This thread's model (${host.modelName(own)}) isn't available, so it now uses ${bot.name}'s model (${host.modelName(bot.modelSelection)}).`,
    ok: true
  } });

}
  return healThreadModel;
}
