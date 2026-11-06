// @ts-nocheck
/** subscriptionExpiredCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSubscriptionExpiredCard(getHost: () => Host): any {
function subscriptionExpiredCard(bot: BotRecord, instance: { driverKind: string; displayName?: string }, ran: { via: string; payerPrincipalId?: string; routine?: true } | undefined, message: string) {
  const host = getHost();
  const { subscriptionDriver } = host;

  const payer = ran?.payerPrincipalId?.trim().toLowerCase();
  const card = host.signInExpiredCard({
    identity: host.IDENTITY.kind, via: ran?.via, subscriptionDriver: subscriptionDriver(instance.driverKind), message,
    payerPrincipalId: payer, botId: bot.id, botName: bot.name, ownerPrincipalId: host.effectiveBotOwner(bot),
    engine: host.engineNameForViewer(host.engineDisplayName(instance), host.driverDisplayName(instance.driverKind), payer ? host.personIsOrgAdmin(payer) : false),
    ...(ran?.routine ? { routine: true } : {})
  });
  return card;

}
  return subscriptionExpiredCard;
}
