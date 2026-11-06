// @ts-nocheck
/** cancelDirectTurnDispatch (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createCancelDirectTurnDispatch(getHost: () => Host): any {
function cancelDirectTurnDispatch(botId: string, expectedThreadId?: string): DirectTurnDispatchClaim | null {
  const host = getHost();
  const threadId = expectedThreadId ?? host.store.bot(botId)?.threadId;
  if (!threadId) return null;
  const claim = host.directTurnDispatchClaims.get(threadId);
  if (!claim || claim.botId !== botId) return null;
  const compacting = host.compactionControllers.get(threadId);
  if (compacting?.generation === claim.id) compacting.controller.abort(new host.DirectTurnSetupCancelled("context summarization stopped"));
  host.directTurnDispatchClaims.delete(threadId);
  if (host.directTurnGenerationByThread.get(threadId) === claim.id) host.clearTurnDigestState(threadId);
  // Setup has not called the adapter yet, so there is no provider handshake
  // (and no unknown turn id) to quarantine. Dispatching is the only phase in
  // which a late provider event can exist.
  if (claim.phase === "dispatching") {
    host.markCancelledProviderHandshake(claim.threadId, `direct:${claim.id}`);
  }
  // Keep setup ownership until the guarded send resolves and retires its
  // provider turn id. Some adapters can emit completion synchronously just
  // before sendTurn returns; making the bot idle here would let a replacement
  // start early enough for those old events to settle the replacement.
  return claim;
}
  return cancelDirectTurnDispatch;
}
