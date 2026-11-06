// @ts-nocheck
/** turnConnectorsFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnConnectorsFor(getHost: () => Host): any {
function turnConnectorsFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string; driverKind: string }, speaker: TurnSpeaker,   integrations: NonNullable<SendTurnInput["integrations"]>, principal: string | null, customMcp: boolean) {
  const host = getHost();
  const { basename, claudeAiConnectorsForTurn, scopedPluginFolders } = host;
  const account = host.accountConnectorInput(bot, instance, speaker);
  const claudeAi = claudeAiConnectorsForTurn(account);
  const claudeConnectors = claudeAi ? host.claudeAiConnectorRows(account) : undefined;
  const remote = host.remoteMcpServers();
  const serverServers = Object.keys(host.engineMcpServers(bot)).map((name) => {
    const spec = remote[name];
    const auth = spec ? host.mcpOAuth.status(name, spec, bot.mcpAccounts?.[name])?.auth : undefined;
    return { name, ...(auth ? { auth } : {}) };
  });
  let personalServers: string[] = [];
  const person = principal?.trim().toLowerCase();
  if (host.IDENTITY.kind === "perspicax" && person && customMcp) {
    try {
      personalServers = Object.entries(host.personConnections.servers(person)).filter(([, server]) => server.enabled).map(([name]) => name);
    } catch { /* unreadable: none listed */ }
  }
  const plugins = (host.pluginDirsFor(bot, instance, person).pluginDirs ?? []).map((dir) => basename(dir));
  // Every engine receives its plugin folders: file engines by path, API
  // engines as whole files in the prompt (tools on or off, Q8 C). The
  // organization's Flow is one of these folders on every engine.
  if (!plugins.length && instance.driverKind !== "claudeAgent") {
    plugins.push(...scopedPluginFolders(bot, person).map((plugin) => plugin.name));
  }
  return host.turnConnectorsRecord({
    at: Date.now(),
    mounted: Object.keys(integrations.custom ?? {}),
    serverServers,
    personalServers,
    plugins,
    claudeAi,
    ...(claudeConnectors ? { claudeConnectors } : {}),
    grokCloud: host.grokCloudOnTurn(account, instance, bot)
  });

}
  return turnConnectorsFor;
}
