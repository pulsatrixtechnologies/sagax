// @ts-nocheck
/** sendStateFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSendStateFor(getHost: () => Host): any {
async function sendStateFor(bot: BotRecord, speaker: TurnSpeaker) {
  const host = getHost();

  try {
    const selection = bot.modelSelection;
    const instance = host.registry.get(selection.instanceId);
    if (selection.auto === true || !instance?.enabled) return null;
    const engine = { instanceId: instance.instanceId, name: host.engineDisplayName(instance) };
    const ownerOffline = host.ownerModelOfflineRefusal(bot, instance, speaker, selection.model);
    const refused = host.IDENTITY.kind === "perspicax" && !ownerOffline && host.orgEngineRefusal(bot, instance, speaker, selection.model) !== null &&
      host.speakerTurnSelection(bot, speaker) === null;
    const preSend = host.preSendRefusals.for(bot.threadId, instance.instanceId);
    return host.sendBlockFor({
      auto: false, engine, accessRefused: refused,
      ownerComputerOffline: ownerOffline ? { ownerName: ownerOffline.ownerName ?? "" } : null,
      local: host.desktopLocalModels.reach(selection.model),
      limited: await host.sendStateLimit(bot, speaker),
      refused: preSend ? { kind: preSend.kind, cause: preSend.cause, ...(preSend.fix ? { fix: preSend.fix } : {}) } : null
    });
  } catch (error) {
    console.warn(`[send-state] ${bot.id}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }

}
  return sendStateFor;
}
