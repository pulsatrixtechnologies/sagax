// @ts-nocheck
/** settleDirectFollowup (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSettleDirectFollowup(getHost: () => Host): any {
function settleDirectFollowup(generation: string | undefined, outcome: DirectTurnOutcome = { ok: false, text: "The coordinated turn was interrupted" }) {
  const host = getHost();

  if (!generation) return;
  host.settleDirectCoordination(generation, outcome);
  const pending = host.directFollowupSettlers.get(generation);
  if (!pending) return;
  host.directFollowupSettlers.delete(generation);
  // Failure/Stop can precede the adapter's terminal event. Quarantine only
  // this generation's bound ids, including after the watchdog frees its slot.
  for (const turnId of host.directFollowupTurns.deleteGeneration(pending.threadId, generation)) host.retireProviderTurn(turnId);
  pending.settle?.();

}
  return settleDirectFollowup;
}
