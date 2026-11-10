// @ts-nocheck
/** connectorsElsewhereFor (#1388). Pure move from server/index.ts.
 * #3344: reads the person's connector registry (server/connectors/registry.ts),
 * which is known right after a restart, and names a Grok sign-in by what a
 * run_with_engine part on it loads (the gateway, with or without the bot's
 * opt-in, #3174), so a bot with default settings is told of it. */
import { connectedConnectorNames } from "../connectors/registry.ts";
export type Host = Record<string, any>;

export function createConnectorsElsewhereFor(getHost: () => Host): any {
function connectorsElsewhereFor(bot: BotRecord, instance: { instanceId: string; driverKind: string }, speaker: TurnSpeaker) {
  const host = getHost();
  const { claudeAiConnectorsForTurn, connectorPrincipalFor, grokCloudConnectorsForTurn, isPrincipalId, secondLoginSupported } = host;
  const registry = host.connectorRegistry;

  if (host.IDENTITY.kind !== "perspicax" || !registry) return [];
  const out: ConnectorElsewhere[] = [];
  const currentSlot = host.turnSlotFor(bot, instance);
  for (const candidate of host.registry.instances()) {
    if (!candidate.enabled || candidate.adapter.capabilities.withholdsHostTools !== true) continue;
    if (candidate.driverKind === "claudeAgent") {
      if (candidate.instanceId === instance.instanceId) continue;
      const input = host.accountConnectorInput(bot, candidate, speaker);
      if (!claudeAiConnectorsForTurn(input)) continue;
      const account = registry.account(connectorPrincipalFor(input), { provider: "claude-ai", instanceId: candidate.instanceId, slot: "primary" });
      if (account?.auth !== "subscription") continue;
      out.push({ engine: host.engineDisplayName(candidate), connectors: connectedConnectorNames(account) });
      continue;
    }
    if (!secondLoginSupported(candidate.driverKind)) continue;
    const payer = host.turnPayerPrincipal(bot, candidate, speaker);
    if (!payer || !isPrincipalId(payer)) continue;
    for (const slot of ["primary", "second"] as const) {
      const input = host.accountConnectorInput(bot, candidate, speaker, undefined, slot);
      // the turn itself already loads this sign-in's connectors: not elsewhere
      if (candidate.instanceId === instance.instanceId && slot === currentSlot && grokCloudConnectorsForTurn(input)) continue;
      // what a run_with_engine part on that sign-in loads (engineRelay)
      if (!grokCloudConnectorsForTurn({ ...input, engineRelay: true }) || !host.withholdHostToolsFor(candidate) || bot.toolScope !== undefined) continue;
      const account = registry.account(payer, { provider: "grok-com", instanceId: candidate.instanceId, slot });
      // not signed in there, or not read yet (the registry reads it in the background)
      if (!account || account.at === 0) continue;
      const kind = account.kind ?? host.grokAccountKindFor(payer, slot, candidate.instanceId);
      // the first sign-in keeps the engine's own name (run_with_engine "Grok"); the second is named by what it is
      const engine = slot === "second" ? host.relayAccountLabel(host.engineDisplayName(candidate), kind) : host.engineDisplayName(candidate);
      out.push({ engine, connectors: connectedConnectorNames(account), ...(kind ? { accountKind: kind } : {}) });
    }
  }
  return out;

}
  return connectorsElsewhereFor;
}
