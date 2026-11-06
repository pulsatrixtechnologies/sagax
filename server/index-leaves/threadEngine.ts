// @ts-nocheck
/** threadEngine (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createThreadEngine(getHost: () => Host): any {
function threadEngine(instanceId: string) {
  const host = getHost();

  const live = host.registry.get(instanceId);
  if (!live) return undefined;
  return {
    instanceId, driverKind: live.driverKind, enabled: live.enabled, models: live.models,
    capabilities: { modelVariants: live.adapter.capabilities.modelVariants === true },
    snapshot: host.registry.lastSnapshot(instanceId) ?? { state: "available" },
    access: host.providerConfigs()[instanceId]?.access ?? host.registry.access(instanceId)
  };

}
  return threadEngine;
}
