// @ts-nocheck
/** engineReachFor (#1388). Pure move from server/index.ts.
 * #3344: the connectors come from the person's connector registry
 * (server/connectors/registry.ts), known right after a restart; whether this
 * turn loads them stays the turn's own rule. */
import { isPrincipalId } from "../auth/principals.ts";
import { connectedConnectorNames } from "../connectors/registry.ts";
import { claudeAiConnectorsForTurn, connectorPrincipalFor, grokCloudConnectorsForTurn } from "../harness-connectors.ts";
export type Host = Record<string, any>;

export function createEngineReachFor(getHost: () => Host): any {
function engineReachFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker, via?: TurnAccess["via"], slot: LoginSlot = getHost().turnSlotFor(bot, instance)): Array<{ connector: string }> | null {
  const host = getHost();
  const registry = host.connectorRegistry;
  const input = host.accountConnectorInput(bot, instance, speaker, via, slot);
  if (claudeAiConnectorsForTurn(input)) {
    const principal = connectorPrincipalFor(input);
    const account = host.claudeAccountForPrincipal(principal, instance.instanceId);
    if ("unavailable" in account) return [];
    // a sign-in never read is unknown: read in the background, never waited on
    const known = registry?.account(principal, { provider: "claude-ai", instanceId: instance.instanceId, slot: "primary" });
    if (!known || known.auth === "unknown") return null;
    return connectedConnectorNames(known).map((connector) => ({ connector }));
  }
  // Grok's grok.com connectors: what this sign-in's gateway carried on its
  // last probe or turn; unknown until then (never a reason to switch).
  if (grokCloudConnectorsForTurn(input) && host.withholdHostToolsFor(instance) && bot.toolScope === undefined) {
    const principal = connectorPrincipalFor(input);
    if (!principal || !isPrincipalId(principal)) return null;
    const known = registry?.account(principal, { provider: "grok-com", instanceId: instance.instanceId, slot });
    if (!known || known.at === 0) return null;
    return connectedConnectorNames(known).map((connector) => ({ connector }));
  }
  return [];
}
  return engineReachFor;
}
