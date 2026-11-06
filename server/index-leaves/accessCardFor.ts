// @ts-nocheck
/** accessCardFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAccessCardFor(getHost: () => Host): any {
function accessCardFor(bot: BotRecord, refusal: OrgAccessRefusal, engine: string, detail?: string) {
  const host = getHost();
  const { subscriptionDriver } = host;

  const offline = refusal.cause === "owner_model_offline";
  const keysUrl = refusal.reason === "no_access" && !offline ? host.perspicaxKeysUrl() : undefined;
  const instance = host.registry.get(bot.modelSelection.instanceId);
  const driver = instance?.driverKind ?? "";
  const owner = host.effectiveBotOwner(bot).trim().toLowerCase();
  // #1137: a person writing to someone else's bot that runs on each
  // person's own access: the card says so and offers to choose a model.
  const speakerPays = refusal.reason === "no_access" && !offline && !refusal.routine && refusal.payer === "speaker"
    && Boolean(refusal.payerPrincipalId) && refusal.payerPrincipalId!.trim().toLowerCase() !== owner;
  return {
    ...(bot.name?.trim() ? { botName: bot.name.trim().slice(0, 200) } : {}),
    ...(refusal.ownerPays ? { ownerPays: true as const, ...(refusal.speakerPrincipalId ? { speakerPrincipalId: refusal.speakerPrincipalId } : {}) } : {}),
    ...(offline && refusal.ownerName ? { ownerName: refusal.ownerName.slice(0, 200) } : {}),
    ...(speakerPays ? { speakerPays: true as const } : {}),
    reason: refusal.reason,
    engine,
    botId: bot.id,
    ownerPrincipalId: host.effectiveBotOwner(bot),
    ...(detail ? { detail } : {}),
    ...(keysUrl ? { keysUrl } : {}),
    ...(refusal.cause ? { cause: refusal.cause } : {}),
    ...(refusal.payer ? { payer: refusal.payer } : {}),
    ...(refusal.payerPrincipalId ? { payerPrincipalId: refusal.payerPrincipalId } : {}),
    ...(refusal.routine ? { routine: true as const } : {}),
    ...(refusal.reason === "no_access" && !offline && subscriptionDriver(driver) ? { subscriptionSignIn: true as const } : {})
  };

}
  return accessCardFor;
}
