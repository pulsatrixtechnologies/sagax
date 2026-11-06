// @ts-nocheck
/** turnOrigin (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createTurnOrigin(getHost: () => Host): any {
function turnOrigin(capability: Pick<InternalCapability, "threadId" | "generation" | "roomHandoffId" | "externalRuntime">) {
  const host = getHost();
  const { OUTSIDE } = host;

  if (capability.externalRuntime) return OUTSIDE;
  if (capability.roomHandoffId) {
    const node = host.coordinator.node(capability.roomHandoffId);
    return (node && host.coordinator.node(node.rootId)?.origin) ?? OUTSIDE;
  }
  const owner = host.directRequestOwners.get(capability.threadId);
  if (!owner?.origin || owner.stopped || !owner.generations.has(capability.generation)) return OUTSIDE;
  return owner.origin;

}
  return turnOrigin;
}
