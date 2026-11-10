// @ts-nocheck
/** engineReachFor (#1388). Pure move from server/index.ts.
 * #3344: the connectors come from the person's connector registry
 * (server/connectors/registry.ts), known right after a restart; whether this
 * turn loads them stays the turn's own rule. */
import { isPrincipalId } from "../auth/principals.ts";
import { connectedConnectorNames } from "../connectors/registry.ts";
export type Host = Record<string, any>;

export function createEngineReachFor(getHost: () => Host): any {
function engineReachFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker, via?: TurnAccess["via"], slot: LoginSlot = getHost().turnSlotFor(bot, instance)): Array<{ connector: string }> | null {
  const host = getHost();
  const registry = host.connectorRegistry;
  // the turn's connector plan on that sign-in (server/connectors/turn-plan.ts)
  const plan = host.connectorPlanForTurn(bot, instance, speaker, undefined, via, { slot });
  if (plan.claudeAi) {
    const principal = plan.principal;
    const account = host.claudeAccountForPrincipal(principal, instance.instanceId);
    if ("unavailable" in account) return [];
    // a sign-in never read is unknown: read in the background, never waited on
    const known = registry?.account(principal, { provider: "claude-ai", instanceId: instance.instanceId, slot: "primary" });
    if (!known || known.auth === "unknown") return null;
    return connectedConnectorNames(known).map((connector) => ({ connector }));
  }
  // Grok's grok.com connectors: what this sign-in's gateway carried on its
  // last probe or turn; unknown until then (never a reason to switch).
  if (plan.grokCloud && host.withholdHostToolsFor(instance) && bot.toolScope === undefined) {
    const principal = plan.principal;
    if (!principal || !isPrincipalId(principal)) return null;
    const known = registry?.account(principal, { provider: "grok-com", instanceId: instance.instanceId, slot });
    if (!known || known.at === 0) return null;
    return connectedConnectorNames(known).map((connector) => ({ connector }));
  }
  return [];
}
  return engineReachFor;
}
