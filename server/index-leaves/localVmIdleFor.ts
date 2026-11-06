// @ts-nocheck
/** localVmIdleFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createLocalVmIdleFor(getHost: () => Host): any {
function localVmIdleFor(target: LocalVmTarget) {
  const host = getHost();
  const { containerComputerAction, containerComputerStatus } = host;

  let idle = host.localVmIdles.get(target.key);
  if (idle) return idle;
  idle = new host.LocalVmIdleTimer(
    host.localVmIdleMs(),
    () => host.localVmImageBusy || host.localVmLifecycleBusy.has(target.key) || host.localVmActiveThreads.has(target.key),
    async () => {
      host.localVmLifecycleBusy.add(target.key);
      try {
        const status = await containerComputerStatus(undefined, undefined, target);
        // The pinned VNC startup clears stale X locks. Keep the container's
        // home and installed software so inactivity is a reversible stop.
        if (status.container === "running" && status.managed) {
          const stopped = await containerComputerAction("stop", undefined, undefined, target);
          host.recordLocalVmIdleStop(target.key, stopped.stopped_at);
        }
      } finally {
        host.localVmLifecycleBusy.delete(target.key);
      }
    },
  );
  host.localVmIdles.set(target.key, idle);
  return idle;

}
  return localVmIdleFor;
}
