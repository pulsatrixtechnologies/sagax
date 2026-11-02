// @ts-nocheck
// #1388 wave 4 step 3: startTurn stream post-dispatch leaf.
// Takes TurnState + host; no closures over orchestrator locals.
// Never imports server/index.ts.
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createStreamStartTurn(host: StartTurnHost) {
  const {
    DirectTurnSetupCancelled,
    bindInternalCapabilityToProviderTurn,
    clearDirectTurnDispatch,
    directFollowupSettlers,
    directFollowupTurns,
    directRequestOwners,
    directTurnGenerationByThread,
    drainComputerResumes,
    drainDelegationWakes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    handoffs,
    isExternalContextMarker,
    noteCallBesideConversation,
    releaseTurnResources,
    retireProviderTurn,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    settleDirectCoordination,
    settleDirectFollowup,
    settlingResourceOwners,
    startScreenPoller,
    store,
    threadBusy,
    voiceLatency,
    voiceSessions,
  } = host;

  return async function streamStartTurn(state: TurnState): Promise<void> {
      if (state.dispatch.cancelled) {
        retireProviderTurn(state.dispatch.value.turnId);
        throw new DirectTurnSetupCancelled("turn stopped during provider setup");
      }
      voiceLatency.mark(state.threadId, "engine", { warm: state.dispatch.value.reused === true });
      const requestOwner = directRequestOwners.get(state.threadId);
      if (requestOwner?.generation === state.dispatchClaimId && state.dispatch.value.turnId) {
        if (requestOwner.turnId && requestOwner.turnId !== state.dispatch.value.turnId) {
          requestOwner.messageId = undefined;
          requestOwner.origin = undefined;
        }
        requestOwner.turnId = state.dispatch.value.turnId;
      }
      bindInternalCapabilityToProviderTurn(state.threadId, state.dispatchClaimId, state.dispatch.value.turnId);
      handoffs.bindTurn(state.threadId, state.dispatchClaimId, state.dispatch.value.turnId);
      if (directFollowupSettlers.has(state.dispatchClaimId) && state.dispatch.value.turnId &&
        !directFollowupTurns.bind(state.threadId, state.dispatchClaimId, state.dispatch.value.turnId)) {
        // This exact queued turn completed before its dispatch ACK arrived.
        const outcome = directFollowupTurns.takeEarlyCompletion(state.threadId, state.dispatch.value.turnId);
        if (outcome) settleDirectCoordination(state.dispatchClaimId, outcome);
        settleDirectFollowup(state.dispatchClaimId);
      }
      clearDirectTurnDispatch(state.threadId, state.dispatchClaimId);
      // dispatched: the rewind is spent, and the old cursors are dead
      // A call turn ran in its own session: the conversation's session keeps
      // its pending rebuild and learns what the call said on its next turn.
      if (state.voiceView) {
        voiceSessions.dispatched(state.threadId, state.voiceHanded, state.voiceAnchor);
        if (!state.warmOnly) noteCallBesideConversation(state.bot, state.threadId, state.contextOrder[state.contextOrder.indexOf(state.userMessage.id) - 1]);
      }
      if (state.rewound && !state.contextStillPending && !state.voiceView) store.patchTask(state.bot.id, state.threadId, { rewound: false, resumeCursors: {} });
      if (state.contextReset && state.record && !state.contextStillPending && !state.voiceView) store.patchTask(state.bot.id, state.threadId, { appliedCompactionId: state.record.id, contextFloor: undefined });
      // and this engine now owns the thread's most recent turn
      // Consume exactly the external-update generation this turn replayed.
      // If a newer delegated result landed during setup, its unique marker
      // differs and must survive so the next turn also receives that update.
      if (!state.contextStillPending && !state.voiceView && (!isExternalContextMarker(state.task.lastInstanceId) || state.task.lastInstanceId === state.externalContextMarker)) {
        store.markTaskDispatched(state.bot.id, state.threadId, state.instanceId);
      }
      // a turn can settle before dispatch returns, and a poller started
      // after its own turn.completed would never be torn down — it would
      // keep polling the boat forever, carrying dead per-turn state. busy
      // is flipped false in the fold, so it is the honest "still running".
      if ((state.previewCapture || state.browserCapture) && threadBusy(state.bot.id, state.threadId)) {
        startScreenPoller(
          state.bot.id,
          state.threadId,
          { ...(state.previewCapture ? { computer: state.previewCapture } : {}), ...(state.browserCapture ? { browser: state.browserCapture } : {}) },
        );
      }
      // An adapter may publish completion synchronously just before its
      // dispatch promise resolves. The event could not use the turn-id map
      // above yet, so close this exact generation from durable busy state.
      if (!threadBusy(state.bot.id, state.threadId) && directTurnGenerationByThread.get(state.threadId) === state.dispatchClaimId) {
        revokeInternalCapabilityGeneration(state.threadId, state.dispatchClaimId);
        if (settlingResourceOwners.get(state.threadId) !== state.dispatchClaimId) releaseTurnResources(state.resourceOwner);
        retryDelegationsWaitingOn(state.bot.id);
        drainQueuedSends();
        drainComputerResumes();
        drainSecretResumes();
        drainTeamSetupResumes();
        drainDelegationWakes();
      }
  };
}
