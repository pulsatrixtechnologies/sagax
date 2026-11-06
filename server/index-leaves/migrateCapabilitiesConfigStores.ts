// @ts-nocheck
/** migrateCapabilitiesConfigStores (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMigrateCapabilitiesConfigStores(getHost: () => Host): any {
function migrateCapabilitiesConfigStores() {
  const host = getHost();
  const { DATA_DIR, saveConfig, store } = host;
  try {
    host.migrateGithubCredentials();
    const result = host.migrateCapabilitiesStores({
      dataDir: DATA_DIR,
      bots: host.botCapabilityStore,
      installation: host.installationCapabilityStore,
      botIds: () => [...new Set([...store.bots.map((bot) => bot.id), ...discoverBotPluginIds(DATA_DIR)])],
      personIds: () => host.discoverPersonIds(DATA_DIR),
      assignedSkillsFor: (botId) => host.store.bot(botId)?.assignedSkills ?? [],
      readMcpServers: () => (host.cfg.mcpServers ?? {}) as Record<string, unknown>,
      clearMcpServers: () => {
        saveConfig({ mcpServers: {} });
        host.cfg.mcpServers = {};
      },
      githubCredentialsMigrated: () => host.githubCredentialsMigrated
    });
    host.setInstallationCapabilityBridge(host.makeInstallationCapabilityBridge(host.installationCapabilityStore));
    try {
      if (host.installationCapabilityStore.hasMigrated("config-mcp-servers")) {
        host.cfg.mcpServers = host.installationCapabilityStore.read().mcpServers as typeof host.cfg.mcpServers;
      }
    } catch {
      // vault not ready: keep config.json mcpServers until the next call
    }
    if (result.imported.length) {
      console.log(`[capabilities-stores] migrated ${result.imported.length} source(s) into bot/person/installation stores`);
    }
  } catch (error) {
    console.warn(`[capabilities-stores] migration deferred: ${(error as { code?: string })?.code ?? (error instanceof Error ? error.message : "unreadable")}`);
  }

}
  return migrateCapabilitiesConfigStores;
}
