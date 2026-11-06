// @ts-nocheck
/** localVmPayload (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalVmPayload(getHost: () => Host): any {
async function localVmPayload(target: LocalVmTarget, auth: RequestAuth) {
  const host = getHost();
  const { containerComputerStatus, localVmMaxInstances, localVmMode, localVmViewerStatus, setupCommands } = host;
  const status = await containerComputerStatus(undefined, undefined, target);
  return {
    ...localVmViewerStatus(status, auth),
    stop_reason: host.localVmStopReason(target.key, status),
    commands: setupCommands(status.runtime, process.platform, target),
    idle_timeout_ms: host.localVmIdleMs(),
    mode: localVmMode(host.cfg),
    max_instances: localVmMaxInstances(host.cfg),
    // The UI hides the per-bot choice: one environment per person instead.
    organization: host.IDENTITY.kind === "perspicax",
    // The automatic start on the desktop app (null elsewhere).
    auto: host.localVmAuto?.snapshot() ?? null
  };

}
  return localVmPayload;
}
