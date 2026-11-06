// @ts-nocheck
/** persistMcpServers (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersistMcpServers(getHost: () => Host): any {
function persistMcpServers(next: Record<string, unknown>) {
  const host = getHost();
  const { saveConfig } = host;

  try {
    if (host.installationCapabilityStore.hasMigrated("config-mcp-servers")) {
      const document = host.installationCapabilityStore.read();
      const previous = document.mcpServers ?? {};
      document.mcpServers = next;
      host.installationCapabilityStore.write(document);
      host.cfg.mcpServers = next;
      // not a config.json save: the admin journal is told here (mcp.update)
      host.recordAdminConfigChange({ mcpServers: previous }, { mcpServers: next });
      return;
    }
  } catch {
    // vault not ready: fall through to config.json
  }
  saveConfig({ mcpServers: next });
  // Do not reload the provider fleet: integrations are assembled from cfg at
  // the next turn boundary. Updating this property directly also correctly
  // clears the final entry; Object.assign(loadConfig()) would leave it stale
  // when an empty section is omitted by an older config file.
  host.cfg.mcpServers = next;

}
  return persistMcpServers;
}
