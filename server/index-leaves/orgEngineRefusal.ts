// @ts-nocheck
/** orgEngineRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgEngineRefusal(getHost: () => Host): any {
function orgEngineRefusal(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker, model: string | null | undefined) {
  const host = getHost();
  const { resolveEngineAccess } = host;

  if (host.IDENTITY.kind !== "perspicax") return null;
  const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker));
  if (plan.ok) return null;
  const refusal = host.orgRefusalOf(plan, speaker);
  // #1422: a pi model on a local host needs no key of the person who pays.
  // `model` is the model this check judges (a candidate, a backup, a room's
  // pick), never the bot's own: a cloud model on pi still needs its key.
  // Policy refusals still hold.
  if (host.piLocalKeyRefusalLifted(refusal.cause, { driverKind: host.registry.get(instance.instanceId)?.driverKind, model })) return null;
  return refusal;

}
  return orgEngineRefusal;
}
