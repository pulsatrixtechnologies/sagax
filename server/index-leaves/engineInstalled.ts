// @ts-nocheck
/** engineInstalled (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEngineInstalled(getHost: () => Host): any {
function engineInstalled(instanceId: string) {
  const host = getHost();

  // An engine of this image's lock answers from the startup self-check: no
  // probe on a page load or a turn.
  const pinned = host.selfCheckedEngine(instanceId);
  if (pinned) return pinned.ok;
  // An engine the image says it does not carry, run by its default name,
  // is not installed whatever a PATH lookup finds.
  if (host.engineNotAvailableReason(instanceId)) return false;
  const probe = host.engineProbes.get(instanceId);
  if (!probe || Date.now() - probe.at > host.ENGINE_PROBE_TTL_MS) void host.probeEngines().catch(host.reportBackgroundError);
  return probe?.installed ?? true;

}
  return engineInstalled;
}
