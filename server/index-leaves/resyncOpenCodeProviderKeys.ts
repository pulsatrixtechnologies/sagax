// @ts-nocheck
/** resyncOpenCodeProviderKeys (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createResyncOpenCodeProviderKeys(getHost: () => Host): any {
function resyncOpenCodeProviderKeys() {
  const host = getHost();
  const { configStatus } = host;

  const allowed = host.openCodeKeysAllowed();
  if (allowed === host.openCodeKeysLastAllowed) return;
  host.openCodeKeysLastAllowed = allowed;
  for (const instance of host.registry.instances()) {
    if (instance.driverKind !== "opencodeGo") continue;
    void host.registry.refreshModels(instance.instanceId)
      .then(() => host.broadcast({ kind: "config", ...configStatus() }), () => {}).catch(host.reportBackgroundError);
  }

}
  return resyncOpenCodeProviderKeys;
}
