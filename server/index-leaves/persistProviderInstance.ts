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
  // 2026-11-19 (owner rule: a removal never waits): an account removed while
  // a turn runs on it leaves every list now; that turn finishes on its live
  // engine, which stops once the turn is over (the bots already moved).
  const leaving = Object.hasOwn(instances, instanceId) ? undefined : host.registry.get(instanceId);
  if (leaving && turnsOn(host, leaving)) {
    host.registry.release(instanceId);
    host.resetPathCache();
    drainRemovedInstance(host, instanceId, leaving, () => turnsOn(host, leaving));
    return;
  }
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

/** Whether a turn still runs on this live engine (start-turn-prompt.ts and
 * the group turns record it until turn.completed or session.exited). */
function turnsOn(host: Host, live: unknown): boolean {
  for (const engine of host.runningTurnEngines?.values?.() ?? []) if (engine === live) return true;
  return false;
}

/** Stops a removed account's engine once no turn runs on it any more. */
export function drainRemovedInstance(host: Host, instanceId: string, live: { dispose(): Promise<void> } | undefined, inFlight: () => boolean, everyMs = 2_000): void {
  const check = () => {
    if (inFlight()) { setTimeout(check, everyMs).unref?.(); return; }
    // the same account added back meanwhile has its own engine and events
    if (!host.registry.get(instanceId)) host.bus.detach(instanceId);
    void live?.dispose().catch(() => undefined);
  };
  check();
}
