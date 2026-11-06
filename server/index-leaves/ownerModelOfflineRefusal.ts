// @ts-nocheck
/** ownerModelOfflineRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOwnerModelOfflineRefusal(getHost: () => Host): any {
function ownerModelOfflineRefusal(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker, model: string) {
  const host = getHost();

  if (!host.ownerPaysTurn(bot, instance, speaker)) return null;
  const owner = host.effectiveBotOwner(bot);
  if (!host.desktopLocalModels.ownerComputerOffline(owner, model)) return null;
  const person = host.principals.byId(owner);
  const ownerName = person?.name?.trim() || person?.login?.trim() || "";
  return {
    reason: "no_access", cause: "owner_model_offline", payer: "owner", payerPrincipalId: owner, ownerPays: true,
    ...(ownerName ? { ownerName } : {}),
    ...(speaker.origin === "person" && speaker.principalId ? { speakerPrincipalId: speaker.principalId } : {})
  };

}
  return ownerModelOfflineRefusal;
}
