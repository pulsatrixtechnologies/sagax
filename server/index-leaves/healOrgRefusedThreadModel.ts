// @ts-nocheck
/** healOrgRefusedThreadModel (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createHealOrgRefusedThreadModel(getHost: () => Host): any {
function healOrgRefusedThreadModel(botId: string, threadId: string, speaker: TurnSpeaker) {
  const host = getHost();

  const bot = host.store.bot(botId);
  const own = host.store.taskByThread(botId, threadId)?.modelSelection;
  if (!bot || !own || own.auto === true || host.sameModelSelection(own, bot.modelSelection) || bot.approvalGrant || host.threadBusy(botId, threadId)) return;
  const mine = host.registry.get(own.instanceId);
  const theirs = host.registry.get(bot.modelSelection.instanceId);
  if (!mine || !theirs || !theirs.enabled) return;
  const refusal = host.orgEngineRefusal(bot, mine, speaker, own.model);
  if (refusal?.reason !== "no_access" || (refusal.cause !== "no_credentials" && refusal.cause !== "server_engine_not_allowed")) return;
  if (host.orgEngineRefusal(bot, theirs, speaker, bot.modelSelection.model)) return;
  if (!host.store.followBotModel(botId, [threadId], (from, to) => host.hostedModels?.resetTask(from, to) ?? {}).length) return;
  const person = (refusal.payerPrincipalId && host.principals.byId(refusal.payerPrincipalId)?.name) || "the person this turn runs for";
  console.error(`[omb-turn] bot=${botId} thread model on ${own.instanceId} has no credentials here, now on ${bot.modelSelection.instanceId}`);
  host.store.appendMessage(threadId, { role: "bot", kind: "activity", tool: {
    name: `notice: This thread's model (${modelName(own)}) cannot run on this server: ${engineDisplayName(mine)} has no credentials here for ${person}. It now uses ${bot.name}'s model (${modelName(bot.modelSelection)}).`,
    ok: true
  } });

}
  return healOrgRefusedThreadModel;
}
