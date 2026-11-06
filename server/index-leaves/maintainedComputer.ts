// @ts-nocheck
/** maintainedComputer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMaintainedComputer(getHost: () => Host): any {
function maintainedComputer(key: string) {
  const host = getHost();

  if (key === "local") {
    if (host.IDENTITY.kind === "perspicax") return null;
    return { busy: async () => host.sharedLocalVmInUse(), update: host.scheduledLocalVmUpdate };
  }
  const principalId = key.startsWith("person:") ? key.slice("person:".length) : "";
  const sandbox = host.userSandbox;
  if (!principalId || !sandbox || host.IDENTITY.kind !== "perspicax") return null;
  return {
    busy: async () => {
      if (await sandbox.busy(principalId) > 0) return true;
      const view = await sandbox.status(principalId);
      return view.lastUsedAt !== null && Date.now() - view.lastUsedAt < host.SANDBOX_RECENT_USE_MS;
    },
    update: async () => { await sandbox.update(principalId); }
  };

}
  return maintainedComputer;
}
