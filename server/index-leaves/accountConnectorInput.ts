// @ts-nocheck
/** accountConnectorInput (#1388). Pure move from server/index.ts. */
import { resolveEngineAccess } from "../engines/engine-credentials.ts";
export type Host = Record<string, any>;

export function createAccountConnectorInput(getHost: () => Host): any {
function accountConnectorInput(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker, via?: TurnAccess["via"], slot: LoginSlot = getHost().turnSlotFor(bot, instance)): ClaudeAiTurnInput {
  const host = getHost();
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
    instanceId: instance.instanceId,
    ...(planned ? { via: planned } : {}),
    ...(payerPrincipalId !== undefined ? { payerPrincipalId } : {}),
    speaker,
    ownerPrincipalId: host.effectiveBotOwner(bot),
    localPrincipalId: host.localPrincipalId(),
    // #2747: grok.com connectors reach a bot only when it opted in
    ...(bot.grokAccountConnectors === true ? { grokAccountConnectors: true } : {})
  };
}
  return accountConnectorInput;
}
