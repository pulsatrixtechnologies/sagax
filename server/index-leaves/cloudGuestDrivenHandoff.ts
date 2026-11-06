// @ts-nocheck
/** cloudGuestDrivenHandoff (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCloudGuestDrivenHandoff(getHost: () => Host): any {
function cloudGuestDrivenHandoff(nodeId: string | undefined) {
  const host = getHost();

  if (!nodeId) return false;
  let node = host.coordinator.node(nodeId);
  for (let steps = 0; node && steps < 32; steps++) {
    // Every conversation the work came through, up to the one it started in.
    if (node.id !== nodeId && host.cloudGuestDriven(node.threadId)) return true;
    if (node.id === node.rootId) break;
    node = host.coordinator.node(node.parentId ?? node.rootId);
  }
  return false;

}
  return cloudGuestDrivenHandoff;
}
