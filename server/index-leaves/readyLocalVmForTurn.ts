// @ts-nocheck
/** readyLocalVmForTurn (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createReadyLocalVmForTurn(getHost: () => Host): any {
async function readyLocalVmForTurn(botId: string, target: LocalVmTarget, isCurrent = () => true) {
  const host = getHost();
  const { SHARED_LOCAL_VM_TARGET, containerComputerAction, containerComputerStatus, localVmMaxInstances } = host;
  host.localVmLifecycleBusy.add(target.key);
  // Fence this target, and the cross-target capacity decision for creates,
  // before the first await — the same synchronous-fence-then-count shape
  // the panel route uses — so two concurrent turns cannot both pass the
  // per-bot limit between count and create.
  // Pool capacity is bounded by its seat indices. Each seat already has
  // its own lease/lifecycle fence, so independent cold seats can start
  // together without competing for the per-bot inventory's capacity gate.
  const pooled = target.key.startsWith("pool:");
  const ownsProvision = !pooled && !host.localVmProvisionBusy;
  if (ownsProvision) host.localVmProvisionBusy = true;
  let status: ContainerComputerStatus;
  try {
    status = await containerComputerStatus(undefined, undefined, target);
    host.noteLocalVmSeen(target, status);
    if (!isCurrent()) return status;
    const action = localVmWakeAction(status);
    // Not something a turn may fix itself (image missing, older image,
    // runtime stopped): the automatic start takes it in the background.
    if (!status.ready && !action && target.key === SHARED_LOCAL_VM_TARGET.key) void host.localVmAuto?.ensure("bot");
    if (status.ready || !action || !status.runtime) return status;
    // An organization server never creates a desktop on itself (the claim is
    // refused too; this keeps a turn from even starting one).
    if (host.hostComputerRefusal()) return status;
    // Another creation is already mid-flight and its container is not yet
    // visible to a count, so the safe answer is the inspected status —
    // exactly what the over-cap path below returns.
    if (action === "run" && !pooled && !ownsProvision) return status;

    if (action === "run" && target.key.startsWith("bot:")) {
      const count = await host.existingPerBotLocalVmCount(status.runtime);
      if (!isCurrent() || count >= localVmMaxInstances(host.cfg)) return status;
    }

    host.broadcast({ kind: "computer", botId, state: "provisioning" });
    try {
      status = await containerComputerAction(action, undefined, undefined, target);
    } catch {
      // Keep the inspected status: its `problem` names the real obstacle,
      // which is more use to the person than "podman run exited non-zero".
      // `run` can throw after the container exists, so arm the idle
      // backstop anyway — expiry defers while the target is busy and its
      // remove step no-ops unless a fresh probe sees a running container.
      // The problem text stays as inspected: cheaply telling a half-created
      // container from none here would need another container probe.
      host.localVmIdleFor(target).touch();
      return status;
    }
  } finally {
    if (ownsProvision) host.localVmProvisionBusy = false;
    host.localVmLifecycleBusy.delete(target.key);
  }
  host.localVmIdleFor(target).touch();

  // The container is up before Cua Driver is. Waiting here rather than failing
  // the turn is the whole point: a person who has been away eight hours should
  // not have to send their message twice.
  const deadline = Date.now() + host.LOCAL_VM_DESKTOP_WAIT_MS;
  while (isCurrent() && !status.ready && status.container === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    if (!isCurrent()) break;
    status = await containerComputerStatus(undefined, undefined, target);
  }
  return status;

}
  return readyLocalVmForTurn;
}
