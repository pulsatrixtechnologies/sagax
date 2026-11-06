// @ts-nocheck
/** accountConnectorInput (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAccountConnectorInput(getHost: () => Host): any {
function accountConnectorInput(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker, via?: TurnAccess["via"], slot?: LoginSlot) {
  const host = getHost();
  slot ??= host.turnSlotFor(bot, instance);
  const { resolveEngineAccess } = host;
  let planned = via;
  let payerPrincipalId: string | undefined;
  if (host.IDENTITY.kind === "perspicax" && (instance.driverKind === "claudeAgent" || instance.driverKind === "grokAgent" || instance.driverKind === "grok")) {
    const plan = resolveEngineAccess(host.orgEngineInput(bot, instance, speaker, slot));
    if (plan.ok) {
      planned ??= plan.via;
      payerPrincipalId = plan.payerPrincipalId ?? "";
    }
  }
  return {
    identity: host.IDENTITY.kind,
    restrictedByPolicy: host.managedPolicy.restrictsMcp(),
    driver: instance.driverKind,
    ...(planned ? { via: planned } : {}),
    ...(payerPrincipalId !== undefined ? { payerPrincipalId } : {}),
    speaker,
    ownerPrincipalId: host.effectiveBotOwner(bot),
    localPrincipalId: host.localPrincipalId()
  };

}
  return accountConnectorInput;
}
