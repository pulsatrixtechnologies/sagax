// @ts-nocheck
/** routineEngineForBot (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineEngineForBot(getHost: () => Host): any {
function routineEngineForBot(bot: BotRecord, speaker: TurnSpeaker, instanceId = bot.modelSelection.instanceId) {
  const host = getHost();
  const { driverKeyBacked, resolveEngineAccess } = host;
  const instance = host.registry.get(instanceId);
  if (!instance) return undefined;
  const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker));
  const account = host.refusalAccount(plan.ok ? plan.via : "subscription", plan.payerPrincipalId, host.turnSlotFor(bot, instance));
  const signedIn = host.IDENTITY.kind === "perspicax" ? (!plan.ok ? false : plan.via === "subscription" ? true : undefined)
    : host.engineProbes.get(instance.instanceId)?.ready;
  return { engine: instance.instanceId, name: host.engineDisplayName(instance), account, signedIn,
    driver: instance.driverKind, ...(plan.ok ? { accessVia: plan.via } : {}),
    keyBacked: driverKeyBacked(host.cfg, instance.driverKind, instance.instanceId) || host.keyOnlyInstance(instance.instanceId),
    ...(host.IDENTITY.kind !== "perspicax" ? { signedInAt: host.engineProbes.get(instance.instanceId)?.at } : {}),
    ...(!plan.ok ? { detail: plan.cause ?? plan.reason } : {}) };

}
  return routineEngineForBot;
}
