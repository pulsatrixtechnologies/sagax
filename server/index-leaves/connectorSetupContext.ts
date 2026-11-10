// @ts-nocheck
/** connectorSetupContext (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConnectorSetupContext(getHost: () => Host): any {
function connectorSetupContext(botId: string, threadId: string) {
  const host = getHost();

  // the engine this conversation runs on, which may not be the bot's default
  const bot = host.store.projectBotForTask(botId, threadId) ?? host.store.bot(botId);
  const instance = bot ? host.registry.get(bot.modelSelection.instanceId) : undefined;
  const speaker = host.turnSpeakers.get(threadId);
  if (!bot || !instance || !speaker) return null;
  const driver = instance.driverKind;
  // 2026-10-28: the person's own Grok or Claude sign-in on another engine
  // this bot may run (run_with_engine), so a card never dead-ends on "this
  // engine can't attach connectors to your own account".
  const ownOn = (drivers: readonly string[]) => host.registry.instances().some((candidate) =>
    candidate.enabled && drivers.includes(candidate.driverKind)
    && host.connectorPlanForTurn(bot, candidate, speaker).account === "own");
  return {
    engine: driver === "claudeAgent" ? "claude" : driver === "grokAgent" || driver === "grok" ? "grok" : "other",
    // the plan of this conversation's turn (server/connectors/turn-plan.ts)
    account: host.connectorPlanForTurn(bot, instance, speaker, threadId, host.turnAccessByThread.get(threadId)?.via).account,
    ownAccounts: { grok: ownOn(["grokAgent", "grok"]), claude: ownOn(["claudeAgent"]) }
  };

}
  return connectorSetupContext;
}
