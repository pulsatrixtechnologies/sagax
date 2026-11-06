// @ts-nocheck
/** persistProviderInstance (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createPersistProviderInstance(getHost: () => Host): any {
async function persistProviderInstance(instanceId: string, instances: NonNullable<AppConfig["instances"]>) {
  const host = getHost();
  const { instanceConfigs, saveConfig } = host;

  saveConfig({ instances }, { replaceInstances: true });
  host.cfg.instances = instances;
  host.providerAuthSessions.clearInstance(instanceId);
  host.bus.detach(instanceId);
  // No whole-fleet reload: other bots keep their live CLI processes, event
  // subscriptions and approval capabilities while this one is replaced.
  if (Object.hasOwn(instances, instanceId)) {
    await host.registry.load({ [instanceId]: instanceConfigs(host.cfg)[instanceId] });
    const live = host.registry.get(instanceId);
    if (live) host.bus.attach([live]);
  } else {
    await host.registry.dispose(instanceId);
  }
  host.resetPathCache();

}
  return persistProviderInstance;
}
