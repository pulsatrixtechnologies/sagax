// @ts-nocheck
/** computerPreviewSurface (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createComputerPreviewSurface(getHost: () => Host): any {
async function computerPreviewSurface(bot: BotRecord, threadId?: string) {
  const host = getHost();
  const { containerComputerStatus } = host;

  const plan = host.turnSurfacePlan(bot, undefined, threadId);
  if (plan.computer !== undefined) return plan.computer === "off" && plan.browser ? "browser" : plan.computer;
  // Organization server: Auto is the person's server environment. Do not
  // ask a Boat or a VPS whether a cloud computer exists.
  if (host.IDENTITY.kind === "perspicax") return host.userSandbox ? "cloud" : plan.browser ? "browser" : "off";
  const instance = host.registry.get(bot.modelSelection.instanceId);
  if (bot.cloudBackend === "vps") {
    const remote = await host.vps.vpsComputerStatus(host.cfg, bot.id);
    if (remote.ready) return "cloud";
  }
  const target = host.localVmTargetForStatus(bot.id, threadId);
  // A Cloud home has neither place (cloud-home.ts), so Auto never shows one;
  // nor does an organization server or an organisation that disallows them.
  if (host.managedPolicy.computerAllowed("localVm") && instance?.adapter.capabilities.computerMcp && host.localVmSeen.has(target.key)) {
    const vm = await containerComputerStatus(undefined, undefined, target).catch(() => null);
    if (vm && host.autoLocalVmAttachable(vm)) return "vm";
  }
  if (host.managedPolicy.computerAllowed("thisComputer") && host.shouldMountLocalComputer({ requested: undefined, hostPlatform: process.platform,
    providerSupportsLocal: instance?.adapter.capabilities.localComputerMcp === true }) && host.readCuaConnection()) return "local";
  if (bot.cloudBackend === "vps") return "cloud"; // show its unavailable reason
  return plan.browser ? "browser" : "off";

}
  return computerPreviewSurface;
}
