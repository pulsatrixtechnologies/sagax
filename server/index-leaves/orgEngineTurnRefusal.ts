// @ts-nocheck
/** orgEngineTurnRefusal (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createOrgEngineTurnRefusal(getHost: () => Host): any {
function orgEngineTurnRefusal(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker) {
  const host = getHost();
  const { resolveEngineAccess } = host;

  if (host.consoleEngineAllowed(instance.instanceId)) return undefined;
  if (!host.orgOwnAccountsOutsideList()) return host.ORG_ENGINE_NOT_ALLOWED;
  // #1422: a local pi model gets no exemption here. On an organization server
  // its local host (127.0.0.1, server/drivers/local-inject.ts) is the
  // server's own machine, shared by every member, not the person's: the
  // organization's engine list decides for it as for any engine it runs.
  // Without a list (the default) every engine is allowed, pi included. A
  // model on the person's own computer is a desktop model (desktop-inject),
  // which this list never gated.
  return paidByPerson(resolveEngineAccess(host.orgEngineInput(bot, instance, speaker))) ? undefined : host.ORG_ENGINE_NOT_ALLOWED;

}
  return orgEngineTurnRefusal;
}
