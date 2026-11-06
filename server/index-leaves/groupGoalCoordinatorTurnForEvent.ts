// @ts-nocheck
/** groupGoalCoordinatorTurnForEvent (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createGroupGoalCoordinatorTurnForEvent(getHost: () => Host): any {
function groupGoalCoordinatorTurnForEvent(event: RuntimeEvent) {
  const host = getHost();

  const turns = host.groupGoalCoordinatorTurns.get(event.threadId);
  if (!turns?.size) return undefined;
  const candidates = [...turns];
  if (event.turnId) {
    const exact = candidates.find((turn) => turn.turnId === event.turnId);
    if (exact) return exact;
    // Until an interrupted handshake returns its own id, no new id can be
    // attributed safely. The stall fallback keeps this thread unavailable in
    // that narrow window; private text is suppressed below until sendTurn's
    // result binds the old guard or its bounded expiry releases ownership.
    const unboundDiscarded = candidates.filter((turn) => turn.discard && !turn.turnId);
    if (unboundDiscarded.length > 0) {
      // The ownership fallback below keeps a lone abandoned handshake's
      // thread closed, so its first eventual id can safely bind here. More
      // than one unbound candidate is genuinely ambiguous and stays gated.
      if (candidates.length === 1) {
        unboundDiscarded[0]!.turnId = event.turnId;
        // This event is the first stable identity for an already-abandoned
        // provider turn. Tombstone it immediately so this event and every
        // later completion/request cannot settle a replacement on the same
        // room thread.
        host.retireProviderTurn(event.turnId);
        return unboundDiscarded[0];
      }
      return undefined;
    }
    const pending = candidates.findLast((turn) => !turn.turnId && !turn.discard);
    if (pending && !pending.turnId) {
      pending.turnId = event.turnId;
      return pending;
    }
    return undefined;
  }
  // Turn-scoped events normally carry an id. If an adapter omits it, fail
  // closed for private text; with multiple overlapping guards there is no
  // safe way to attribute a completion, so leave cleanup to the bounded timer.
  return candidates.length === 1 ? candidates[0] : undefined;

}
  return groupGoalCoordinatorTurnForEvent;
}
