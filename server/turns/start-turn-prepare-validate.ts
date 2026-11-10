// @ts-nocheck
// #1388 wave 4 step 3: startTurn prepare leaf. Never imports server/index.ts.
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState, PrepareResult } from "./start-turn-state.ts";
import { resolveModelAccount } from "../models/resolve-model-account.ts";
import { activeEngineRefusal } from "../engines/engine-refusals.ts";
import { pluginKey, pluginsNamedIn, type AccountCreditState } from "../../shared/model-account-pool.ts";

export function createPrepareValidateStartTurn(
  host: StartTurnHost,
  admit: (state: TurnState) => Promise<PrepareResult>,
) {
  const {
    BOTMAIL_ENGINE_REFUSAL,
    DATA_DIR,
    IDENTITY,
    activeRoutineRunForThread,
    applyViewerModelOverride,
    assertTurnAdmission,
    assertWithinBudget,
    autoPickForTurn,
    boatLifecycleBusyBots,
    botmailConfined,
    cfg,
    clearUnattended,
    cloudGuestDriven,
    cloudGuestDrivenHandoff,
    computerSelectionMoves,
    delegationWakeBudget,
    directMachinePlan,
    effectiveBotOwner,
    effortAcceptedByEngine,
    engineReference,
    guestDrivenTurns,
    guestEngineRefusal,
    healBotEngine,
    healOrgRefusedThreadModel,
    healThreadModel,
    holdDirectMachineTurn,
    hostedModels,
    joinPrewarm,
    limitFailover,
    markUnattended,
    modelSwitchRefusal,
    namesEngine,
    noEngineError,
    orgEngineTurnRefusal,
    peerThreadFor,
    policyModelRefusal,
    providerInstancesChanging,
    providerTransitionForTurn,
    recordedBotOwner,
    registeredWorkers,
    registry,
    removedComputerInstanceIds,
    resolveTurnSpeaker,
    retryComputerEngineMove,
    revokeEarlierTurnCapabilities,
    routineRunSpeaker,
    routines,
    sharedBotForViewer,
    speakerPayerMode,
    speakerTurnSelection,
    store,
    threadPrewarm,
    toolScopeForTurn,
    turnAnswers,
    turnModelRequested,
    turnModelSwitches,
    turnSurfacePlan,
    turnTrace,
    viewerBotOverrideStore,
    voiceCalls,
    voicePickForTurn,
    voiceSessions,
    voiceWarmup,
    warmPayerAccountModels,
    workspaceMaintenance,
  } = host;


  return async function(state: TurnState): Promise<PrepareResult> {
  workspaceMaintenance.assertAvailable();
  state.profile = store.bot(state.botId);
  if (!state.profile) throw Object.assign(new Error("no such bot"), { status: 404 });
  // No named thread: never a confidential one (peerThreadFor).
  state.threadId = state.opts?.threadId ?? peerThreadFor(state.profile);
  state.continuingRoutine = state.opts?.cardContinuation ? activeRoutineRunForThread(state.threadId) : null;
  if (state.continuingRoutine) {
    state.onDispatchError = state.opts?.onDispatchError;
    state.opts = {
      ...state.opts,
      runOn: state.continuingRoutine.runOn,
      automationSource: state.continuingRoutine.triggerSource ?? (state.continuingRoutine.manual ? "manual" : "schedule"),
      // Slice 6: the routine still speaks as the person it runs as.
      speaker: routineRunSpeaker(state.continuingRoutine),
      onDispatchError: (message: any) => {
        routines?.failThread(state.threadId, message);
        state.onDispatchError?.(message);
      }
    };
  }
  // A thread whose own model can't run runs on its bot's from now on.
  healThreadModel(state.botId, state.threadId);
  // Organization server: the same, for a thread's own model that this
  // turn's payer has no credentials for here (a model picked on a desktop,
  // such as a local model on pi) while the bot's own model can run.
  if (IDENTITY.kind === "perspicax") {
    healOrgRefusedThreadModel(state.botId, state.threadId, resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk),
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    }));
  }
  // A routine run, webhook run or proactive wake a usage limit refused goes
  // on with the model that took it over (server/routines/routine-recovery.ts
  // takeOver): its thread moves there before anything reads its model.
  const takenOverRun = !state.opts?.warmOnly && state.opts?.automationSource ? activeRoutineRunForThread(state.threadId) : null;
  state.limitTakeover = takenOverRun?.limitTakeover;
  // A usage limit (server/usage/limit-failover-host.ts): back on the thread's own
  // engine once it reset, or onto a backup while it is known to refuse.
  // Never for a warm-up or a card's continuation of a running turn.
  if (!state.opts?.warmOnly && !state.opts?.cardContinuation) {
    const limitSpeaker = resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk),
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    });
    // Back on the conversation's own model after that limit's reset
    // (limitTakeoverUntil), even when the refusal held only one model.
    if (state.limitTakeover) {
      limitFailover.takeOver(state.botId, state.threadId, state.limitTakeover, limitSpeaker, takenOverRun?.limitTakeoverUntil, takenOverRun?.limitTakeoverEstimated === true);
    }
    const switching = limitFailover.beforeTurn(state.botId, state.threadId, limitSpeaker);
    if (switching) await switching;
  }
  state.bot = store.projectBotForTask(state.botId, state.threadId);
  if (!state.bot) throw Object.assign(new Error("no such task"), { status: 404 });
  // A bot pinned to a computer never starts on this server, including a 1:1.
  // The desktop pulls the turn and runs it with the engines on that machine.
  if (!state.opts?.warmOnly && directMachinePlan({ host: state.bot.host, workers: registeredWorkers }).kind === "hold") {
    return { kind: "return", value: holdDirectMachineTurn(state.bot, state.threadId, state.text, state.opts) };
  }
  // A person who does not own this bot runs on their own model and effort
  // when they set one. The stored bot and the thread stay the owner's.
  if (IDENTITY.kind === "perspicax") {
    const earlySpeaker = resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk),
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    });
    state.person = earlySpeaker.origin === "person" ? earlySpeaker.principalId?.trim().toLowerCase() : "";
    // #1137: when the owner pays, the bot answers on the owner's model, not
    // on a model of the viewer's own.
    const ownerPays = speakerPayerMode(state.bot, earlySpeaker) === "owner";
    if (state.person && !ownerPays && sharedBotForViewer(recordedBotOwner(state.bot), state.person)) {
      state.selection = applyViewerModelOverride(
        state.bot.modelSelection,
        viewerBotOverrideStore.getOne(state.person, state.bot.id),
        (level: any, instanceId: any) => {
          state.levels = registry.get(instanceId)?.adapter.capabilities.effortLevels;
          return Array.isArray(state.levels) && effortAcceptedByEngine(level, state.levels);
        },
      );
      if (state.selection !== state.bot.modelSelection) state.bot = { ...state.bot, modelSelection: state.selection };
    }
    // #1137, #1154: the bot's model cannot run for the person who pays (no
    // credentials of theirs for its engine, or their session does not offer
    // it), so it answers with a model they can run, for this turn only.
    if (!state.opts?.warmOnly && !state.opts?.cardContinuation) warmPayerAccountModels(state.bot, earlySpeaker);
    const switched = speakerTurnSelection(state.bot, earlySpeaker);
    if (switched && !state.opts?.warmOnly) {
      state.bot = { ...state.bot, modelSelection: switched.selection };
      turnModelSwitches.set(state.threadId, { botId: state.bot.id, requested: switched.requested, actual: switched.selection, ...(state.person ? { principalId: state.person } : {}) });
      turnModelRequested.set(state.threadId, switched.requested);
    } else if (switched) {
      state.bot = { ...state.bot, modelSelection: switched.selection };
    } else {
      turnModelSwitches.delete(state.threadId);
      turnModelRequested.delete(state.threadId);
    }
  }
  // Auto (docs/plans/2026-10-08-auto-model.md): this turn's model. A
  // person's turn runs on the orchestration model; work a bot handed out
  // (a peer hop, a routine, a parallel task it opened) on the model its
  // class of work calls for; a continuation keeps the thread's last pick.
  // The stored bot and thread keep Auto and their base model.
  state.autoTurn = null;
  state.autoContinuing = false;
  /** The thread's own selection (Auto and its base) before the pick replaced it. */
  state.autoBaseSelection = state.bot.modelSelection;
  if (state.bot.modelSelection.auto === true) {
    const autoPeerAsk = state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk);
    const autoSpeaker = resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      peerAsk: autoPeerAsk,
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    });
    // A fresh coordinate_bots hop rides a card continuation but is new work.
    const freshAutoHop = Boolean(state.opts?.coordination && !state.opts.coordination.resumed);
    state.autoContinuing = !freshAutoHop && Boolean(state.opts?.cardContinuation || state.opts?.computerSelectionContinuation || state.opts?.compactOnly || state.opts?.warmOnly);
    const worker = Boolean(autoPeerAsk) || (state.opts?.commsDepth ?? 0) > 0 || state.opts?.automationSource !== undefined || state.opts?.autoWorker === true;
    state.autoTurn = autoPickForTurn({
      bot: state.bot, threadId: state.threadId, speaker: autoSpeaker, text: state.text,
      role: state.autoContinuing && !state.opts?.autoSkip?.length ? "continue" : worker ? "worker" : "orchestration",
      fallback: worker ? "worker" : "orchestration",
      // A guest's turn on a Cloud home only goes to an engine that confines it.
      guestConfined: cloudGuestDriven(state.threadId) || cloudGuestDrivenHandoff(state.opts?.coordination?.id) || botmailConfined(state.threadId),
      ...(state.opts?.autoSkip ? { skip: state.opts.autoSkip } : {})
    });
    // Recorded on the task once the turn is admitted (below), never before.
    if (state.autoTurn) state.bot = { ...state.bot, modelSelection: state.autoTurn.pick.selection };
  }
  // A turn said on a live call, and the warm that prepares its process, run
  // on a fast model (server/voice/voice-turn.ts): the person waits in silence for
  // the first word. Pinned or Auto alike. Heavy work is handed to a parallel task on
  // the bot's main model by the call turn itself.
  state.voiceTurnPick= null;
  /** The turn runs in the call's own session, from a short view of the
   * conversation (server/voice/voice-turn.ts), not in the conversation's session. */
  state.voiceCallTurn = false;
  if (voiceCalls.active(state.threadId) && !state.opts?.commsDepth && !state.opts?.coordination && !state.opts?.automationSource
    && !state.opts?.compactOnly && !state.opts?.unattended && !(state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk))) {
    const voiceSpeaker = resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    });
    state.voiceCallTurn = true;
    state.voiceTurnPick = voicePickForTurn(state.bot, state.autoBaseSelection, voiceSpeaker,
      cloudGuestDriven(state.threadId) || cloudGuestDrivenHandoff(state.opts?.coordination?.id) || botmailConfined(state.threadId));
    if (state.voiceTurnPick) {
      state.bot = { ...state.bot, modelSelection: state.voiceTurnPick.selection };
      state.autoTurn = null;
    }
  } else if (!voiceCalls.active(state.threadId) && voiceSessions.has(state.threadId)) {
    // the call expired without a hang-up: its session is gone with it
    voiceSessions.end(state.threadId);
  }
  // 2026-10-30: a proactive wake runs on the fast model when there is one,
  // the same pick as a call turn (#1694): most wakes are a quick look.
  // Auto keeps its own pick; a request that needed a connector keeps it.
  // Wakes use triggerSource "proactive"; legacy rows may still be webhook+proactive.
  const proactiveWake =
    state.opts?.automationSource === "proactive" ||
    (state.opts?.automationSource === "webhook" && activeRoutineRunForThread(state.threadId)?.proactive);
  // A wake a usage limit already moved (limitTakeover, above) runs on the
  // model that took it over, never on the fast pick that was refused.
  let wakePick = null;
  if (!state.voiceTurnPick && !state.autoTurn && !state.opts?.warmOnly && proactiveWake && !state.limitTakeover) {
    wakePick = voicePickForTurn(state.bot, state.autoBaseSelection, resolveTurnSpeaker({ speaker: state.opts?.speaker, automationSource: state.opts?.automationSource }), botmailConfined(state.threadId));
    if (wakePick) state.bot = { ...state.bot, modelSelection: wakePick.selection };
  }
  // Sagax runs this turn on a fast model of its own pick, not on the
  // conversation's: a limit that refuses it is that model's (limit failover).
  state.fastDetour = Boolean(state.voiceTurnPick ?? wakePick);
  // Routines and legacy peer delivery already have their own completion
  // owners. Only ordinary chats opt into this scheduler; its child turns
  // carry an exact node id rather than inheriting a routine's lifetime.
  // A teammate's warm is shaped as the coordinate_bots turn it precedes.
  state.coordinated = Boolean(state.opts?.coordination) || (state.opts?.warmOnly === true && state.opts.warmCoordination === true);
  // Lot 3 (docs/runtime-contract.md §9 step 2): a routine or webhook run's
  // own conversation hands work out on the job runtime too, like a chat;
  // its run waits on that work (hasPendingDelegations) and the resume turn,
  // on the same thread, completes it. A room goal keeps its orchestrator.
  const routineRun = state.opts?.automationSource ? activeRoutineRunForThread(state.threadId) : null;
  const routineRunThread = Boolean(routineRun && routineRun.target !== "room-goal");
  state.boundedCoordination = (!state.opts?.automationSource || routineRunThread) && (!state.opts?.commsDepth || state.coordinated);
  if (state.bot.approvalGrant) {
    throw Object.assign(new Error("this bot's approval level is still being confirmed — try again"), { status: 409, code: "settling" });
  }
  // A turn answering a Team incidents report needs no computer: one it
  // cannot have right now — mid-change here, unpaid or missing at dispatch —
  // leaves it without one (computerSkipped, and the prompt says why) where
  // any other turn is refused. Deciding what a report needs never waits on
  // a screen; a report refused for it was a report lost.
  state.answer = turnAnswers(state.threadId, state.opts);
  state.computerSkipped = undefined;
  const transitionError = providerTransitionForTurn(state.bot, state.opts?.runOn, state.threadId);
  if (transitionError && !state.answer.incident) throw Object.assign(new Error(transitionError), { status: 409 });
  if (transitionError) state.computerSkipped = transitionError;
  // Only a turn on an engine being replaced waits; the others run on.
  if (providerInstancesChanging.has(state.bot.modelSelection.instanceId)) {
    throw Object.assign(new Error("this provider account is being updated — try again shortly"), { status: 409, code: "settling" });
  }
  // A workspace at its monthly spend limit starts no turn of any kind: a
  // person's message, a routine, a peer hop or a webhook all stop here.
  assertWithinBudget(cfg, DATA_DIR);
  if (boatLifecycleBusyBots.has(state.botId)) {
    const changing = "this bot's cloud computer is being changed — wait for it to finish";
    if (!state.answer.incident) throw Object.assign(new Error(changing), { status: 409, code: "settling" });
    state.computerSkipped ??= changing;
  }
  state.warmOnly = state.opts?.warmOnly === true;
  if (!state.warmOnly) turnTrace(state.threadId, state.opts?.automationSource ? `start:${state.opts.automationSource}` : state.opts?.cardContinuation ? "start:continuation" : "start", !state.opts?.automationSource);
  // The engine for a live call is already starting. This turn waits for it
  // and reuses the process. The warm itself must not wait.
  if (!state.warmOnly && voiceCalls.active(state.threadId)) await voiceWarmup.join(state.threadId);
  // A pre-warm (opened conversation, composer, routine) still starting: this
  // turn waits for it and takes its process over.
  if (!state.warmOnly && threadPrewarm.has(state.threadId)) await joinPrewarm(state.threadId);
  if (!state.warmOnly) turnTrace(state.threadId, "prewarm-joined");
  assertTurnAdmission(state.botId, state.threadId);
  // Steering is never a cancel. A message sent while teammates are working
  // runs now, with their assignments still attached: they keep running and
  // their results still return here (outstandingAssignmentsPrompt tells this
  // turn which are still out). Stop, in this conversation, is the gesture
  // that ends coordination — see interruptDirectThread.
  // Revoke anything a previous turn left behind before minting this turn's
  // integrations. Completion and interrupt paths do the same; a proxy the
  // warm engine kept is honoured again only through this turn's records.
  revokeEarlierTurnCapabilities(state.threadId);
  // a webhook turn, or one inherited from a bot already running unattended
  if (state.opts?.automationSource === "webhook" || state.opts?.unattended) markUnattended(state.bot.id, state.threadId);
  // a person typing into this bot ends the unattended window immediately
  else if (state.opts?.automationSource === undefined && !state.opts?.commsDepth && !state.opts?.cardContinuation && !state.warmOnly) {
    clearUnattended(state.threadId);
    delegationWakeBudget.reset(state.threadId);
  }
  state.task = store.taskByThread(state.bot.id, state.threadId);
  if (!state.task) throw Object.assign(new Error("no such task"), { status: 404 });
  if (hostedModels && !hostedModels.allows(state.bot.modelSelection)) throw Object.assign(new Error(hostedModels.error()), { status: 409 });
  // A fresh request decides where to work again: a select_computer move
  // held only the request it was made in.
  if (!state.opts?.computerSelectionContinuation && !state.opts?.compactOnly && !state.warmOnly && (!state.opts?.cardContinuation || Boolean(state.opts?.coordination && !state.opts.coordination.resumed))) {
    computerSelectionMoves.delete(state.threadId);
  }
  state.plan = turnSurfacePlan(state.bot, state.opts?.runOn, state.threadId);
  if (!namesEngine(state.bot.modelSelection)) {
    // No engine at all: the default one, or a plain sentence, never `provider instance ""`.
    const healed = healBotEngine(state.bot);
    if (!namesEngine(healed.modelSelection)) throw noEngineError();
    state.bot = healed;
  }
  // #2106: several subscription accounts of one provider offering the same
  // model collapse in the picker; at turn time pick the account that can
  // run it (credits from engine-refusals / managed MCP plugins when known).
  {
    const selection = state.bot.modelSelection;
    const home = registry.get(selection.instanceId);
    if (home && registry.access(selection.instanceId) !== "api") {
      const now = Date.now();
      const creditOf = (instanceId: string): AccountCreditState => {
        const refusal = activeEngineRefusal(instanceId, undefined, now);
        if (!refusal) return "unknown";
        if (refusal.cause === "credits") return "out";
        if (refusal.cause === "usage_limit") return "rate_limited";
        return "unknown";
      };
      const accounts = registry.instances()
        .filter((inst) => inst.driverKind === home.driverKind && registry.access(inst.instanceId) !== "api")
        .map((inst) => ({
          instanceId: inst.instanceId,
          models: (inst.models?.options ?? []).map((option: { id: string }) => option.id),
          credit: creditOf(inst.instanceId),
          // the managed MCP plugins this account holds (claude.ai connectors)
          managedPlugins: ((host.accountManagedPlugins?.(inst.instanceId) ?? []) as string[]).map(pluginKey),
        }));
      // the plugins the person's words name, among those the accounts hold
      const neededPlugins = pluginsNamedIn(state.text ?? "", accounts.flatMap((account) => account.managedPlugins));
      const remapped = resolveModelAccount({ selection, accounts, neededPlugins });
      if (remapped.instanceId !== selection.instanceId) {
        state.bot = { ...state.bot, modelSelection: remapped };
      }
    }
  }
  state.instance = registry.get(state.bot.modelSelection.instanceId);
  if (!state.instance) {
    // Still on the removed Computer engine: its move failed or found no
    // engine. Try it again now, so the next message runs on the new engine.
    if (removedComputerInstanceIds(cfg.instances).has(state.bot.modelSelection.instanceId)) void retryComputerEngineMove();
    throw Object.assign(
      new Error(`${engineReference(state.bot.modelSelection.instanceId)} is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }
  const policyRefusal = policyModelRefusal(state.instance);
  if (policyRefusal) throw Object.assign(new Error(policyRefusal), { status: 409, code: "managed_policy" });
  // #1098: outside the organization's list, the turn runs only on its
  // payer's own subscription or key
  const orgRefusal = orgEngineTurnRefusal(state.bot, state.instance, resolveTurnSpeaker({
    speaker: state.opts?.speaker,
    sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
    peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk),
    trigger: state.opts?.trigger,
    automationSource: state.opts?.automationSource
  }));
  if (orgRefusal) throw Object.assign(new Error(orgRefusal), { status: 409, code: "engine_not_allowed" });
  // 2026-10-30 (lot 2): a model turned off never runs a turn by name
  const modelRefusal = state.bot.modelSelection.auto === true ? undefined : modelSwitchRefusal(state.instance.instanceId, state.bot.modelSelection.model, effectiveBotOwner(state.bot));
  if (modelRefusal) throw Object.assign(new Error(modelRefusal), { status: 409, code: "model_turned_off" });
  state.toolScope = toolScopeForTurn(state.bot.id);
  // On a Cloud home a guest's turn never gets a shell or reads outside its
  // own folder (docs/cloud-pro.md): an engine that cannot run it that way is
  // refused, in one plain line, before anything is recorded.
  // (The thread is idle here: a mark a turn that never started left is stale.)
  guestDrivenTurns.delete(state.threadId);
  // A mail-woken routine run (bot email, S2) is confined the same way: no
  // shell, no reads outside its folder.
  const mailConfined = botmailConfined(state.threadId);
  state.guestConfined = cloudGuestDriven(state.threadId) || cloudGuestDrivenHandoff(state.opts?.coordination?.id) || mailConfined;
  if (state.guestConfined && state.instance.adapter.capabilities.guestTurns !== "confined") {
    if (mailConfined && !cloudGuestDriven(state.threadId)) throw Object.assign(new Error(BOTMAIL_ENGINE_REFUSAL), { status: 409, code: "botmail_engine" });
    throw Object.assign(new Error(guestEngineRefusal(state.threadId)), { status: 409, code: "guest_engine" });
  }
  return admit(state);
  };
}
