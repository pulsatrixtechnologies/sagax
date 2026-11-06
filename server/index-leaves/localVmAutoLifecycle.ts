// @ts-nocheck
/** localVmAutoLifecycle (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalVmAutoLifecycle(getHost: () => Host): any {
async function localVmAutoLifecycle(action: "run" | "start" | "remove") {
  const host = getHost();
  const { SHARED_LOCAL_VM_TARGET, containerComputerAction } = host;
  const target = SHARED_LOCAL_VM_TARGET;
  if (host.localVmImageBusy || host.localVmModeChangeBusy || host.localVmLifecycleBusy.has(target.key)) {
    throw new Error("another Local VM setup action is still running");
  }
  if (action === "remove" && (host.localVmLeaseFor(target).current(host.localVmOwnerBusy) || host.localVmActiveThreads.has(target.key))) {
    throw new Error("the Local VM is being used by a bot");
  }
  host.localVmLifecycleBusy.add(target.key);
  try {
    const status = await containerComputerAction(action, undefined, undefined, target);
    if (action === "remove") host.localVmIdleFor(target).cancel();
    else {
      host.localVmSeen.add(target.key);
      host.localVmIdleFor(target).touch();
    }
    return status;
  } finally {
    host.localVmLifecycleBusy.delete(target.key);
  }

}
  return localVmAutoLifecycle;
}
