// @ts-nocheck
/** localComputerLifecycle (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalComputerLifecycle(getHost: () => Host): any {
async function localComputerLifecycle(kind: "update" | "reset") {
  const host = getHost();
  const { SHARED_LOCAL_VM_TARGET, containerComputerAction, localVmMode } = host;
  const refusal = host.hostComputerRefusal();
  if (refusal) throw Object.assign(new Error(refusal), { status: 403, code: "host_computer" });
  const target = SHARED_LOCAL_VM_TARGET;
  if (host.localVmImageBusy || host.localVmModeChangeBusy || host.localVmLifecycleBusy.has(target.key)) {
    throw Object.assign(new Error("another Local VM setup action is still running"), { status: 409, code: "busy" });
  }
  if (kind === "reset") {
    if (localVmMode(host.cfg) !== "shared") throw Object.assign(new Error("Each bot's desktop is reset from its own Computer panel in this mode."), { status: 409, code: "per_bot" });
    if (host.localVmLeaseFor(target).current(host.localVmOwnerBusy) || host.localVmActiveThreads.has(target.key)) {
      throw Object.assign(new Error("the Local VM is being used by a bot — stop that turn first"), { status: 409, code: "in_use" });
    }
    host.localVmLifecycleBusy.add(target.key);
    try {
      await containerComputerAction("remove", undefined, undefined, target);
      await containerComputerAction("run", undefined, undefined, target);
      host.localVmIdleFor(target).touch();
    } finally { host.localVmLifecycleBusy.delete(target.key); }
  } else {
    host.localVmImageBusy = true;
    try { await containerComputerAction("pull", undefined, undefined, target); }
    finally { host.localVmImageBusy = false; }
  }
  return host.localComputerSummary();

}
  return localComputerLifecycle;
}
