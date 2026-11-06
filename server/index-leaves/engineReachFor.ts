// @ts-nocheck
/** engineReachFor (#1388). Pure move from server/index.ts. */
import { isPrincipalId } from "../auth/principals.ts";
import { grokAccountReach, grokReachConnectorNames } from "../drivers/acp/grok-tool-catalog.ts";
import { claudeAiConnectorsForTurn, connectorPrincipalFor, grokCloudConnectorsForTurn } from "../harness-connectors.ts";
export type Host = Record<string, any>;

export function createEngineReachFor(getHost: () => Host): any {
function engineReachFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker, via?: TurnAccess["via"], slot: LoginSlot = getHost().turnSlotFor(bot, instance)): Array<{ connector: string }> | null {
  const host = getHost();
  const input = host.accountConnectorInput(bot, instance, speaker, via, slot);
  if (claudeAiConnectorsForTurn(input)) {
    const account = host.claudeAccountForPrincipal(connectorPrincipalFor(input));
    if ("unavailable" in account) return [];
    // a cold inventory is unknown: read in the background, never waited on
    const inventory = host.claudeAiInventory.peek(account.key, { cli: account.cli, env: account.env });
    if (!inventory || inventory.auth === "unknown") return null;
    if (inventory.auth !== "subscription") return [];
    return inventory.connectors.filter((connector) => connector.status === "connected").map((connector) => ({ connector: connector.name }));
  }
  // Grok's grok.com connectors: what this sign-in's own catalog carried on
  // its last turn or its reach probe (grok-tool-catalog.ts); unknown until
  // then (never a reason to switch, either way).
  if (grokCloudConnectorsForTurn(input) && host.withholdHostToolsFor(instance) && bot.toolScope === undefined) {
    const principal = connectorPrincipalFor(input);
    if (!principal || !isPrincipalId(principal)) return null;
    const reach = grokAccountReach(host.principalLoginDir(principal, "grokAgent", slot));
    if (!reach) {
      host.engineLogins?.warmReach(principal, instance.instanceId, slot);
      return null;
    }
    return grokReachConnectorNames(reach).map((connector) => ({ connector }));
  }
  return [];
}
  return engineReachFor;
}
