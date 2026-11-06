// @ts-nocheck
/** probeEngines (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createProbeEngines(getHost: () => Host): any {
function probeEngines() {
  const host = getHost();

  host.engineProbeFlight ??= (async () => {
    const next = new Map<string, EngineProbe>();
    await Promise.all(host.registry.entries().map(async (entry) => {
      const at = Date.now();
      const pinned = host.selfCheckedEngine(entry.instanceId);
      if (pinned) {
        next.set(entry.instanceId, host.engineProbeOf(entry.instanceId, pinned, at));
        return;
      }
      if (!entry.live) {
        next.set(entry.instanceId, { instanceId: entry.instanceId, driver: entry.shadow.driverKind, installed: false, at });
        return;
      }
      const live = entry.live;
      let snapshot: { state: string; reason?: string; version?: string | null; authenticated?: boolean };
      try {
        snapshot = await Promise.race([
          live.snapshot(),
          new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("probe timed out")), host.ENGINE_PROBE_TIMEOUT_MS).unref()),
        ]);
      } catch (error) {
        snapshot = { state: "unknown", reason: error instanceof Error ? error.message : String(error) };
      }
      const installed = snapshot.state === "available" || !host.CLI_MISSING.test(snapshot.reason ?? "");
      const ready = snapshot.state === "available" && snapshot.authenticated !== false;
      next.set(live.instanceId, { instanceId: live.instanceId, driver: live.driverKind, installed, ready, ...(snapshot.version ? { version: snapshot.version } : {}), at });
    }));
    host.engineProbes = next;
  })().finally(() => { host.engineProbeFlight = null; });
  return host.engineProbeFlight;

}
  return probeEngines;
}
