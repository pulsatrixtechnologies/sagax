// @ts-nocheck
/** mintInternalCapability (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMintInternalCapability(getHost: () => Host): any {
function mintInternalCapability(capability: Omit<InternalCapability, "orphanExpiresAt" | "turnStartedAt">, { perTurn = false } = {}) {
  const host = getHost();
  const { randomBytes } = host;

  if (host.activeInternalGenerationByThread.get(capability.threadId) !== capability.generation) {
    throw new Error("cannot mint an integration capability for an inactive turn");
  }
  // perTurn: a bridge into a machine the harness stops and starts between
  // turns (a Local VM, the VPS, a Boat). A warm engine never restarts a
  // server whose machine went away, so such a turn gets a new bearer and
  // starts its engine fresh.
  const token = perTurn ? randomBytes(24).toString("hex") : host.sessionBearer(capability);
  // Minted twice in one turn: keep that turn's record and its counters.
  if (host.internalCapabilities.get(token)?.generation !== capability.generation) {
    host.internalCapabilities.set(token, {
      ...capability,
      orphanExpiresAt: Date.now() + host.INTERNAL_CAPABILITY_ORPHAN_MS,
      turnStartedAt: Date.now()
    });
  }
  return token;

}
  return mintInternalCapability;
}
