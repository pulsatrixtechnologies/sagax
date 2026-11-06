// @ts-nocheck
/** warmPayerAccountModels (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createWarmPayerAccountModels(getHost: () => Host): any {
function warmPayerAccountModels(bot: BotRecord, speaker: TurnSpeaker) {
  const host = getHost();
  const { resolveEngineAccess } = host;

  if (host.IDENTITY.kind !== "perspicax" || !host.engineLogins || speaker.origin !== "person" || bot.modelSelection.auto === true) return;
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (!instance || instance.driverKind !== "grokAgent") return;
  const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker));
  if (!plan.ok || plan.via !== "subscription" || !plan.payerPrincipalId) return;
  host.engineLogins.warmAccountModels(plan.payerPrincipalId, instance.instanceId);

}
  return warmPayerAccountModels;
}
