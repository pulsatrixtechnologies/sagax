// @ts-nocheck
/** defaultTurnPayerFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDefaultTurnPayerFor(getHost: () => Host): any {
function defaultTurnPayerFor(bot: BotRecord) {
  const host = getHost();
  const { subscriptionDriver } = host;

  if (host.IDENTITY.kind !== "perspicax") return "speaker";
  const stored = host.store.bot(bot.id) ?? bot;
  const owner = host.effectiveBotOwner(stored).trim();
  if (!owner) return "speaker";
  const driver = host.registry.get(stored.modelSelection.instanceId)?.driverKind ?? "";
  return host.defaultTurnPayerMode({
    ownerLocalModel: host.desktopLocalModels.personOfModel(stored.modelSelection.model) === owner.toLowerCase(),
    ownerSubscription: subscriptionDriver(driver) && (host.engineLogins?.signedIn(owner, driver, "primary", stored.modelSelection.instanceId) ?? false)
  });

}
  return defaultTurnPayerFor;
}
