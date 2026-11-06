// @ts-nocheck
/** connectorsElsewhereFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConnectorsElsewhereFor(getHost: () => Host): any {
function connectorsElsewhereFor(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker) {
  const host = getHost();
  const { claudeAiConnectorsForTurn, connectorPrincipalFor, grokCloudConnectorsForTurn, isPrincipalId, secondLoginSupported } = host;

  if (host.IDENTITY.kind !== "perspicax") return [];
  const out: ConnectorElsewhere[] = [];
  const currentSlot = host.turnSlotFor(bot, instance);
  for (const candidate of host.registry.instances()) {
    if (!candidate.enabled || candidate.adapter.capabilities.withholdsHostTools !== true) continue;
    if (candidate.driverKind === "claudeAgent") {
      if (candidate.instanceId === instance.instanceId) continue;
      const input = host.accountConnectorInput(bot, candidate, speaker);
      if (!claudeAiConnectorsForTurn(input)) continue;
      const account = host.claudeAccountForPrincipal(connectorPrincipalFor(input));
      if ("unavailable" in account) continue;
      const inventory = host.claudeAiInventory.peek(account.key, { cli: account.cli, env: account.env });
      if (inventory?.auth !== "subscription") continue;
      out.push({ engine: host.engineDisplayName(candidate), connectors: inventory.connectors.filter((connector) => connector.status === "connected").map((connector) => connector.name) });
      continue;
    }
    if (!secondLoginSupported(candidate.driverKind)) continue;
    const payer = host.turnPayerPrincipal(bot, candidate, speaker);
    if (!payer || !isPrincipalId(payer)) continue;
    const both = host.engineLogins?.signedIn(payer, candidate.driverKind, "second") ?? false;
    for (const slot of ["primary", "second"] as const) {
      if (candidate.instanceId === instance.instanceId && slot === currentSlot) continue;
      if (slot === "second" && !both) continue;
      const input = host.accountConnectorInput(bot, candidate, speaker, undefined, slot);
      if (!grokCloudConnectorsForTurn(input) || !host.withholdHostToolsFor(candidate) || bot.toolScope !== undefined) continue;
      const reach = host.grokAccountReach(host.principalLoginDir(payer, "grokAgent", slot));
      if (!reach) {
        host.engineLogins?.warmReach(payer, candidate.instanceId, slot);
        continue;
      }
      const kind = host.grokAccountKindFor(payer, slot);
      // the first sign-in keeps the engine's own name (run_with_engine "Grok"); the second is named by what it is
      const engine = slot === "second" ? host.relayAccountLabel(host.engineDisplayName(candidate), kind) : host.engineDisplayName(candidate);
      out.push({ engine, connectors: host.grokReachConnectorNames(reach), ...(kind ? { accountKind: kind } : {}) });
    }
  }
  return out;

}
  return connectorsElsewhereFor;
}
