// @ts-nocheck
// #1388 wave 4 step 3: startTurn finish (catch + finally).
// Orchestrator owns try/catch/finally; these handlers take TurnState + host.
// Never imports server/index.ts.
import { recoveryCapabilityError } from "../automatic-recovery.ts";
import { INACTIVE_CAPABILITY_FAILED, inactiveCapabilityOutcome, isInactiveTurnCapabilityError } from "./inactive-turn-capability.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createFinishStartTurn(host: StartTurnHost) {
  const {
    ComputerWaitParked,
    DATA_DIR,
    DirectTurnSetupCancelled,
    EngineAccessLost,
    PlaceUnavailableError,
    TurnAuthenticationRefusedError,
    TurnNotStartedError,
    accessCardFor,
    assertWithinBudget,
    botRecoveryBackups,
    checkedTaskModelSwitch,
    clearCancelledProviderHandshake,
    clearDirectTurnDispatch,
    clearFailedAutoPin,
    clearTurnDigestState,
    computerSelectionTurns,
    cfg,
    deliverableNotification,
    coordinator,
    directCoordinationSettlers,
    directFollowupSettlers,
    directRequestOwners,
    directTurnBots,
    directTurnClaimIsCurrent,
    directTurnGenerationByThread,
    drainComputerResumes,
    drainDelegationWakes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    endMemoryTurn,
    engineAccessNotice,
    engineDisplayName,
    failedTurnTool,
    handoffs,
    hasQueuedSteeredMessages,
    holdSignInRefusal,
    hostedModels,
    isModelRefusal,
    limitBackupRefusedInThread,
    nextInChain,
    notify,
    notifyAccess,
    orgEngineTurnRefusal,
    policyModelRefusal,
    redactSecretsInText,
    registerComputerResume,
    releaseLocalVmThread,
    releasePlain,
    releaseTurnResources,
    rememberAutoRefusal,
    reportIncident,
    registry,
    retireProviderTurn,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    runningTurnEngines,
    settleDirectFollowup,
    store,
    subscriptionExpiredCard,
    threadBusy,
    turnAccessByThread,
    turnContext,
    turnHolder,
    turnUsage,
    vpsThreadEnded,
    watchdog,
  } = host;

  async function finishCatch(state: TurnState, cause: any): Promise<void> {
let e: any = cause;
      // Only the driver can prove that a task was never submitted and its
      // old process is gone. A timeout/error string alone is not that proof.
      const mayRecover = e instanceof TurnNotStartedError &&
        directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId);
      if (e instanceof TurnNotStartedError) {
        retireProviderTurn(e.turnId);
        // #3315: the engine refused a sign-in: new turns skip it for this payer.
        if (e instanceof TurnAuthenticationRefusedError) host.noteSignedOutTurn?.(state.bot, state.speaker ?? state.opts?.speaker ?? { origin: "person" }, state.instanceId);
        if (!mayRecover) e = new DirectTurnSetupCancelled("turn stopped during provider setup");
      }
      // #2632: a mint refused because this turn's generation was revoked
      // mid-setup is a stop or a reload, never an error step in the thread.
      const inactiveCapability = isInactiveTurnCapabilityError(e) ? inactiveCapabilityOutcome({
        claimCurrent: directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId),
        stopped: directRequestOwners.get(state.threadId)?.stopped === true,
        retried: state.opts?.capabilityRetried === true,
      }) : null;
      if (inactiveCapability === "cancelled") e = new DirectTurnSetupCancelled("turn stopped while its tools were mounted");
      handoffs.abandon(state.threadId, state.dispatchClaimId);
      if (computerSelectionTurns.get(state.threadId)?.generation === state.dispatchClaimId) computerSelectionTurns.delete(state.threadId);
      clearCancelledProviderHandshake(state.threadId, `direct:${state.dispatchClaimId}`);
      clearDirectTurnDispatch(state.threadId, state.dispatchClaimId);
      revokeInternalCapabilityGeneration(state.threadId, state.dispatchClaimId);
      const ownsLatestGeneration = directTurnGenerationByThread.get(state.threadId) === state.dispatchClaimId;
      releaseTurnResources(state.resourceOwner);
      if (ownsLatestGeneration) {
        runningTurnEngines.delete(state.threadId);
        endMemoryTurn(state.threadId);
        releasePlain(turnHolder(state.threadId));
        clearTurnDigestState(state.threadId);
        releaseLocalVmThread(state.threadId);
        vpsThreadEnded(state.bot.id, state.threadId);
        watchdog.settle(state.threadId);
        turnUsage.delete(state.threadId);
        turnContext.delete(state.threadId);
      }
      if (e instanceof DirectTurnSetupCancelled) {
        settleDirectFollowup(state.dispatchClaimId, { ok: false, text: e.message });
        state.opts?.onDispatchError?.(e.message);
        if (ownsLatestGeneration && threadBusy(state.bot.id, state.threadId)) {
          store.setTaskActivity(state.bot.id, state.threadId, "idle");
          directTurnBots.delete(state.threadId);
          retryDelegationsWaitingOn(state.bot.id);
        }
        if (ownsLatestGeneration) {
          drainQueuedSends();
          drainComputerResumes();
          drainSecretResumes();
          drainTeamSetupResumes();
          drainDelegationWakes();
        }
        return;
      }
      if (!ownsLatestGeneration) {
        settleDirectFollowup(state.dispatchClaimId, { ok: false, text: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (e instanceof ComputerWaitParked) {
        settleDirectFollowup(state.dispatchClaimId, { ok: false, text: e.message });
        // A turn the runtime owns (its root, or a coordination node) parks on
        // the seat there and continues in place once it frees (#2204): only a
        // turn outside the runtime registers the host's own resume.
        if (!coordinator.node(e.generation) && !directCoordinationSettlers.has(e.generation)) registerComputerResume({
          botId: state.bot.id,
          threadId: state.threadId,
          resource: e.resource,
          generation: e.generation,
          afterMessageId: store.activePath(state.threadId).findLast((entry: any) => entry.role === "user")?.id
        });
        // Settled as parked, not failed (#1651): the chip the wait appended
        // is the whole transcript story, and the registered resume owns what
        // happens next on this thread.
        if (store.taskByThread(state.bot.id, state.threadId)?.activity !== "dead") {
          store.setTaskActivity(state.bot.id, state.threadId, "parked.computer");
        }
        directTurnBots.delete(state.threadId);
        retryDelegationsWaitingOn(state.bot.id);
        drainQueuedSends();
        drainComputerResumes();
        drainSecretResumes();
        drainTeamSetupResumes();
        drainDelegationWakes();
        return;
      }
      // A failed place never sticks; a person's pin stays, and the message
      // names the composer.
      if (e instanceof PlaceUnavailableError) clearFailedAutoPin(state.bot.id, state.threadId, e.place);
      let message = e instanceof Error ? e.message : String(e);
      if (inactiveCapability === "retry") {
        // A provider reload retired this turn's bearers while it mounted its
        // tools: start it again once, with fresh ones. No await between
        // releasing this attempt and admitting the next.
        store.setTaskActivity(state.bot.id, state.threadId, "idle");
        directTurnBots.delete(state.threadId);
        try {
          await state.startTurn(state.bot.id, state.text, { ...state.opts, threadId: state.threadId, userMessage: state.userMessage, editedMessageId: undefined, capabilityRetried: true });
          directFollowupSettlers.delete(state.dispatchClaimId);
          directCoordinationSettlers.delete(state.dispatchClaimId);
          coordinator.dropTurn(state.dispatchClaimId, "Restarted after an engine reload");
          return;
        } catch (failure) {
          message = `${INACTIVE_CAPABILITY_FAILED} ${failure instanceof Error ? failure.message : String(failure)}`;
        }
      } else if (inactiveCapability === "fail") message = INACTIVE_CAPABILITY_FAILED;
      // Auto: an engine that refused to start this pick is skipped for this
      // payer, and the turn climbs the fallback chain once. A second
      // refusal is the engine's own error, below.
      if (mayRecover && state.autoTurn) {
        const refused = { instanceId: state.instanceId, model: state.model };
        // Only a real "this model is not yours" is remembered; a network
        // blip or a rate limit is not held against the model.
        if (isModelRefusal(message)) rememberAutoRefusal(state.autoTurn.payer, refused);
        const next = state.opts?.autoRetried ? null : nextInChain(state.autoTurn.pick, refused);
        if (next && !directRequestOwners.get(state.threadId)?.stopped && !hasQueuedSteeredMessages(state.bot.id, state.threadId) &&
            store.activePath(state.threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id === state.recoveryUserMessageId) {
          store.setTaskActivity(state.bot.id, state.threadId, "idle");
          directTurnBots.delete(state.threadId);
          store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: {
            name: `notice: Auto: ${engineDisplayName(state.instance)} could not start ${state.autoTurn.pick.modelLabel}. Trying the next model once.`, ok: true
          } });
          try {
            await state.startTurn(state.bot.id, state.text, { ...state.opts, threadId: state.threadId, userMessage: state.userMessage, editedMessageId: undefined,
              autoRetried: true, autoSkip: [...(state.opts?.autoSkip ?? []), refused] });
            directFollowupSettlers.delete(state.dispatchClaimId);
            directCoordinationSettlers.delete(state.dispatchClaimId);
            // The retry opened its own root (#2204): this attempt's is dropped.
            coordinator.dropTurn(state.dispatchClaimId, "Retried on another engine");
            return;
          } catch (failure) {
            message += ` Auto could not start the next model: ${failure instanceof Error ? failure.message : String(failure)}`;
          }
        }
      }
      const current = store.projectBotForTask(state.bot.id, state.threadId);
      // The bot's own recovery setting (server/bots/bot-runtime-settings.ts).
      const backups = botRecoveryBackups(current, cfg);
      const nextIndex = backups.findIndex((candidate: any, index: any) => index >= (state.opts?.automaticRecoveryIndex ?? 0) &&
        registry.get(candidate.instanceId)?.enabled && !orgEngineTurnRefusal(state.bot, registry.get(candidate.instanceId)!, state.opts?.speaker ?? { origin: "person" }) &&
        (!(e instanceof TurnAuthenticationRefusedError) || candidate.instanceId !== state.instanceId) &&
        (candidate.instanceId !== state.instanceId || candidate.model !== state.model));
      const backup = backups[nextIndex];
      if (mayRecover && backup && current && (!state.opts?.cardContinuation || state.opts.coordination) &&
          !directRequestOwners.get(state.threadId)?.stopped && !hasQueuedSteeredMessages(state.bot.id, state.threadId) &&
          // Unchanged since this turn began: an Auto turn compares the thread's
          // own selection (Auto and its base), not the pick it ran on.
          JSON.stringify(current.modelSelection) === JSON.stringify(state.autoTurn ? state.autoBaseSelection : state.bot.modelSelection) &&
          (backup.instanceId !== state.instanceId || backup.model !== state.model) &&
          store.activePath(state.threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id === state.recoveryUserMessageId) {
        // No await between releasing the failed attempt and admitting its
        // replacement: a newer send or Stop must never lose to a stale retry.
        store.setTaskActivity(state.bot.id, state.threadId, "idle");
        directTurnBots.delete(state.threadId);
        const checked = checkedTaskModelSwitch(current, backup, false, true);
        const target = checked.ok ? registry.get(checked.selection.instanceId) : null;
        const refusal = !checked.ok ? checked.error : !target || !target.enabled ? "The backup engine is unavailable."
          : !store.taskByThread(state.bot.id, state.threadId)?.cwd ? "This older thread has no pinned working folder. Choose its backup manually."
          : policyModelRefusal(target) ?? recoveryCapabilityError(
            { driverKind: state.instance.driverKind, capabilities: state.instance.adapter.capabilities },
            { driverKind: target.driverKind, capabilities: target.adapter.capabilities });
        if (!refusal && checked.ok && target) {
          try {
            assertWithinBudget(cfg, DATA_DIR);
            store.switchTaskModel(state.bot.id, state.threadId, checked.selection, false, {
              ...hostedModels?.resetTask(current.modelSelection, checked.selection), rewound: true
            });
            store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: {
              name: `recovery: Automatic recovery: ${state.instance.displayName || state.instance.driverKind} ${e instanceof TurnAuthenticationRefusedError ? "is signed out" : "could not start"}. Trying ${target.displayName || target.driverKind} · ${checked.selection.model} once in this thread.`, ok: true
            } });
            await state.startTurn(state.bot.id, state.text, { ...state.opts, threadId: state.threadId, userMessage: state.userMessage, editedMessageId: undefined,
              automaticRecoveryAttempted: true, automaticRecoveryIndex: nextIndex + 1 });
            // The backup now owns these callbacks; don't publish a failed
            // routine/peer result or release a queued receipt in between.
            directFollowupSettlers.delete(state.dispatchClaimId);
            directCoordinationSettlers.delete(state.dispatchClaimId);
            // The retry opened its own root (#2204): this attempt's is dropped.
            coordinator.dropTurn(state.dispatchClaimId, "Retried on another engine");
            return;
          } catch (failure) {
            message += ` Backup could not start: ${failure instanceof Error ? failure.message : String(failure)}`;
          }
        } else if (refusal) message = `Automatic recovery unavailable: ${refusal} Original error: ${message}`;
      }
      state.backupRefused = e instanceof EngineAccessLost ? limitBackupRefusedInThread(state.bot.id, state.threadId, state.speaker) : null;
      // #1533: Claude refused the person's own sign-in before the turn began
      const startExpired = e instanceof TurnAuthenticationRefusedError ? subscriptionExpiredCard(state.bot, state.instance, turnAccessByThread.get(state.threadId), e.message) : null;
      const personTurn = state.opts?.automationSource === undefined && !state.opts?.commsDepth && !state.opts?.cardContinuation;
      // #2057: a turn the person sent waits on the renew: renewed means the
      // same message goes again once and no card; failed means the card,
      // its notice and the incident, as before.
      const startHeld = startExpired ? holdSignInRefusal(state.bot, state.instance, startExpired, state.threadId,
        Boolean(personTurn && state.userMessage && !turnAccessByThread.get(state.threadId)?.routine), {
          show: (afterHold: boolean) => {
            store.appendMessage(state.threadId, { role: "bot", kind: "access", access: startExpired });
            notifyAccess(deliverableNotification("turn-failed", state.bot, state.threadId, engineAccessNotice("no_access", startExpired.engine, startExpired), { avatarUrl: state.bot.avatarUrl, personTurn: state.personLine === true }), startExpired);
            if (afterHold) {
              notify(deliverableNotification("turn-failed", state.bot, state.threadId, redactSecretsInText(e.message), { avatarUrl: state.bot.avatarUrl, personTurn: state.personLine === true }));
              reportIncident({ kind: "could-not-start", bot: state.bot, threadId: state.threadId, detail: e.message });
            }
          },
          resend: () => {
            void state.startTurn(state.bot.id, state.text, { ...state.opts, threadId: state.threadId, userMessage: state.userMessage, editedMessageId: undefined })
              .catch((failure: unknown) => {
                if ((failure as { code?: string }).code !== "answered") console.warn(`[sign-in-retry] ${state.threadId}: ${failure instanceof Error ? failure.message : String(failure)}`);
              });
            return true;
          },
          fail: () => {
            store.appendMessage(state.threadId, { role: "bot", kind: "activity", turnSucceeded: false, tool: failedTurnTool(e.message, {}) });
            reportIncident({ kind: "could-not-start", bot: state.bot, threadId: state.threadId, detail: e.message });
          }
        }) : false;
      if (state.backupRefused) message = state.backupRefused;
      else if (e instanceof EngineAccessLost) {
        // The owner key went away between admission and dispatch: the same
        // card and notice a refusal at admission gives.
        state.engine = engineDisplayName(state.instance);
        state.card = accessCardFor(state.bot, e.refusal, state.engine, e.detail);
        store.appendMessage(state.threadId, { role: "bot", kind: "access", access: state.card });
        message = engineAccessNotice(e.refusal.reason, state.engine, e.refusal);
        notifyAccess(deliverableNotification("turn-failed", state.bot, state.threadId, message, { avatarUrl: state.bot.avatarUrl, personTurn: state.personLine === true }), state.card);
      }
      settleDirectFollowup(state.dispatchClaimId, { ok: false, text: message });
      // The wait already wrote its failure resolution; keep all dispatch
      // failure bookkeeping below without adding the same error twice.
      if (!(e instanceof EngineAccessLost) && !startExpired) store.appendMessage(state.threadId, {
        role: "bot",
        kind: "activity",
        turnSucceeded: false,
        tool: failedTurnTool(message, e instanceof PlaceUnavailableError ? { place: e.row } : {})
      });
      // Worth a buzz for the same reason a routine failure is, and the rule
      // notify.ts encodes: the bot is not working, and the cause is usually
      // a setting only a person can change — an unattended user would
      // otherwise learn nothing until they next opened the thread.
      //
      // Only for a turn the person started themselves. A routine reaches
      // this same catch and then reports through onDispatchError, which
      // raises routine-failed; buzzing here too would ring twice for one
      // failure. A delegated sub-turn is reported to the bot that asked
      // for it, in its own thread, so it does not need a second channel.
      if (personTurn && !startHeld) {
        notify(
          deliverableNotification("turn-failed", state.bot, state.threadId, redactSecretsInText(message), { avatarUrl: state.bot.avatarUrl, personTurn: state.personLine === true }),
        );
        reportIncident({ kind: "could-not-start", bot: state.bot, threadId: state.threadId, detail: message });
      }
      store.setTaskActivity(state.bot.id, state.threadId, "idle");
      directTurnBots.delete(state.threadId);
      retryDelegationsWaitingOn(state.bot.id);
      state.opts?.onDispatchError?.(message);
      // a dispatch failure never emits turn.completed, so the settle-driven
      // drain would strand anything queued behind this turn
      drainQueuedSends();
      drainComputerResumes();
      drainSecretResumes();
      drainTeamSetupResumes();
      drainDelegationWakes();

  }

  async function finishFinally(state: TurnState): Promise<void> {
if (state.warmOnly) {
        try {
          clearDirectTurnDispatch(state.threadId, state.dispatchClaimId);
          await revokeInternalCapabilityGeneration(state.threadId, state.dispatchClaimId);
          releaseTurnResources(state.resourceOwner);
          // a real turn that started meanwhile owns these now (its own generation)
          const ownGeneration = (directTurnGenerationByThread.get(state.threadId) ?? state.dispatchClaimId) === state.dispatchClaimId;
          if (ownGeneration && runningTurnEngines.get(state.threadId) === state.instance) runningTurnEngines.delete(state.threadId);
          if (ownGeneration && directTurnBots.get(state.threadId) === state.bot) directTurnBots.delete(state.threadId);
          if (directTurnGenerationByThread.get(state.threadId) === state.dispatchClaimId) directTurnGenerationByThread.delete(state.threadId);
          if (directRequestOwners.get(state.threadId)?.generation === state.dispatchClaimId) directRequestOwners.delete(state.threadId);
          if (computerSelectionTurns.get(state.threadId)?.generation === state.dispatchClaimId) computerSelectionTurns.delete(state.threadId);
          handoffs.abandon(state.threadId, state.dispatchClaimId);
        } catch (error) {
          console.error(`[voice-call] warm skipped: ${error instanceof Error ? error.name : "error"}`);
          state.warmOk = false;
        }
        state.opts?.onWarmSettled?.(state.warmOk, state.instance?.driverKind);
        drainQueuedSends();
      }

  }

  return { finishCatch, finishFinally };
}
