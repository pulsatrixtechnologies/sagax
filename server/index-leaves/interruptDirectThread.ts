// @ts-nocheck
/** interruptDirectThread (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createInterruptDirectThread(getHost: () => Host): any {
async function interruptDirectThread(botId: string, threadId: string, options?: { preserveComputerResume?: boolean; cause?: DirectInterruptCause }) {
  const host = getHost();

  // A parked turn has settled its provider but still owns a future resume.
  // Stop cancels that work too. The parking teardown itself preserves it.
  // The parked row clears even when the resume lives on the runtime root
  // (#2526) rather than in pendingComputerResumes: Stop leaves the task idle.
  if (!options?.preserveComputerResume) {
    host.pendingComputerResumes.delete(threadId);
    if (host.store.taskByThread(botId, threadId)?.activity === "parked.computer") {
      host.store.setTaskActivity(botId, threadId, "idle");
    }
  }
  const requestOwner = host.directRequestOwners.get(threadId);
  if (requestOwner) {
    requestOwner.stopped = true;
    if (requestOwner.messageId) host.store.patchMessage(threadId, requestOwner.messageId, { requestCancelled: true });
  }
  const liveTurnId = host.liveTurnByThread.get(threadId);
  // Only a voice call turn is fenced: its late tokens and tool results must
  // not land. A typed turn keeps recording its cancelled tool row.
  if (liveTurnId && requestOwner?.voiceCall) {
    let cancelled = host.cancelledVoiceTurns.get(threadId);
    if (!cancelled) {
      cancelled = new Set();
      host.cancelledVoiceTurns.set(threadId, cancelled);
    }
    cancelled.add(liveTurnId);
    if (cancelled.size > 8) {
      const oldest = cancelled.values().next().value;
      if (oldest) cancelled.delete(oldest);
    }
  }
  // Stop belongs to the conversation it was pressed in. This bot's turn ends
  // and this conversation stops awaiting its teammates, so nothing resumes
  // into a stopped chat; assignments that never started are dropped. A
  // teammate already mid-turn keeps its own provider process, finishes, and
  // its result is still recorded here.
  // A safe-point cut, a park or an engine change is not that Stop: the
  // teammates' results still come back and resume this conversation (owner report,
  // 2026-11-01: "the bots do not answer me, I have to relaunch them").
  // The cards a parked node waits on offer no action any more (decision 4):
  // read before stopAwaitingDirect cancels the node, while they are its own.
  if (!host.interruptKeepsTeammates(options?.cause ?? "stop")) {
    host.stopParkedCards(threadId);
    host.noteTeammatesLeftRunning(threadId, host.coordinator.stopAwaitingDirect(threadId));
  }
  const owner = host.botForThread(botId, threadId);
  const generation = host.directTurnGenerationByThread.get(threadId);
  host.cancelDirectTurnDispatch(botId, threadId);
  host.revokeInternalCapabilitiesForThread(threadId);
  // Main routes Stop to the engine that started the turn; keep this branch's
  // generation fence so a replacement turn's approvals are never closed here.
  await (owner ? host.runningTurnInstance(owner, threadId) : null)?.adapter.interruptTurn(threadId);
  if (host.directTurnGenerationByThread.get(threadId) === generation) host.closeOpenApprovals(threadId);

}
  return interruptDirectThread;
}
