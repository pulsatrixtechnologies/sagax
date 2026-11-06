// @ts-nocheck
/** mountHostComputer (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMountHostComputer(getHost: () => Host): any {
async function mountHostComputer(   owner: TurnOwner,   botId: string,   providerSupportsLocal: boolean,   onRejected: (failure: string, error?: unknown) => void,   journal = false, ) {
  const host = getHost();

  if (!host.shouldMountLocalComputer({ requested: "local", hostPlatform: process.platform, providerSupportsLocal })) {
    // Name the condition that actually failed: a person told "choose an
    // ACP engine" while already on one has nowhere to go.
    throw new Error(providerSupportsLocal
      ? `local computer control is not available on ${process.platform} — select another destination`
      : "this model cannot control this computer — choose Claude or an ACP model provider, or select another destination");
  }
  const cua = host.readCuaConnection();
  if (!cua && !host.launchedByDesktopApp()) {
    throw new Error("Only the Sagax app on this computer can let a bot use it. Open the app here, or let the bot work in its own browser or on a cloud desktop instead.");
  }
  if (!cua) {
    const reason = host.readCuaUnavailableReason();
    throw new Error(reason
      ? `CUA Driver is not ready for this computer — ${reason}${process.platform === "darwin" && /(?:Screen Recording|Accessibility).*required/i.test(reason) ? ". Relaunch Sagax after granting the missing macOS permission." : ""}`
      : "CUA Driver is not ready for this computer — check permissions and restart Sagax");
  }
  await host.bindTurnComputer(owner, "computer:host");
  host.autoVmClaims.set(owner.threadId, {
    owner, lazy: true, label: "this computer", onRejected,
    claim: () => host.bindTurnComputer(owner, host.HOST_COMPUTER_RESOURCE, true)
  });
  return host.gatedLocalComputer(cua, host.controlIntegration(botId, owner.threadId, owner.generation, "this computer"), journal);

}
  return mountHostComputer;
}
