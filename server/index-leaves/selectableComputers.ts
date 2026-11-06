// @ts-nocheck
/** selectableComputers (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSelectableComputers(getHost: () => Host): any {
async function selectableComputers(bot: BotRecord) {
  const host = getHost();
  const { browserEngineStatus, builtInBrowserEnabled, cloudPlaceRefusal, computerToolsRefusal, containerComputerStatus, surfaceLabel } = host;

  const instance = host.registry.get(bot.modelSelection.instanceId);
  const caps = instance?.adapter.capabilities;
  const off = bot.computer === "off";
  // A desktop the bot's tools cannot reach is not offered, and not probed.
  const toolsLeaveOut = computerToolsRefusal(bot.toolScope, "works-on", bot.name)?.message;
  const surfaces = (["cloud", "vm", "local", "browser"] as const);
  return Promise.all(surfaces.map(async surface => {
    let ready = false;
    let canStart = false;
    let canCreate = false;
    // On a Cloud home "this computer" reads as the person's own; name the
    // place the reason is about.
    let reason = "This computer is not configured or running. Open the Computer panel to set it up.";
    try {
      if (off) reason = "Computer access is Off in this bot's settings.";
      else if (toolsLeaveOut && surface !== "browser") reason = toolsLeaveOut;
      else if (surface === "cloud") {
        if (host.IDENTITY.kind === "perspicax") {
          ready = Boolean(host.userSandbox);
          if (!ready) reason = "The server environment is not set up.";
        } else if (bot.cloudBackend === "vps") {
          const status = host.canWorkOnCloud(host.cloudEngine(instance)) ? await host.vps.vpsComputerStatus(host.cfg, bot.id) : null;
          ready = status?.ready === true;
          canStart = Boolean(status?.daemonUp && status.managed && status.container === "stopped" &&
            status.image && status.imageMatches && status.network === "private" && status.mounts === "none" && status.security === "hardened");
          canCreate = Boolean(status?.configured && status.daemonUp && status.container === "missing");
          reason = status?.problem ?? reason;
        } else if (host.boat.boatConfigured(host.cfg) && host.canWorkOnCloud(host.cloudEngine(instance))) {
          const status = await host.boat.boatStatus(host.cfg, bot.id);
          const lifecycle = host.boat.boatTurnLifecycleAction(status.box?.state ?? null);
          ready = lifecycle === "attach";
          canStart = lifecycle === "wake";
          canCreate = lifecycle === "provision";
        } else {
          // The words the person reads for the same place (shared/place-view.ts).
          reason = (cloudPlaceRefusal(host.cloudEngine(instance, bot.modelSelection.model), "works-on", bot.name)
            ?? host.boatNotConfigured(bot, "works-on")).message;
        }
      } else if (surface === "vm" && caps?.computerMcp) {
        const target = host.localVmTargetForStatus(bot.id);
        const status = await containerComputerStatus(undefined, undefined, target);
        ready = status.ready;
        canCreate = !ready && host.autoLocalVmAttachable(status);
        if (ready || canCreate) host.noteLocalVmSeen(target, status);
        reason = status.problem ?? reason;
      } else if (surface === "local") {
        ready = host.shouldMountLocalComputer({ requested: "local", hostPlatform: process.platform,
          providerSupportsLocal: caps?.localComputerMcp === true }) && Boolean(host.readCuaConnection());
      } else if (surface === "browser") {
        ready = caps?.browserMcp === true && builtInBrowserEnabled(host.cfg) && bot.browser !== false && browserEngineStatus().kind === "ready";
        reason = "The built-in browser is disabled, not installed, or unsupported by this model.";
      }
    } catch (error) { reason = error instanceof Error ? error.message : String(error); }
    // Not offered at all when the organisation disallows it.
    const kind = surface === "local" ? "thisComputer" : surface === "vm" ? "localVm"
      : surface === "cloud" && host.IDENTITY.kind !== "perspicax" ? (bot.cloudBackend === "vps" ? "vps" : "box")
      : undefined;
    const managed = kind && host.managedPolicy.computerRefusal(kind);
    if (managed) return { surface, label: surfaceLabel(surface), available: false, ready: false, canStart: false, canCreate: false, reason: managed };
    const available = ready || canStart || canCreate;
    return { surface, label: surfaceLabel(surface), available, ready, canStart, canCreate, ...(!available ? { reason } : {}) };
  }));

}
  return selectableComputers;
}
