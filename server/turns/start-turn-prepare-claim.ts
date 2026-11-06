// @ts-nocheck
// #1388 wave 4 step 3: startTurn prepare leaf. Never imports server/index.ts.
import { randomUUID } from "node:crypto";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState, PrepareResult } from "./start-turn-state.ts";

export function createPrepareClaimStartTurn(host: StartTurnHost) {
  const {
    IDENTITY,
    beginInternalCapabilityGeneration,
    computerSelectionTurns,
    coordinator,
    directCoordinationSettlers,
    directFollowupSettlers,
    directRequestOwners,
    directTurnBots,
    directTurnDispatchClaims,
    directTurnGenerationByThread,
    effectiveBotOwner,
    guestDrivenTurns,
    inheritedTeamComputer,
    orgSpeakerPrincipal,
    peerHopTurn,
    peerOwnerPrincipal,
    personAskAt,
    phoneToolTaintedThreads,
    remoteComputerForTurn,
    requestWorkOrigin,
    routineLineage,
    savedSteps,
    settleTrackedRequest,
    smallTalkTurns,
    store,
    turnContext,
    turnPayer,
    turnResourceOwners,
    turnRoutineLineage,
    turnRoutinePayers,
    turnRoutineTriggers,
    turnSpeakerPrincipals,
    turnSpeakers,
    turnTriggers,
    turnUsage,
    watchdog,
  } = host;


  return function(state: TurnState): PrepareResult {
  // Admitted: every refusal above has passed and no other turn runs on this
  // thread, so this is the one moment the ledger's "who asked" may change.
  if (!state.warmOnly && state.opts?.trigger) turnTriggers.set(state.threadId, state.opts.trigger);
  // A fresh delegated turn (coordinate_bots) is a new hop on its thread:
  // it records its speaker so a hop it starts in turn carries the same one.
  // A teammate's warm records the speaker its coordinate_bots turn will, so
  // both are judged for the same person (mcpIdentityEnv).
  if (!state.opts.cardContinuation || (state.opts.coordination && !state.opts.coordination.resumed) || (state.warmOnly && state.opts.warmCoordination === true)) {
    turnSpeakers.set(state.threadId, state.speaker);
    turnSpeakerPrincipals.set(state.threadId, orgSpeakerPrincipal(state.bot, state.speaker));
    // a fresh turn of its own: an earlier aside no longer taints it (phone tools)
    if (!state.warmOnly) phoneToolTaintedThreads.delete(state.threadId);
    if (routineLineage(state.speaker)) {
      turnRoutineLineage.add(state.threadId);
      state.payer = turnPayer({ speaker: state.speaker, owner: { principalId: effectiveBotOwner(state.bot) }, peerOwnerPrincipalId: peerOwnerPrincipal(state.speaker) }).principalId;
      if (state.payer) turnRoutinePayers.set(state.threadId, state.payer);
      else turnRoutinePayers.delete(state.threadId);
      state.trigger = directRequestOwners.get(state.threadId)?.automation ?? (state.speaker.origin === "peer" ? state.speaker.routineTrigger : undefined);
      if (state.trigger) turnRoutineTriggers.set(state.threadId, state.trigger);
      else turnRoutineTriggers.delete(state.threadId);
    } else {
      turnRoutineLineage.delete(state.threadId);
      turnRoutinePayers.delete(state.threadId);
      turnRoutineTriggers.delete(state.threadId);
    }
  }
  // A card continuation neither starts nor ends the person's ask: it
  // resumes the turn their last message began, so that record stands.
  if (!state.warmOnly && !state.opts?.cardContinuation) {
    if (state.commsDepth === 0 && state.opts?.automationSource === undefined && !state.opts?.unattended && !state.userMessage.peerAsk) {
      personAskAt.set(state.threadId, state.userMessage.at);
      // Where the person is now (server/threads/main-thread.ts). A line relayed
      // from Slack was written there, not in this conversation: the line
      // says so (Message.relayed), also in a turn a computer switch continues.
      if (!state.userMessage.relayed) store.setTaskAskedAt(state.bot.id, state.threadId, state.userMessage.at);
      // A background thread the server archived on its own is the person's
      // again once they write in it (server/threads/background-sweep.ts).
      // An AI client's prompt is not their writing: that thread stays put.
      if (!state.userMessage.relayed && state.task.openedBy?.kind !== "agent") store.restoreAutoArchived(state.bot.id, state.threadId);
      // Continuing an old run as a normal conversation makes that task
      // visible again; these new replies are not routine report updates.
      if (state.task.routineRunId) store.patchTask(state.bot.id, state.threadId, { routineRunId: undefined });
    } else {
      personAskAt.delete(state.threadId);
    }
  }

  // 2026-10-28: every turn of an engine that mounts the agents server gets
  // it; a teammate one hop away gets it without the peer tools (peerHop).
  // The person-facing parts (setup, skill authoring, the computer choice,
  // the team roster) stay with the turns that may reach a peer.
  state.peerHop = peerHopTurn(state.commsDepth, state.coordinated);
  state.agentsMounted = state.instance.adapter.capabilities.agentsMcp === true;
  state.peerToolsMounted = state.agentsMounted && !state.peerHop;

  // busy flips immediately so the composer locks; the dispatch itself runs
  // in the background — boat provisioning can take ~90s and must never
  // hang the HTTP request
  state.dispatchClaimId = randomUUID();
  // The same request again after its turn failed on a usage limit: the root
  // that turn opened (the work it handed out) continues with this turn. Its
  // own resume may have started meanwhile; then it answers the request, and
  // this turn does not run (nothing of it is recorded yet).
  if (!state.warmOnly && state.opts?.continuesGeneration &&
      ["answered", "resumed"].includes(coordinator.continueRoot(state.opts.continuesGeneration, state.dispatchClaimId))) {
    throw Object.assign(new Error("its teammates' results already answer this request"), { status: 409, code: "answered" });
  }
  if (state.smallTalk) {
    smallTalkTurns.set(state.threadId, { generation: state.dispatchClaimId, messageId: state.userMessage.id });
    if (smallTalkTurns.size > 2_000) smallTalkTurns.delete(smallTalkTurns.keys().next().value!);
  }
  // Guest-driven for as long as it runs, wherever it runs (cloudGuestDriven).
  if (state.guestConfined) guestDrivenTurns.set(state.threadId, state.dispatchClaimId);
  state.resourceOwner= { threadId: state.threadId, generation: state.dispatchClaimId };
  turnResourceOwners.set(state.threadId, state.resourceOwner);
  directTurnGenerationByThread.set(state.threadId, state.dispatchClaimId);
  state.requestMessageId = state.opts?.cardContinuation ? state.opts.requestMessageId : state.userMessage.id;
  const previousRequest = directRequestOwners.get(state.threadId);
  // This request replaces the thread's last one, which may have finished a
  // moment ago with its fence still up: its own settle waits on the digest,
  // while a queued line (the next Team incidents report, a person's
  // follow-up) drains at turn.completed. Close a finished one first, or it
  // reads unsettled forever.
  if (previousRequest && previousRequest.messageId !== state.requestMessageId) {
    settleTrackedRequest(state.threadId, new Set([state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])]));
    savedSteps.requestEnded(state.threadId, previousRequest.generations);
  }
  const requestGenerations = state.requestMessageId && previousRequest?.messageId === state.requestMessageId
    ? previousRequest.generations : new Set<string>();
  if (requestGenerations.size >= 500) { requestGenerations.clear(); state.requestMessageId = undefined; }
  requestGenerations.add(state.dispatchClaimId);
  // Settled once, for everything this request hands on. A continuation (a
  // card answer, a wake, a resume after the person acted, a surface change)
  // keeps the origin of the request it continues while that record is
  // still its own, and never re-reads a stored line: nothing on one says a
  // routine or a webhook wrote it.
  const continuation = Boolean(state.opts?.cardContinuation || state.opts?.computerSelectionContinuation);
  const continued = previousRequest && !previousRequest.stopped &&
    (state.requestMessageId ? previousRequest.messageId === state.requestMessageId : state.opts?.cardContinuation) ? previousRequest.origin : undefined;
  const requestOrigin = requestWorkOrigin({ trigger: state.opts?.automationSource, guest: state.guestConfined, handed: state.opts?.origin, continued,
    line: !continuation && state.requestMessageId === state.userMessage.id ? state.userMessage : undefined });
  directRequestOwners.set(state.threadId, { generation: state.dispatchClaimId, messageId: state.requestMessageId,
    generations: requestGenerations, turnId: null, ...(state.opts?.automationSource ? { automation: state.opts.automationSource } : {}), origin: requestOrigin,
    ...(state.userMessage.voiceCall || state.opts?.voiceCall ? { voiceCall: true as const } : {}),
    ...(state.personLine || (continued && previousRequest?.personLine) ? { personLine: true as const } : {}) });
  // On a Cloud home, a turn that is not provably the owner's leaves this
  // bot's memory "pending" until it ends (server/lending-memory.ts).
  // An unknown control-plane wake may invalidate a prior final, but it must
  // never acquire authority by guessing the latest user as its origin.
  const pendingSource = state.requestMessageId ?? store.activePath(state.threadId).findLast((message: any) => message.role === "user")?.id;
  if (!state.warmOnly && pendingSource) store.patchMessage(state.threadId, pendingSource, { requestPending: true });
  if (!state.warmOnly && state.opts?.coordination) {
    directCoordinationSettlers.set(state.dispatchClaimId, {
      nodeId: state.opts.coordination.id,
      settle: state.opts.coordination.settle,
    });
  }
  // Ordinary sources need the same exact completion ownership as queued
  // follow-ups: any normal turn may ask teammates to coordinate work.
  // A warm has no turn to settle.
  if (!state.warmOnly) directFollowupSettlers.set(state.dispatchClaimId, { threadId: state.threadId, settle: state.opts?.onTurnSettled });
  directTurnDispatchClaims.set(state.threadId, { id: state.dispatchClaimId, botId: state.botId, threadId: state.threadId, phase: "setup", ...(state.warmOnly ? { warm: true } : {}) });
  directTurnBots.set(state.threadId, state.bot);
  beginInternalCapabilityGeneration(state.threadId, state.dispatchClaimId);
  // The surface paragraph is part of the stable prompt. A call warm has no
  // saved user row, so it cannot register a selection, but the first spoken
  // turn will. Predict that paragraph or the engine relaunches on the first
  // words.
  const sharedComputerBlocksSelect = !remoteComputerForTurn({
    organization: IDENTITY.kind === "perspicax",
    runOnCloud: state.opts?.runOn === "cloud",
    hasTeamComputer: Boolean(inheritedTeamComputer(state.bot))
  }).skipRemote && Boolean(inheritedTeamComputer(state.bot));
  state.maySelectComputer = !state.opts?.computerSelectionContinuation && !state.opts?.cardContinuation && !state.opts?.automationSource && !state.opts?.unattended &&
      !state.opts?.commsDepth && !state.opts?.coordination && !sharedComputerBlocksSelect && state.bot.computer !== "off" && state.agentsMounted;
  if (!state.warmOnly && state.maySelectComputer) {
    state.source = store.activePath(state.threadId).findLast((message: any) => message.id === state.userMessage?.id && message.role === "user" && !message.peerAsk);
    if (state.source) computerSelectionTurns.set(state.threadId, { generation: state.dispatchClaimId, botId: state.bot.id, source: state.source, text: state.text, dataContext: state.opts?.dataContext });
  }
  // A warm must not look like work: no busy flag, no watchdog, no reopen
  // of a closed thread, no cleared badge. The first utterance joins it.
  if (!state.warmOnly) {
    store.setTaskActivity(state.bot.id, state.threadId, "working");
    // Watch from admission, not dispatch: a turn can wedge in setup — context
    // compaction that never returns, a hung browser or VM mount — long before
    // any provider event exists, and a watch armed only at dispatch never saw
    // those. Every setup exit below settles or throws into the catch, which
    // settles under the same generation ownership it already enforces.
    watchdog.watch(state.threadId, state.bot.id);
    // A closed thread that gets a new turn is open again: the person (or the
    // opener) picked it back up, so its row returns to the sidebar and
    // list_threads stops calling it closed. No-op on an open thread.
    store.setTaskClosedBy(state.bot.id, state.threadId, null);
    // The badge is "this bot answered you, and you have not looked yet". A
    // person starting a turn has looked; a teammate's hop has not — the fold
    // never re-marks an internal turn, so clearing here would silently spend
    // a signal the person still owes a glance to.
    if (state.commsDepth === 0) store.patchTask(state.bot.id, state.threadId, { unread: false });
    turnUsage.delete(state.threadId);
    turnContext.delete(state.threadId);
  }


  return { kind: "continue" };
  };
}
