// @ts-nocheck
/** personOAuth (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersonOAuth(getHost: () => Host): any {
function personOAuth(principalId: string) {
  const host = getHost();
  const { DATA_DIR, McpOAuthManager, McpOAuthVault, principalDir } = host;
  let manager = host.personOAuthManagers.get(principalId);
  if (!manager) {
    manager = new McpOAuthManager({ vault: new McpOAuthVault(principalDir(DATA_DIR, principalId), host.vaultKeySource) });
    host.personOAuthManagers.set(principalId, manager);
  }
  return manager;

}
  return personOAuth;
}
