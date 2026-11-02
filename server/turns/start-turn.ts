// #1388 wave 4 step 3: startTurn runtime (leaf phase modules re-exported).
// Never imports server/index.ts.
import { createHash, randomUUID } from "node:crypto";
import type { LocalVmTarget, Runtime } from "../container-computer.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import { createTurnState } from "./start-turn-state.ts";
import { createFinishStartTurn } from "./start-turn-finish.ts";

export type { StartTurnHost };

export function createStartTurn(host: StartTurnHost) {
  const {
    AUTO_COMPUTER_RULES,
    BOTMAIL_ENGINE_REFUSAL,
    BUILT_IN_BROWSER_SYSTEM_PROMPT,
    BUILT_IN_DATA_SYSTEM_PROMPT,
    CALL_RECALL_BUDGET,
    CLAUDE_REUSE_VOLATILE_SECTIONS,
    COMPACT_VOLATILE_SECTIONS,
    CREDENTIAL_PROMPT,
    ComputerWaitParked,
    DATA_DIR,
    DEFAULT_REBUILD_BYTES,
    DESKTOP_BRIDGE_MCP_NAME,
    DirectTurnSetupCancelled,
    EngineAccessLost: _EngineAccessLost,
    HOSTED_WORKSPACE,
    HOST_COMPUTER_RESOURCE,
    IDENTITY,
    LEARN_PROMPT,
    LOCAL_RECALL_BUDGET,
    LOCAL_RECENT_WORK_LINES,
    PlaceUnavailableError,
    REACTION_PROMPT,
    ROUTINE_EXECUTION_PROMPT,
    ROUTINE_PROMPT,
    SESSION_SEARCH_SYSTEM_PROMPT,
    SMALL_TALK_TURN_NOTE,
    TEAM_MEMORY_PROMPT,
    THREADS_PROMPT,
    TurnAuthenticationRefusedError: _TurnAuthenticationRefusedError,
    TurnNotStartedError: _TurnNotStartedError,
    VOICE_FIRST_SENTENCE_SYSTEM,
    WEBHOOK_PROMPT,
    WIDGET_APPROVAL_PROMPT,
    WIDGET_PROMPT,
    WITHHELD_HOST_TOOLS_PROMPT,
    accessCardFor,
    accountConnectorInput,
    activeInternalGenerationByThread,
    activeRoutineRunForThread,
    activeVpsThreads: _activeVpsThreads,
    agentBrowserFrame,
    agentsIntegration,
    aiClientThreadPerson,
    applyViewerModelOverride,
    approvalLevelPrompt,
    approvalModeForTurn,
    asPlaceFailure,
    assertModelVariantSupported,
    assertTurnAdmission,
    assertWithinBudget,
    attachCustomMcp,
    attachTeamBoat,
    auditFullAccessTurn,
    autoComputerStateFor,
    autoLocalVmAttachable,
    autoModelRecord,
    autoPayerKey,
    autoPickForTurn,
    autoRecallEnabled,
    autoRecallPrompt,
    autoStartTarget,
    autoTurnsByThread,
    autoVmClaims,
    autoWorkspaceWanted,
    availableSkills,
    beginInternalCapabilityGeneration,
    beginMemoryTurn,
    bindInternalCapabilityToProviderTurn,
    bindTurnComputer,
    boat,
    boatLifecycleBusyBots,
    boatNotConfigured,
    botCreationOffered,
    botProfilePrompt,
    botRecoveryBackups,
    botUserName,
    botUserProfile,
    botmailConfined,
    browserIntegration,
    browserIsThePlace,
    browserRuntime,
    buildRecoveryText,
    buildSystemPrompt,
    buildTurnContext,
    builtInBrowserEnabled,
    bus: _bus,
    callLinesBlock,
    callLinesSince,
    callTurnEffort,
    canWorkOnCloud,
    cfg,
    checkSoulDrift,
    checkedTaskModelSwitch: _checkedTaskModelSwitch,
    checkpoints,
    chiefOfStaffSystemPrompt,
    claimTurnResource,
    claudeAiConnectorsFor,
    claudeUserMcpEnabled,
    clearCancelledProviderHandshake,
    clearDirectTurnDispatch,
    clearFailedAutoPin,
    clearInternalTurn,
    clearTurnDigestState: _clearTurnDigestState,
    clearUnattended,
    cloudEngine,
    cloudGuestDriven,
    cloudGuestDrivenHandoff,
    cloudGuestOpened,
    cloudOnlyBot,
    cloudPlaceRefusal,
    cloudRoutineReadiness,
    compactConversation,
    compactPromptFor,
    compactVolatileOrder,
    computerPlaceRefusal,
    computerPrompt,
    computerSelectionMoves,
    computerSelectionTurns,
    computerSkippedNote,
    computerToolsRefusal,
    confidentialThreadOwner,
    confinedWhy,
    connectorSwitchForTurn,
    connectorSwitchText,
    containerComputerFrame,
    containerComputerMcp,
    containerComputerStatus,
    controlIntegration,
    coordinationSystemInstructions,
    coordinator,
    customMcpPrompt,
    dataIntegration,
    decideWorkplace,
    delegationWakeBudget,
    deliverableNotification,
    desktopBridges,
    desktopLocalModels,
    desktopModelPersonFor,
    devPodsPrompt,
    devPodsThreads,
    directContext,
    directCoordinationSettlers,
    directFollowupSettlers,
    directFollowupTurns,
    directMachinePlan,
    directRequestOwners,
    directTurnBots,
    directTurnClaimExists,
    directTurnClaimIsCurrent,
    directTurnDispatchClaims,
    directTurnGenerationByThread,
    docsIndexPrompt,
    drainComputerResumes,
    drainDelegationWakes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    effectiveBotOwner,
    effortAcceptedByEngine,
    effortForModel,
    endMemoryTurn: _endMemoryTurn,
    engineAccessNotice,
    engineConnectorsPromptFor,
    engineDisplayName,
    engineHasNativeWebSearch,
    engineIsFresh,
    engineReference,
    engineStartGate,
    engineTurnLevel,
    enginesRead: _enginesRead,
    ensureTaskWorkspace,
    ensureWorkspace,
    expandLearnTurnText,
    expandSetupTurnText,
    expandSkillCommandTurnText,
    explainPick,
    extractTurnImages,
    failedTurnTool,
    finishUntilPrompt,
    fitTurnImagesForModel,
    forgetTurnCheckpoint,
    gatedLocalComputer,
    generateThreadTitle,
    githubWithheldPrompt,
    grokCloudConnectorsForTurn,
    guardTurnDispatch,
    guestDrivenTurns,
    guestEngineRefusal,
    handedStateUsable,
    handoffs,
    harnessCommandSource,
    harnessCommands,
    hasQueuedSteeredMessages: _hasQueuedSteeredMessages,
    healBotEngine,
    healOrgRefusedThreadModel,
    healThreadModel,
    holdBootEngineSlot,
    holdBotMemoryPlain,
    holdDirectMachineTurn,
    holdTurnAttachments,
    honouredPin,
    hooksEnabled,
    hooksIntegration,
    hostScreenTurns,
    hostedModels,
    idleEngines,
    inheritedTeamComputer,
    installedPlaybookInstructions,
    interruptDirectThread,
    isExternalContextMarker,
    isLocalModelId,
    isModelRefusal: _isModelRefusal,
    isSmallTalk,
    joinPrewarm,
    languageOfPerson,
    latestCompaction,
    lightenColdPrompt,
    limitBackupRefusedInThread,
    limitFailover,
    liveVoiceUtteranceByThread,
    llmThreadTitlesEnabled,
    localPrincipalId,
    localVmActiveThreads,
    localVmIdleFor,
    localVmImageBusy,
    localVmLeaseFor,
    localVmLifecycleBusy,
    localVmMode,
    localVmModeChangeBusy,
    localVmOwnerBusy,
    localVmPoolSeatHolder,
    localVmSeatPool,
    localVmSeen,
    localVmTargetForBot: _localVmTargetForBot,
    localVmTargetForThread,
    localVmThreadTargets,
    longCommandsPrompt,
    managedPolicy,
    markDirectTurnDispatching,
    markInternalTurn,
    markUnattended,
    markWorkspaceUse,
    mcpCallTimeoutMinutes,
    mcpServersAsPerson,
    measureContextBuckets,
    memoryPromptFor,
    mentionPrompt,
    mentionedBots,
    messagesIntegration,
    messagesWanted,
    modelFallbackByPayer,
    modelFallbackByThread,
    modelFallbackPayerKey,
    modelPrompt,
    modelSwitchRefusal,
    mountBotBoat,
    mountBotVps,
    mountHostComputer,
    mountPersonalMcp,
    mountPluginMcp,
    mountUserSandbox,
    myChromePromptFor,
    namedTeammates,
    namesEngine,
    nextInChain: _nextInChain,
    noEngineError,
    noteAutoWorkspace,
    noteBotRead,
    noteCallBesideConversation,
    noteTurnQueued,
    notify,
    notifyAccess,
    officeTurnText,
    orgEngineRefusal,
    orgEngineTurnRefusal,
    orgSpeakerPrincipal,
    orgTurnAccess,
    outstandingAssignmentsPrompt,
    ownerBotsReadOnly,
    ownerModelOfflineRefusal,
    ownerPaysForMember,
    parseLocalPromptMode,
    peerContactPrompt,
    peerHopTurn,
    peerName,
    peerOwnerPrincipal,
    peerReviewRequired,
    peerRosterSystemPrompt,
    peerThreadFor,
    pendingCancelledProviderHandshakes,
    personAskAt,
    personalFeatureOn,
    personalSkillInputs,
    personalSkills,
    perspicaxTurnIntegration,
    phoneIntegration,
    phoneToolTaintedThreads,
    pickFastSentenceModel,
    pluginDirsFor,
    policyModelRefusal,
    poolLocalVmTarget,
    prepareSemanticRecall,
    prewarmNamedTeammates,
    proactiveModeFor,
    proactivePrompt,
    promptSectionPaths,
    promptWithDataContext,
    promptWithReply,
    providerInstancesChanging,
    providerTransitionForTurn,
    quietTurnThreads,
    reachable: _reachable,
    reachablePeers,
    readCuaConnection,
    readyLocalVmForTurn,
    recallQuery,
    recentWorkFor,
    recentWorkPrompt,
    recordedBotOwner,
    redactSecretsInText,
    refreshMcpOAuth,
    refreshStreamDigests,
    registerComputerResume,
    registeredWorkers,
    registry,
    releaseBootEngineSlot: _releaseBootEngineSlot,
    releaseLocalVmThread,
    releasePlain: _releasePlain,
    releaseTurnComputer,
    releaseTurnResources,
    rememberAutoRefusal: _rememberAutoRefusal,
    remoteComputerForTurn,
    removedComputerInstanceIds,
    renderSkillInstructions,
    renderUnseen,
    repeatsShownFailure,
    replaysNatively,
    reportIncident,
    requestWorkOrigin,
    resolveComputerPromptKind,
    resolveEngineTurnEffort,
    resolveTurnSpeaker,
    retireProviderTurn,
    retryComputerEngineMove,
    retryDelegationsWaitingOn,
    revokeEarlierTurnCapabilities,
    revokeInternalCapabilityGeneration,
    richOutputPrompt,
    roomHandoffProblem,
    routineLineage,
    routineRunSpeaker,
    routines,
    rulesSystemPrompt,
    runAsBotEngine,
    runLifecycleEvent,
    runningTurnEngines,
    sameOwnerRosterMember,
    sandboxPrincipalForTurn,
    savedSteps,
    scopedSkillsPrompt,
    screenPollers,
    sectionContextSystemPrompt,
    selectBundledSkills,
    selectReplay,
    semanticEmbeddingEndpoint,
    sessionStart,
    sessions: _sessions,
    settleDirectCoordination,
    settleDirectFollowup,
    settleInputRequests,
    settleTrackedRequest,
    settlingResourceOwners,
    setupModeActive,
    setupSystemPrompt,
    sharedBotForViewer,
    shouldMountLocalComputer,
    skillAuthoringEnabled,
    skillCommandInline,
    skillDiscoveryAvailable,
    skillsLibraryEnabled,
    smallTalkTurns,
    soloGoalSystemPrompt,
    soloGoals,
    speakerPayerMode,
    speakerTurnSelection,
    spokenLineFields,
    startScreenPoller,
    stopScreenPoller,
    store,
    streamDigestPrompt,
    streamTurn,
    subscriptionExpiredCard: _subscriptionExpiredCard,
    supportsWorkspaceFiles,
    surfaceOfComputerKind,
    surfacePrompt,
    teamAvailabilityPart,
    teamComputerPrompt,
    teamMemory,
    threadBusy,
    threadPrewarm,
    toolDefinitionBytes,
    toolErrorCorrectiveRoundsFor,
    toolScopeForTurn,
    turnAccessByThread: _turnAccessByThread,
    turnAnswers,
    turnCheckpoints,
    turnClockEnabled,
    turnCommandEnvironment,
    turnComputerResources,
    turnConnectorsFor,
    turnContext,
    turnContextBuckets,
    turnHolder,
    turnModelRequested,
    turnModelSwitches,
    turnNetworkProxy,
    turnOrigin: _turnOrigin,
    turnPayer,
    turnPromptBytes,
    turnReachPrompt,
    turnResourceOwners,
    turnResources,
    turnRoutineLineage,
    turnRoutinePayers,
    turnRoutineTriggers,
    turnRunByThread,
    turnRunFor,
    turnSpeakerPrincipals,
    turnSpeakers,
    turnStartLogLine,
    turnSurfacePlan,
    turnTrace,
    turnTriggers,
    turnUsage,
    turnWorksOn,
    turnZoneFor,
    typedCommandForTurn,
    uniquePeerName,
    unseenMessages,
    userProfileSystemPrompt,
    userSandbox,
    usesCompactPrompt,
    usesStablePrompt,
    vaultPrincipalForThread,
    viewerBotOverrideStore,
    voiceBriefText,
    voiceCallSection,
    voiceCallTurnPrompt,
    voiceCalls,
    voiceLatency,
    voicePickForTurn,
    voiceSessions,
    voiceTranscript,
    voiceUnseenBlock,
    voiceWarmup,
    vps,
    vpsThreadEnded,
    vpsThreadStarted,
    wants: _wants,
    warmPayerAccountModels,
    watchdog,
    webhooks: _webhooks,
    withDesktopModelPerson,
    withRecalled,
    withTurnClock,
    withUnseenMessages,
    withWorkplaceNote,
    withholdHostToolsFor,
    workplacePreference,
    workplaceTurnText,
    workspaceCwdPrompt,
    workspaceLocationsPrompt,
    workspaceMaintenance
  } = host;
  void _activeVpsThreads; void _enginesRead; void _EngineAccessLost; void _TurnAuthenticationRefusedError; void _TurnNotStartedError; void _checkedTaskModelSwitch; void _clearTurnDigestState; void _endMemoryTurn; void _hasQueuedSteeredMessages; void _isModelRefusal; void _nextInChain; void _releasePlain; void _rememberAutoRefusal; void _subscriptionExpiredCard; void _turnAccessByThread;
  const { finishCatch, finishFinally } = createFinishStartTurn(host); void _bus; void _localVmTargetForBot; void _reachable; void _sessions; void _turnOrigin; void _wants; void _webhooks; void _releaseBootEngineSlot;

  const startTurn = async function startTurn(
    botId: string,
    text: string,
    opts?: any,
  ) {
    const state = createTurnState({ botId, text, opts, startTurn });
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
  // A usage limit (server/limit-failover-host.ts): back on the thread's own
  // engine once it reset, or onto a backup while it is known to refuse.
  // Never for a warm-up or a card's continuation of a running turn.
  if (!state.opts?.warmOnly && !state.opts?.cardContinuation) {
    const switching = limitFailover.beforeTurn(state.botId, state.threadId, resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk),
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    }));
    if (switching) await switching;
  }
  state.bot = store.projectBotForTask(state.botId, state.threadId);
  if (!state.bot) throw Object.assign(new Error("no such task"), { status: 404 });
  // A bot pinned to a computer never starts on this server, including a 1:1.
  // The desktop pulls the turn and runs it with the engines on that machine.
  if (!state.opts?.warmOnly && directMachinePlan({ host: state.bot.host, workers: registeredWorkers }).kind === "hold") {
    return holdDirectMachineTurn(state.bot, state.threadId, state.text, state.opts);
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
  let autoContinuing = false;
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
    autoContinuing = !freshAutoHop && Boolean(state.opts?.cardContinuation || state.opts?.computerSelectionContinuation || state.opts?.compactOnly || state.opts?.warmOnly);
    const worker = Boolean(autoPeerAsk) || (state.opts?.commsDepth ?? 0) > 0 || state.opts?.automationSource !== undefined || state.opts?.autoWorker === true;
    state.autoTurn = autoPickForTurn({
      bot: state.bot, threadId: state.threadId, speaker: autoSpeaker, text: state.text,
      role: autoContinuing && !state.opts?.autoSkip?.length ? "continue" : worker ? "worker" : "orchestration",
      fallback: worker ? "worker" : "orchestration",
      // A guest's turn on a Cloud home only goes to an engine that confines it.
      guestConfined: cloudGuestDriven(state.threadId) || cloudGuestDrivenHandoff(state.opts?.coordination?.id) || botmailConfined(state.threadId),
      ...(state.opts?.autoSkip ? { skip: state.opts.autoSkip } : {})
    });
    // Recorded on the task once the turn is admitted (below), never before.
    if (state.autoTurn) state.bot = { ...state.bot, modelSelection: state.autoTurn.pick.selection };
  }
  // A request that needs a mail, calendar, Teams or SharePoint connector the
  // bot's engine lacks runs on the engine of this person that has it, for
  // this request only (server/connector-switch.ts). A card's continuation
  // stays where the request went. Never for Auto (its own pick), a warm-up,
  // work handed out or a routine.
  // Only the person's own new message, never a card's continuation, a
  // compaction or a computer choice (those stay on the bot's engine), and
  // only its raw text (review of #943): a fresh or edited send's `text` is
  // what they typed; a drained queue line passes the composed prompt (page,
  // mail or data context, a quoted reply) as `text`, so only its stored
  // message is read.
  state.connectorSwitch = undefined;
  const personText = state.opts?.userMessage
    ? (state.opts.userMessage.role === "user" && state.opts.userMessage.kind === "text" ? state.opts.userMessage.text ?? "" : "")
    : state.text;
  if (!state.autoTurn && !state.opts?.warmOnly && !state.opts?.cardContinuation && !state.opts?.computerSelectionContinuation && !state.opts?.compactOnly && personText) {
    const switchSpeaker = resolveTurnSpeaker({
      speaker: state.opts?.speaker,
      sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.sender),
      peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.opts?.userMessage?.peerAsk),
      trigger: state.opts?.trigger,
      automationSource: state.opts?.automationSource
    });
    const personsRequest = (switchSpeaker.origin === "person" || switchSpeaker.origin === "operator")
      && !state.opts?.automationSource && !state.opts?.peerAsk && !state.opts?.userMessage?.peerAsk && !(state.opts?.commsDepth ?? 0) && !state.opts?.coordination;
    state.connectorSwitch = personsRequest ? connectorSwitchForTurn(state.bot, state.threadId, switchSpeaker, personText) : null;
    if (state.connectorSwitch) {
      state.bot = { ...state.bot, modelSelection: { instanceId: state.connectorSwitch.instanceId, model: state.connectorSwitch.model, ...(state.connectorSwitch.effort ? { effort: state.connectorSwitch.effort } : {}), ...(state.connectorSwitch.account ? { account: state.connectorSwitch.account } : {}) } };
    }
  }
  // A turn said on a live call, and the warm that prepares its process, run
  // on a fast model (server/voice-turn.ts): the person waits in silence for
  // the first word. Pinned or Auto alike; a request that needed another
  // engine's connector keeps it. Heavy work is handed to a parallel task on
  // the bot's main model by the call turn itself.
  state.voiceTurnPick= null;
  /** The turn runs in the call's own session, from a short view of the
   * conversation (server/voice-turn.ts), not in the conversation's session. */
  state.voiceCallTurn = false;
  if (!state.connectorSwitch && voiceCalls.active(state.threadId) && !state.opts?.commsDepth && !state.opts?.coordination && !state.opts?.automationSource
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
  if (!state.voiceTurnPick && !state.autoTurn && !state.connectorSwitch && !state.opts?.warmOnly && proactiveWake) {
    const wakePick = voicePickForTurn(state.bot, state.autoBaseSelection, resolveTurnSpeaker({ speaker: state.opts?.speaker, automationSource: state.opts?.automationSource }), botmailConfined(state.threadId));
    if (wakePick) state.bot = { ...state.bot, modelSelection: wakePick.selection };
  }
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
  // Codex and the API drivers cannot start without a prompt. Sending them
  // an empty one would bill a turn and show it. Claude is the engine that
  // can hold a process with stdin open and no model call.
  if (state.warmOnly && state.instance.adapter.capabilities.warmSession !== true) {
    console.error(`[voice-call] warm skipped: ${state.instance.driverKind}`);
    state.opts?.onWarmSettled?.(false);
    return {
      id: `warm-${randomUUID()}`,
      at: Date.now(),
      role: "user" as const,
      kind: "text" as const,
      text: "",
      ...(state.opts?.voiceCall ? { voiceCall: state.opts.voiceCall } : {})
    };
  }
  // Resolve only transport tags from this newly submitted text. The original
  // string remains the durable message. Native-image providers get a
  // path-free prompt and bounded inputs instead of needing a Read tool;
  // path-reading drivers retain the attachment tag as their compatibility route.
  state.resolvedImages = extractTurnImages(state.text);
  // Files sealed at rest go plain in place for the engine (server/content-at-rest.ts):
  // this message's attachments before anything reads them; the bot's memory
  // files in parallel with the rest of the setup, awaited before the engine
  // starts (below).
  if (!state.warmOnly && supportsWorkspaceFiles(state.instance.driverKind)) void holdBotMemoryPlain(state.bot.id, turnHolder(state.threadId));
  const attachmentsHold = state.warmOnly ? undefined : holdTurnAttachments(state.threadId, [state.text], state.resolvedImages.images, { picturesByPath: state.instance.driverKind === "codex" });
  if (attachmentsHold) {
    await attachmentsHold;
    // The wait yielded: another start may have taken this slot since the
    // checks above. From here to the dispatch claim nothing yields again.
    assertTurnAdmission(state.botId, state.threadId);
  }
  const usesNativeImageInput = state.instance.adapter.capabilities.nativeImageInput === true;
  state.providerText = promptWithDataContext(usesNativeImageInput ? state.resolvedImages.text : state.text, state.opts?.dataContext);
  state.turnImages = usesNativeImageInput ? state.resolvedImages.images : [];
  state.commsDepth = state.opts?.commsDepth ?? 0;
  // Classify the turn where the peer paths' depth actually arrives: by the
  // time it settles, the fold has only a thread id to go on.
  if (state.commsDepth > 0) markInternalTurn(state.threadId);
  else clearInternalTurn(state.threadId);
  if (state.answer.quiet) quietTurnThreads.add(state.threadId);
  else quietTurnThreads.delete(state.threadId);
  // a task takes its name from the first thing you asked it to do
  if (!state.warmOnly && state.resolvedImages.text.trim() && !state.opts?.cardContinuation) {
    const titled = store.titleTaskFromFirstMessage(state.bot.id, state.resolvedImages.text, state.threadId);
    // The snippet is only the fallback name. A cheap one-shot may trade it
    // for a title a person would have typed, but never on a peer-opened
    // row: its title belongs to the assigned work. Everywhere else, the
    // swap happens only while the row still carries the snippet — a rename
    // by a person has already broken that equality by then.
    const snippet = titled?.title;
    if (titled && snippet && !titled.openedBy?.botId && personalFeatureOn("llmThreadTitles", llmThreadTitlesEnabled(cfg), vaultPrincipalForThread(state.threadId)) && state.instance.generateText) {
      void generateThreadTitle(state.instance, state.resolvedImages.text)
        .then((title: any) => {
          if (title) store.retitleTask(state.bot.id, state.threadId, snippet, title);
        })
        .catch(() => undefined);
    }
  }

  // Spoken words never reach the log. A direct send says so itself; a
  // drained queue (or a continuation) carries it on the user lines it runs.
  const turnLineIds = new Set(state.opts?.excludeMessageIds ?? []);
  state.spoken = state.opts?.via === "call" || state.opts?.userMessage?.via === "call" ||
    (turnLineIds.size > 0 && store.messagesFor(state.threadId).some((message: any) => turnLineIds.has(message.id) && message.via === "call"));
  if (state.warmOnly) console.error(`[voice-call] warming thread ${state.threadId}`);
  else console.error(turnStartLogLine({
    botId: state.botId, text: state.resolvedImages.text, images: state.turnImages.length, depth: state.commsDepth, card: Boolean(state.opts?.cardContinuation), spoken: state.spoken,
    confidential: store.isConfidentialThread(state.threadId)
  }));
  state.instanceId = state.instance.instanceId;
  // A turn always runs on the bot's own engine, model, effort and variant,
  // wherever it works: a cloud computer is a tool it mounts, never a reason
  // to swap the engine (the provider_not_configured incident).
  state.model = state.bot.modelSelection.model;
  const askedEffort = state.bot.modelSelection.effort;
  state.variant = state.bot.modelSelection.variant;
  // What this turn runs on, kept for the bot text it writes (a quiet line
  // under the reply shows it). A warm-up writes no reply.
  if (!state.warmOnly) turnRunByThread.set(state.threadId, turnRunFor(state.bot.modelSelection, turnModelRequested.get(state.threadId)));
  assertModelVariantSupported({ variant: state.variant, effort: askedEffort }, state.instance.adapter.capabilities);
  // A selection can be persisted while its engine is offline. Re-check when
  // the engine returns so an old or unsupported value never reaches a CLI.
  if (askedEffort && !effortAcceptedByEngine(askedEffort, state.instance.adapter.capabilities.effortLevels ?? [])) {
    throw Object.assign(
      new Error(`effort "${askedEffort}" is not offered by this bot's engine — choose another level in settings`),
      { status: 409 },
    );
  }
  // The engine takes it but this model may not (shared/model-capabilities.ts):
  // then nothing is sent and the model runs at its own default.
  state.effort = effortForModel(askedEffort, state.instance.models.options.find((option: any) => option.id === state.bot.modelSelection.model),
    state.instance.adapter.capabilities.effortLevels);

  // an edit hands us its already-branched user message; a plain send appends
  state.userMessage= state.opts?.userMessage;
  if (state.opts?.editedMessageId) {
    const edited = store.branchMessage(state.threadId, state.opts.editedMessageId, state.text, state.opts.sendId, state.opts.sender, state.opts.dataContext);
    if (!edited) throw Object.assign(new Error("only a user text message can be edited"), { status: 400 });
    store.patchTask(state.bot.id, state.threadId, { rewound: true });
    state.userMessage = edited;
  }
  if (!state.userMessage) {
    state.userMessage = state.warmOnly
      ? { id: `warm-${randomUUID()}`, at: Date.now(), role: "user", kind: "text", text: "", ...(state.opts?.voiceCall ? { voiceCall: state.opts.voiceCall } : {}) }
      : state.opts?.cardContinuation
      ? { id: `card-${randomUUID()}`, at: Date.now(), role: "user", kind: "text", text: state.text }
      : store.appendMessage(state.threadId, {
          role: "user",
          kind: "text",
          text: state.text,
          replyToId: state.opts?.replyTo?.id,
          sendId: state.opts?.sendId,
          ...(state.opts?.dataContext ? { dataContext: state.opts.dataContext } : {}),
          peerAsk: state.opts?.peerAsk,
          sender: state.opts?.sender,
          ...(state.opts?.peerAsk && state.autoTurn?.pick.role === "worker" ? { autoModel: autoModelRecord(state.autoTurn.pick, Date.now()) } : {}),
          ...(state.opts?.voiceCall ? { voiceCall: state.opts.voiceCall } : {}),
          ...spokenLineFields(state.opts?.via, state.opts?.callId),
          ...(state.opts?.relayed ? { relayed: true } : {})
        });
  }
  // Runtime path only (coordinator.answer is always false on the legacy
  // tree): a person's ordinary message into a thread whose coordinated
  // assignment is parked on a question IS the answer. The assignment takes
  // the words and the runtime runs the teammate's next turn itself (run
  // hook, with the answer in its envelope), so no turn starts here. Only a
  // person's own line counts: not a continuation, a wake, a routine, a peer
  // hop or an edit. The early return happens before admission — no dispatch
  // claim, request owner, busy flag or watchdog exists yet — so it settles
  // only what callers read: the message route carries the stored user line
  // in its receipt, and a drained queue holds its receipt until
  // onTurnSettled; a turn that never started publishes no completion, so
  // the drain is nudged as its own error path does (M2 in drainQueuedSends).
  state.personLine = !state.opts?.coordination && !state.opts?.cardContinuation && !state.opts?.automationSource && !state.opts?.compactOnly
    && !state.opts?.computerSelectionContinuation && !state.opts?.editedMessageId && !state.warmOnly && !state.commsDepth && !state.opts?.peerAsk && !state.userMessage.peerAsk;
  if (state.personLine && coordinator.answer(state.threadId, state.text)) {
    store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: { name: "Answer passed to the waiting work", ok: true } });
    settleInputRequests(state.threadId);
    state.opts?.onTurnSettled?.();
    queueMicrotask(drainQueuedSends);
    return state.userMessage;
  }
  if (!state.warmOnly && state.opts?.voiceCall?.utteranceId) {
    liveVoiceUtteranceByThread.set(state.threadId, state.opts.voiceCall.utteranceId);
  }
  // Organization server (slice 3, D13): no turn without engine access. The
  // person's message stays; the thread gets the card saying why, the owner
  // a notification, and the sender an ordinary accepted send.
  state.speaker = resolveTurnSpeaker({
    speaker: state.opts?.speaker,
    sender: state.opts?.sender ?? (state.opts?.editedMessageId ? undefined : state.userMessage.sender),
    peerAsk: state.opts?.peerAsk ?? (state.opts?.editedMessageId ? undefined : state.userMessage.peerAsk),
    trigger: state.opts?.trigger,
    automationSource: state.opts?.automationSource
  });
  // an automatic recovery re-enters with these options: same speaker
  state.opts = { ...state.opts, speaker: state.speaker };
  // A voice call turn gets the hidden phone-call instruction; the first
  // written turn after a call is told the call ended. Only a person's own
  // turn: a continuation or a peer hop is not said on the phone.
  // The thread is on a live call (server/voice-call-session.ts): the engine
  // stays warm between turns and the turn's context stays short.
  state.onCall = Boolean(voiceCalls.active(state.threadId)) && !state.opts?.commsDepth && !state.userMessage.peerAsk;
  state.voiceCallText = state.opts?.cardContinuation || state.opts?.commsDepth || state.userMessage.peerAsk
    ? ""
    : voiceCallSection(
      state.userMessage,
      store.activePath(state.threadId).findLast((message: any) => message.role === "user" && message.id !== state.userMessage?.id && !message.peerAsk && message.at <= state.userMessage!.at),
      state.userMessage.sender?.name ?? botUserName(state.bot),
    );
  // Organization server: where this turn's tools run, and for whom, decided
  // once (server/desktop-bridge.ts); the speaker's own attachments are
  // pointed there and small text ones given inline.
  const turnRemote = remoteComputerForTurn({
    organization: IDENTITY.kind === "perspicax",
    runOnCloud: state.opts?.runOn === "cloud" || cloudOnlyBot(state.bot.id),
    hasTeamComputer: Boolean(inheritedTeamComputer(state.bot))
  });
  const turnWorks = turnWorksOn(state.plan, turnRemote.forceCloud);
  state.turnPrincipal = sandboxPrincipalForTurn({
    botOwnerPrincipalId: effectiveBotOwner(state.bot),
    confidentialOwnerPrincipalId: confidentialThreadOwner(state.threadId),
    routine: routineLineage(state.speaker),
    speakerPrincipalId: orgSpeakerPrincipal(state.bot, state.speaker)
  });
  const turnPersonAsked = !routineLineage(state.speaker) && Boolean(orgSpeakerPrincipal(state.bot, state.speaker));
  // Auto (2026-10-15; routines 2026-11-01): a person-asked turn prefers
  // the person's computer when connected, else the cloud. A routine starts
  // in the cloud; routinesAllowed only permits an explicit computer_select
  // to this_computer. A thread opened with a workspace starts there when
  // allowed (server/auto-computer.ts).
  const turnAutoWanted = turnWorks.auto ? autoWorkspaceWanted(state.bot, state.threadId) : null;
  const turnAutoStart = turnWorks.auto && IDENTITY.kind === "perspicax" && state.turnPrincipal ? autoStartTarget({
    wanted: turnAutoWanted,
    routine: routineLineage(state.speaker),
    personAsked: turnPersonAsked,
    desktopConnected: desktopBridges.connected(state.turnPrincipal.trim().toLowerCase()),
    routinesAllowed: workplacePreference(state.turnPrincipal.trim().toLowerCase()).routines,
    sandboxConfigured: Boolean(userSandbox),
    browserAvailable: state.plan.browser
  }) : null;
  state.turnPlace = decideWorkplace({
    desktopTargeted: state.plan.computer === "local" || state.plan.computer === "vm" || turnAutoStart?.target === "this_computer" || turnAutoStart?.target === "local_vm",
    routine: routineLineage(state.speaker),
    principal: state.turnPrincipal,
    personAsked: turnPersonAsked
  });
  state.turnAuto = autoComputerStateFor(state.turnPlace, turnWorks, routineLineage(state.speaker), turnAutoStart, state.plan.browser);
  // Each call turn's words carry the call mark themselves: a live session
  // gets the volatile call section only when it changed, so from the second
  // call turn on the section alone never reached the engine.
  if (state.userMessage.voiceCall && !state.opts.cardContinuation && !state.opts.commsDepth && !state.userMessage.peerAsk) {
    state.providerText = voiceCallTurnPrompt(state.providerText, state.userMessage.voiceCall);
  }
  // A greeting, thanks or small talk alone (server/small-talk.ts) asks for
  // no action: the engine is told so, and the cloud computer is not woken.
  const smallTalk = !state.warmOnly && !state.opts.cardContinuation && !state.opts.commsDepth && !state.opts.automationSource && !state.userMessage.peerAsk
    && !state.userMessage.voiceCall && !routineLineage(state.speaker) && isSmallTalk(state.userMessage.text, state.bot.name);
  if (smallTalk) state.providerText += SMALL_TALK_TURN_NOTE;
  if (!state.opts.cardContinuation && !state.warmOnly) {
    // Pictures ride as image input only on Claude Code, which reads them for
    // sure; another engine gets the saved picture files to read instead.
    const office = officeTurnText(state.providerText, state.turnPlace.principal, usesNativeImageInput && state.instance.driverKind === "claudeAgent", state.turnImages);
    state.providerText = office.text;
    state.turnImages.push(...office.images);
  }
  state.placedText = state.opts.cardContinuation ? { text: state.providerText, staging: null } : workplaceTurnText(state.providerText, state.turnPlace);
  state.providerText = withWorkplaceNote(state.placedText.text, state.turnPlace, state.turnAuto);
  // The engine's container runs in UTC: tell it the time where its person is
  // (server/turn-clock.ts), so times are said in their zone.
  const clockZone = state.opts.cardContinuation || !turnClockEnabled() ? null : turnZoneFor(state.bot, state.speaker);
  if (clockZone) state.providerText = withTurnClock(state.providerText, new Date(), clockZone);
  // A compaction summarizes with the bot's engine too, so it is gated like
  // a turn, and so is a fresh delegated turn (a hop, as ask_bot's is); other
  // card continuations resume a turn already admitted.
  const freshHop = Boolean(state.opts.coordination && !state.opts.coordination.resumed);
  const accessRefusal = state.opts.cardContinuation && !state.opts.compactOnly && !freshHop ? null
    : orgEngineRefusal(state.bot, state.instance, state.speaker, state.bot.modelSelection.model) ?? ownerModelOfflineRefusal(state.bot, state.instance, state.speaker, state.bot.modelSelection.model);
  if (accessRefusal) {
    if (state.warmOnly) {
      console.error(`[voice-call] warm skipped: ${accessRefusal.reason}`);
      state.opts?.onWarmSettled?.(false);
      return state.userMessage;
    }
    state.engine = engineDisplayName(state.instance);
    // A backup the usage-limit failover picked: one plain error, no card.
    state.backupRefused = limitBackupRefusedInThread(state.botId, state.threadId, state.speaker);
    state.card = accessCardFor(state.bot, accessRefusal, state.engine);
    if (!state.backupRefused && !repeatsShownFailure(store.messagesFor(state.threadId), { role: "bot", kind: "access", access: state.card }, state.bot.id)) {
      store.appendMessage(state.threadId, {
        role: "bot",
        kind: "access",
        access: state.card
      });
    }
    state.notice = state.backupRefused ?? engineAccessNotice(accessRefusal.reason, state.engine, accessRefusal);
    const refusedRun = routineLineage(state.speaker) ? activeRoutineRunForThread(state.threadId)?.id : undefined;
    notifyAccess(deliverableNotification("turn-failed", state.bot, state.threadId, state.notice, { avatarUrl: state.bot.avatarUrl }), state.card, refusedRun);
    console.error(`[omb-turn] bot=${state.botId} refused: ${accessRefusal.reason}${accessRefusal.cause ? `/${accessRefusal.cause}` : ""} (${state.instance.instanceId})`);
    state.opts?.coordination?.settle({ ok: false, text: state.notice });
    state.opts?.onDispatchError?.(state.notice);
    state.opts?.onTurnSettled?.();
    return state.userMessage;
  }
  // Auto: one discreet line when this turn starts on another place than the
  // thread last showed, or could not start where it was sent.
  if (state.turnAuto?.auto && turnAutoStart && !state.warmOnly && !state.opts.cardContinuation) noteAutoWorkspace(state.threadId, turnAutoStart, turnAutoWanted !== null);
  state.recoveryUserMessageId = state.opts?.coordination
    ? store.activePath(state.threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id
    : state.userMessage.id;
  // Auto: the pick is this thread's now that the turn is admitted, and
  // work handed out gets its activity row (which model, and why).
  if (state.autoTurn) {
    const earlierPick = store.taskByThread(state.bot.id, state.threadId)?.autoModel;
    store.patchTask(state.bot.id, state.threadId, { autoModel: autoModelRecord(state.autoTurn.pick, Date.now()) });
    autoTurnsByThread.set(state.threadId, { payer: state.autoTurn.payer, entry: { instanceId: state.autoTurn.pick.selection.instanceId, model: state.autoTurn.pick.selection.model } });
    // The person's own turn (2026-10-29): the words decide the model, so a
    // turn that runs on another model than the last one says so in one
    // line (the chip and the picker say it on the first turn).
    const ownTurnMoved = state.autoTurn.pick.role === "orchestration" && earlierPick !== undefined &&
      (earlierPick.instanceId !== state.autoTurn.pick.selection.instanceId || earlierPick.model !== state.autoTurn.pick.selection.model);
    if ((state.autoTurn.pick.role === "worker" || ownTurnMoved) && !state.warmOnly && !autoContinuing) {
      store.appendMessage(state.threadId, {
        role: "bot",
        kind: "activity",
        autoModel: autoModelRecord(state.autoTurn.pick, Date.now()),
        tool: { name: `notice: ${explainPick(state.autoTurn.pick)}`, ok: true }
      });
    }
  } else autoTurnsByThread.delete(state.threadId);
  if (state.connectorSwitch) {
    state.line = { engine: state.connectorSwitch.engineLabel, connector: state.connectorSwitch.connector };
    store.appendMessage(state.threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${connectorSwitchText(state.line)}`, ok: true, connectorSwitch: state.line } });
  }
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
      // Where the person is now (server/main-thread.ts). A line relayed
      // from Slack was written there, not in this conversation: the line
      // says so (Message.relayed), also in a turn a computer switch continues.
      if (!state.userMessage.relayed) store.setTaskAskedAt(state.bot.id, state.threadId, state.userMessage.at);
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
  if (smallTalk) {
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
  if (!state.warmOnly && state.opts?.coordination) directCoordinationSettlers.set(state.dispatchClaimId, state.opts.coordination.settle);
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

    void (async () => {
    state.warmOk = false;
    try {

      if (state.warmOnly && state.opts?.warmSignal?.aborted) {
        state.instance.adapter.releaseWarmSession?.(state.threadId);
        return;
      }
      if (state.enginesRead) {
        await state.enginesRead;
        if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) throw new DirectTurnSetupCancelled("turn stopped while the engines were read");
      }
      // A call warm must not compact or rewrite the resume cursor. The first
      // spoken turn decides that, and a reset discards this process.
      if (!state.warmOnly) {
      // Readiness can wait on the network. Admit the task first so its busy
      // state, Stop action and watchdog own that wait just like VM setup.
      if (state.opts?.runOn === "cloud") {
        const readiness = await cloudRoutineReadiness(state.botId, state.threadId);
        if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
          throw new DirectTurnSetupCancelled("turn stopped during cloud readiness");
        }
        if (!readiness.ready) throw new Error(readiness.reason ?? "The cloud computer is not ready");
      }
      // A call turn starts its own short session: the conversation's fold
      // waits for its next written turn, off the person's silence.
      if (!state.voiceCallTurn) await compactConversation({ bot: state.bot, threadId: state.threadId, generation: state.dispatchClaimId, instance: state.instance, model: state.model,
        excludedIds: new Set([state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])]), manual: state.opts?.compactOnly === true });
      turnTrace(state.threadId, "compacted");
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) throw new DirectTurnSetupCancelled("turn stopped during context setup");
      if (state.opts?.compactOnly) {
        clearDirectTurnDispatch(state.threadId, state.dispatchClaimId);
        revokeInternalCapabilityGeneration(state.threadId, state.dispatchClaimId);
        settleDirectFollowup(state.dispatchClaimId);
        releaseTurnResources(state.resourceOwner);
        store.setTaskActivity(state.bot.id, state.threadId, "idle");
        watchdog.settle(state.threadId);
        directTurnBots.delete(state.threadId);
        retryDelegationsWaitingOn(state.bot.id);
        drainQueuedSends();
        drainComputerResumes();
        drainSecretResumes();
        drainTeamSetupResumes();
        drainDelegationWakes();
        return;
      }
      }
      // Keep the full branch order for delivery bookkeeping, but select actual
      // replay entries by bytes. A compacted prefix is represented by its record.
      const skipTranscript = new Set<string>([state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])]);
      const activeMessages = store.activePath(state.threadId);
      const coordinationChildren = state.opts?.coordination?.resumed
        ? new Set(coordinator.children(state.opts.coordination.id).map((child: any) => child.id)) : undefined;
      for (const m of activeMessages) {
        if (!state.opts?.coordination || !m.roomRequest) continue;
        if ((m.roomRequest.phase === "request" && m.roomRequest.id === state.opts.coordination.id) ||
          (m.roomRequest.phase === "result" && coordinationChildren?.has(m.roomRequest.id))) skipTranscript.add(m.id);
      }
      const context = directContext(state.bot, state.threadId, activeMessages);
      state.contextOrder = context.map((m: any) => m.id);
      const replayable = context.filter((m: any) => !skipTranscript.has(m.id));
      state.record = latestCompaction(activeMessages, state.task);
      state.selection = selectReplay(context, { budgetBytes: cfg.context?.rebuildBytes ?? DEFAULT_REBUILD_BYTES, excludedIds: skipTranscript, compaction: state.record });
      state.transcript = state.selection.transcript.map(({ role, text }: any) => ({ role, text }));
      state.contextReset = state.selection.compacted > 0 && state.record?.id !== state.task.appliedCompactionId;
      // Whether this engine had a session here is decided on the cursors
      // from before the reset below: a fold is a continuation, not a new
      // engine joining (turn-context.ts COMPACTED_PREAMBLE).
      const cursorsBeforeReset = state.task.resumeCursors;
      // The record is durable even if a crash occurs before this bookkeeping.
      // A retry then sees the unapplied record again and rebuilds safely.
      if (state.contextReset && !state.warmOnly && !state.voiceCallTurn) store.patchTask(state.bot.id, state.threadId, { resumeCursors: {} });
      // A fold of a stale session reads as a pause, never "continue where you left off".
      const pausedFold = state.contextReset && Boolean(state.record && state.task.contextSummaries?.some((entry: any) => entry.id === state.record.id && entry.stale));

      // After a rewind (edit / branch switch) the provider's native session
      // still contains the abandoned branch: start a fresh session instead of
      // resuming, and for cursor-resuming drivers replay the surviving path
      // inline (transcript-replay drivers get it via transcript). The flag is
      // cleared only once the turn is actually dispatched — clearing it here
      // would cost the next attempt its history if this dispatch fails.
      state.rewound = Boolean(state.task.rewound);
      // A fresh engine — the user switched this bot's model mid-thread — has no
      // current session here either, so it gets the same replay. Distinct from
      // rewound: the OTHER instances' cursors are left alone (a rewind wipes
      // them all), and "fresh" is decided by who ran the last turn, not by
      // whether we hold a cursor — see engineIsFresh.
      state.externalContextMarker = isExternalContextMarker(state.task.lastInstanceId)
        ? state.task.lastInstanceId
        : undefined;
      const fresh =
        !state.rewound &&
        !state.externalContextMarker &&
        engineIsFresh({ instanceId: state.instanceId, lastInstanceId: state.task.lastInstanceId, resumeCursors: cursorsBeforeReset, transcript: replayable });
      // An engine that records what its session was handed resumes it with only
      // the context messages outside that record. A record of another session
      // (the one it replaced) or one that no longer lines up with the branch is
      // not trusted: the session is rebuilt by the same replay as any other.
      state.strictResume = state.instance.adapter.capabilities.strictResume === true;
      const cursor = state.task.resumeCursors[state.instanceId];
      const handed = state.strictResume && !state.rewound && !state.contextReset && !fresh && !state.externalContextMarker && cursor !== undefined
        ? state.task.handedMessages?.[state.instanceId] : undefined;
      const unseen = handed && handedStateUsable(handed, cursor, state.contextOrder) ? unseenMessages(replayable, state.contextOrder, handed) : undefined;
      // A teammate's result or reply: without records this turn would replay.
      const externalUpdate = Boolean(state.opts?.coordination?.resumed || unseen?.some((m: any) => m.keep));
      // What a resumed session keeps from its launch: the standing instructions
      // (tools, servers and — for Claude — the model are passed on every launch),
      // plus settings that a live turn cannot change. Codex now reasserts its
      // model/provider on resume, but an in-flight turn and an omitted effort
      // retain the prior selection, so both still belong to the session here. An
      // external update that finds any of it changed since the session started
      // gets the fresh session and replay it always got, rather than a resume.
      const persistentConfig = [state.bot.name, state.bot.title, state.bot.description, sectionContextSystemPrompt(state.bot.section),
        ...(state.instance.driverKind === "codex" ? [state.model, state.effort ?? null] : [])];
      const sessionConfig = (soul: string | undefined) =>
        createHash("sha256").update(JSON.stringify([...persistentConfig, soul])).digest("hex").slice(0, 16);
      state.plannedConfig = sessionConfig(state.bot.soul);
      // Agent-tool gate shared by skill authoring, the /setup turn-text rewrite,
      // the setup prompt block, and the peer-comms integration below: a driver
      // that never mounts agent tools (or a turn already at the comms-depth cap)
      // must not be steered into — or told about — tools it cannot call.
      const skillAuthoring = personalFeatureOn("skillAuthoring", skillAuthoringEnabled(cfg), vaultPrincipalForThread(state.threadId)) && state.peerToolsMounted;
      // Setup mode's turn-text rewrite (parseSetupCommand/expandSetupTurnText)
      // must not run ahead of a system prompt that can't explain it: a driver
      // without agent tools sees the user's literal "/setup ..." message. The
      // gate on whether the coaching block itself is active — setupModeActive,
      // which also depends on the bot's soul/description — is decided below,
      // from the same bot snapshot the prompt's soul is built from.
      // A `/name` turn for one of the bot's enabled skills reads as a plain
      // request to follow that SKILL.md (shared/skill-command.ts). An engine
      // with workspace files is pointed at the file. An API engine (or any
      // organization turn whose files are the person's environment) gets the
      // reviewed instructions inlined, while skills_list/workspace_read still
      // serve the managed index when those tools are allowed.
      const skillCommandText = expandSkillCommandTurnText(
        state.bot.id,
        state.providerText,
        skillsLibraryEnabled(cfg) ? (store.bot(state.bot.id)?.assignedSkills ?? state.bot.assignedSkills) : undefined,
        { inline: skillCommandInline({ workspaceFiles: supportsWorkspaceFiles(state.instance.driverKind), organization: IDENTITY.kind === "perspicax" }),
          overrides: (() => {
            state.person = IDENTITY.kind === "perspicax" ? orgSpeakerPrincipal(state.bot, state.speaker) : localPrincipalId();
            return skillsLibraryEnabled(cfg) && state.person ? personalSkills.commands(state.person, new Set(personalSkillInputs(state.bot, state.person).filter((skill: any) => skill.shadowed).map((skill: any) => skill.name))) : [];
          })()
        },
      );
      const setupText = state.peerToolsMounted ? expandSetupTurnText(skillCommandText) : skillCommandText;
      const userTurnText = promptWithReply(
        skillAuthoring ? expandLearnTurnText(setupText) : setupText,
        state.opts?.replyTo,
        botUserName(state.bot),
      );
      // Decided again at dispatch when setup outlasted a soul edit (config).
      const decideContext = (config: string) => {
        // A Codex thread keeps the last effort it was sent and no turn can clear
        // one: back on the default, a thread that holds a level is rebuilt from
        // the transcript rather than resumed on that level.
        const effortHeld = !state.effort && typeof handed?.effort === "string";
        const handedStale = Boolean(handed && (!unseen || effortHeld || (externalUpdate && handed.config !== config)));
        const { block: unseenBlock, placed } = unseen && !handedStale ? renderUnseen(unseen) : { block: "", placed: [] };
        const { turnText: contextTurnText, resume } = buildTurnContext({
          text: userTurnText,
          transcript: state.transcript,
          rewound: state.rewound,
          fresh,
          compacted: state.contextReset,
          paused: pausedFold,
          externallyUpdated: Boolean(state.externalContextMarker) || handedStale,
          replaysNatively: replaysNatively(state.instance.driverKind)
        });
        // Snapshot the cursor alongside the context decision. An external result
        // can arrive during async computer/setup work and clear the task cursor;
        // this already-built turn must either keep its old session or replay on the
        // following turn, never start a blank session with no transcript.
        const resumeCursor = resume ? state.task.resumeCursors[state.instanceId] : undefined;
        // A cursor the provider no longer honours must not brick the thread: the
        // driver may fall back to ONE fresh session, and this is what it sends
        // there, so the new session is not blank (server/resume-recovery.ts). A
        // turn carrying an external update gets the replay it would have had.
        const recoveryIsReplay = resumeCursor !== undefined && externalUpdate && state.transcript.length > 0;
        const recoveryText = resumeCursor === undefined ? undefined : recoveryIsReplay
          ? buildTurnContext({ text: userTurnText, transcript: state.transcript, rewound: false, fresh: false, externallyUpdated: true, replaysNatively: false }).turnText
          : buildRecoveryText({ text: userTurnText, transcript: state.transcript });
        // What this turn puts in front of the provider, for each session it can end
        // up in (server/delta-context.ts). buildTurnContext prepends a replay only
        // when it replays, so a changed text means the transcript was sent.
        const carried = [...skipTranscript];
        const windowIds = state.selection.representedIds;
        return {
          turnText: withUnseenMessages(unseenBlock, contextTurnText),
          resumeCursor, sessionReset: !resume, recoveryText,
          handoff: state.strictResume ? {
            botId: state.bot.id, instanceId: state.instanceId, config, resumeCursor: typeof resumeCursor === "string" ? resumeCursor : undefined,
            ...(state.instance.driverKind === "codex" ? { effort: state.effort ?? null } : {}),
            started: sessionStart(state.contextOrder, contextTurnText !== userTurnText ? windowIds : [], carried),
            recovery: sessionStart(state.contextOrder, recoveryText !== undefined ? windowIds : [], carried),
            resumed: sessionStart(state.contextOrder, [], [...placed, ...carried]),
            placed, carried, own: [state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])]
          } : undefined
        };
      };
      state.dispatchContext = decideContext(state.plannedConfig);
      // A call turn (server/voice-turn.ts) runs in the call's own session,
      // never the conversation's: no conversation cursor, no handed-message
      // record. Its first dispatch (the warm, or the first spoken turn) closes
      // an idle process the thread kept, so the call never reuses the long
      // session; the first spoken turn carries the short view of the
      // conversation; the later ones resume the call session, with what it
      // has not seen (a task's result) in front of the words.
      // The conversation's session resumes after a call: the call's lines go
      // in front of the words (a rebuild or a replaying engine has them).
      const callSince = !state.voiceCallTurn && !state.warmOnly ? callLinesSince.get(state.threadId) : undefined;
      if (callSince !== undefined) {
        const from = state.contextOrder.indexOf(callSince);
        if (state.dispatchContext.resumeCursor !== undefined && !state.dispatchContext.sessionReset && from >= 0 && !replaysNatively(state.instance.driverKind)) {
          const lines = replayable.filter((m: any) => state.contextOrder.indexOf(m.id) > from);
          state.dispatchContext = { ...state.dispatchContext, turnText: withUnseenMessages(callLinesBlock(lines), state.dispatchContext.turnText) };
        }
        callLinesSince.delete(state.threadId);
      }
      const liveCall = state.voiceCallTurn ? voiceCalls.active(state.threadId) : undefined;
      state.voiceView = liveCall ? voiceTranscript(context, { excludedIds: skipTranscript, ...(state.record ? { compaction: state.record } : {}) }) : null;
      state.voiceHanded = [];
      state.voiceAnchor = undefined;
      let voiceBriefed = false;
      if (liveCall && state.voiceView) {
        state.plan = voiceSessions.plan(state.threadId, { callId: liveCall.callId, instanceId: state.instanceId, model: String(state.model ?? "") });
        if (state.plan.fresh) {
          // the idle process may hold the conversation's session: never reuse it
          try { state.instance.adapter.releaseWarmSession?.(state.threadId); } catch { /* already closed */ }
        }
        // the warm starts the call's process: the first spoken turn takes it as is
        if (state.warmOnly) voiceSessions.dispatched(state.threadId, []);
        const byId = new Map<string, any>(activeMessages.map((message: any) => [message.id, message]));
        const ownReply = (id: string) => {
          state.source = byId.get(byId.get(id)?.requestMessageId ?? "");
          return Boolean(state.source?.voiceCall);
        };
        const unseen = state.plan.brief ? [] : voiceSessions.unseen(state.threadId, replayable)
          .filter((m: any) => !(m.role === "user" && (m.spoken || byId.get(m.id)?.voiceCall)) && !(m.role === "assistant" && ownReply(m.id)));
        const natively = replaysNatively(state.instance.driverKind);
        const brief = voiceBriefText(state.voiceView.transcript, userTurnText);
        state.text = state.warmOnly ? "" : natively ? userTurnText
          : state.plan.brief ? brief : withUnseenMessages(voiceUnseenBlock(unseen), userTurnText);
        state.voiceHanded = state.warmOnly ? [] : [...(state.plan.brief ? state.voiceView.representedIds : unseen.map((m: any) => m.id)), ...skipTranscript];
        state.voiceAnchor = state.warmOnly ? undefined : (state.contextOrder.at(-1) ?? state.userMessage.id);
        voiceBriefed = state.plan.brief;
        state.dispatchContext = {
          turnText: state.text,
          resumeCursor: state.plan.cursor,
          sessionReset: false,
          // a call session the engine no longer has starts again from the short view
          ...(state.plan.cursor !== undefined && !natively ? { recoveryText: brief } : {}),
          handoff: undefined
        } as typeof state.dispatchContext;
        console.log(`[voice-turn] thread ${state.threadId}: ${state.warmOnly ? "warm" : state.plan.brief ? "new call session" : "call session resumed"} on ${state.instanceId}/${String(state.model ?? "")}, ${Buffer.byteLength(state.text)} bytes of context`);
      }

      const persona = [
        `You are ${state.bot.name}, a personal bot in Sagax.`,
        state.bot.title && `Role: ${state.bot.title}.`,
        state.bot.description && `About: ${state.bot.description}`,
      ]
        .filter(Boolean)
        .join(" ");

      // The SOUL.md mirror is checked here, at dispatch, and only reported:
      // the prompt below reads bot.soul, never the file.
      if (!state.warmOnly) {
        const drift = checkSoulDrift(state.bot.id, state.bot.soul ?? "", state.bot.soulHash ?? "");
        if (drift.drift !== Boolean(state.bot.soulDrift)) store.patchBot(state.bot.id, { soulDrift: drift.drift });
      }
      if (!state.warmOnly && state.dispatchContext.handoff) handoffs.begin(state.threadId, state.dispatchClaimId, state.dispatchContext.handoff);

      state.integrations = {};
      let githubWithheld: string[] = [];
      state.browser = null;
      const selectedSkills = selectBundledSkills(
        state.providerText,
        [
          ...(state.instance.adapter.capabilities.phoneMcp === true ? ["phoneMcp"] : []),
          ...(skillAuthoring ? ["skillAuthoring"] : []),
        ],
        availableSkills(),
      );
      if (selectedSkills.some((skill: any) => skill.manifest.requiredCapabilities.includes("phoneMcp"))) {
        state.integrations.phone = phoneIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
      }
      if (messagesWanted()) state.integrations.messages = messagesIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
      // user-configured MCP servers (config.json mcpServers): only to a
      // driver that can mount them. Their tools are
      // never pre-allowed, so every call rides the normal permission flow.
      if (state.instance.adapter.capabilities.customMcp === true) {
        await refreshMcpOAuth(state.bot);
        const mounted = mcpServersAsPerson(state.bot, orgSpeakerPrincipal(state.bot, state.speaker), state.threadId);
        attachCustomMcp(state.integrations, mounted.servers, cfg);
        githubWithheld = mounted.githubWithheld;
      }
      // Slice 5: the bot's Perspicax profiles, as the person who speaks.
      let perspicaxPrompt = "";
      if (IDENTITY.kind === "perspicax" && state.instance.adapter.capabilities.customMcp === true && (store.bot(state.bot.id) ?? state.bot).perspicax?.profiles.length) {
        const perspicax = await perspicaxTurnIntegration({ bot: state.bot, threadId: state.threadId, generation: state.dispatchClaimId, speaker: state.speaker, taken: Object.keys(state.integrations.custom ?? {}), ...(state.warmOnly ? { quiet: true } : {}) });
        if (Object.keys(perspicax.custom).length) state.integrations.custom = { ...state.integrations.custom, ...perspicax.custom };
        perspicaxPrompt = perspicax.prompt;
      }
      if (!state.warmOnly) turnTrace(state.threadId, "integrations");
      // a call's tools should not come and go between its turns: say so when they do
      const callMcp = voiceCalls.noteMcp(state.threadId, Object.keys(state.integrations.custom ?? {}));
      if (callMcp.added.length || callMcp.removed.length) {
        console.warn(`[voice-call] thread ${state.threadId}: MCP servers changed between call turns${callMcp.added.length ? `; added ${callMcp.added.join(", ")}` : ""}${callMcp.removed.length ? `; missing ${callMcp.removed.join(", ")}` : ""}`);
      }
      // CLI engines work inside the bot's own workspace directory rather
      // than the user's home: a bot with file tools and acceptEdits gets a
      // desk, not the whole house — and the workspace is where its
      // MEMORY.md lives. API/box engines have no local filesystem story.
      const worksInWorkspace = supportsWorkspaceFiles(state.instance.driverKind);
      if (worksInWorkspace) {
        ensureWorkspace(state.bot.id);
        // memory sealed at rest opens back to plain in place for the engine's
        // file tools (started above, off the turn's path), until the turn ends
        // baseline for the journal's turn-boundary diff (see the bus hook)
        // A warm has no turn to journal. endMemoryTurn would close the previous one.
        if (!state.warmOnly && state.bot.memoryEnabled !== false) beginMemoryTurn(state.bot.id, state.threadId);
      }
      state.privateWorkspace = worksInWorkspace ? ensureTaskWorkspace(state.bot.id, state.threadId) : undefined;
      const skillInstructions = renderSkillInstructions(selectedSkills, {
        includeRoot: worksInWorkspace
      });
      const packagePlaybooks = installedPlaybookInstructions(state.providerText, state.bot.playbooks);
      // An explicit working folder wins for new tasks; otherwise they use
      // the private bot workspace. A legacy task with an existing provider
      // session deliberately pins to null (the old home-folder behavior),
      // because moving a live session would break resume.
      // A cloud run keeps the bot's own engine on this host, with the cloud
      // computer as one more tool, so it works in the same folder as any
      // other turn.
      // On a Cloud home a conversation a guest opened is pinned to its own
      // folder when it first runs, not the bot's project folder the owner's
      // conversations share (what it leaves there reaches none of them). One
      // that ran before keeps its pin, unless the session that opened it was
      // revoked: then it was unpinned at boot (server/cloud-owner.ts).
      const pinnedCwd =
        state.privateWorkspace
          // A confidential thread works in its own folder, never the bot's
          // project folder other threads share (server/confidential-threads.ts).
          ? store.pinTaskCwd(state.bot.id, state.threadId, state.privateWorkspace, { privateOnly: cloudGuestOpened(state.threadId) || store.isConfidentialThread(state.threadId) })
          : null;
      // A bot's threads run side by side in one project folder, like several
      // Claude Code or Codex sessions open in one repo: the folder is never a
      // turn-long claim. What truly needs one writer queues on its own — the
      // per-turn snapshot per folder (server/checkpoints.ts), memory through
      // memory_update — and the engines key their sessions by id, not folder.
      state.cwd = pinnedCwd ?? undefined;
      // Checkpoint explicit project folders, where a bot can overwrite the
      // user's work. Its private Sagax workspace is app-owned and changes
      // on nearly every ordinary chat; snapshotting it would add hidden disk
      // and process overhead without a user project to list changes for.
      const checkpointCwd = state.cwd && state.cwd !== state.privateWorkspace ? state.cwd : undefined;
      // dweb is opt-in: without an explicit daemon URL, do not advertise
      // tools that would fail on every call or spawn an unnecessary proxy.
      const dwebUrl = process.env.DWEB_URL?.trim();
      if (dwebUrl) state.integrations.dweb = { url: dwebUrl };
      // Cloud routines on a solo server use the bot's Boat. The per-bot
      // backend applies only to ordinary turns. An organization server
      // never attaches that Boat, a VPS, or a shared team computer: Cloud,
      // including a cloud routine, is the person's one server environment.
      const inheritedComputer = state.computerSkipped ? undefined : inheritedTeamComputer(state.bot);
      const remote = remoteComputerForTurn({
        organization: IDENTITY.kind === "perspicax",
        runOnCloud: state.opts?.runOn === "cloud",
        hasTeamComputer: Boolean(inheritedComputer)
      });
      let teamComputer = remote.skipRemote ? undefined : inheritedComputer;
      const cloudBackend = teamComputer || state.opts?.runOn === "cloud" || state.bot.cloudBackend !== "vps" ? "box" : "vps";
      const mountsComputerMcp = state.instance.adapter.capabilities.computerMcp === true;
      const mountsLocalComputer = state.instance.adapter.capabilities.localComputerMcp === true;
      // Where this turn's hands may land. The bot's "Works on" choice is
      // strict; a browser-only bot gets no computer at all, and a bot whose
      // browser is withheld (workspace flag, its own switch, or an engine
      // without browser tools) gets told so instead of silently falling back
      // to a desktop it was never meant to touch.
      // The conversation's own place wins over the bot default: the person
      // pinned it from the composer, or its first Auto turn recorded where it
      // landed. A team computer or a cloud routine is not this conversation's
      // choice, so those ignore the pin.
      const dispatchTask = store.taskByThread(state.bot.id, state.threadId);
      // Organization server: the person's computers are reached through
      // turnPlace (their server environment, or their own computer through
      // the desktop app). Auto, Cloud, a cloud routine, Local VM and This
      // computer claim nothing here, and a team computer does not either.
      state.wants = state.computerSkipped ? "off" : remote.skipRemote && state.plan.computer !== "off" ? "off" : state.plan.computer;
      mountUserSandbox(state.integrations, {
        botId: state.bot.id, threadId: state.threadId, generation: state.dispatchClaimId,
        customMcp: state.instance.adapter.capabilities.customMcp === true,
        decision: state.turnPlace, staging: state.placedText.staging, auto: state.turnAuto
      });
      await mountPersonalMcp(state.integrations, {
        botId: state.bot.id, threadId: state.threadId, generation: state.dispatchClaimId,
        customMcp: state.instance.adapter.capabilities.customMcp === true, principal: state.turnPlace.principal
      });
      await mountPluginMcp(state.integrations, {
        botId: state.bot.id, threadId: state.threadId, generation: state.dispatchClaimId,
        customMcp: state.instance.adapter.capabilities.customMcp === true, principal: state.turnPlace.principal
      });
      /** A Team incidents turn's computer is optional (turnAnswers): a place
       * that cannot be prepared leaves it with none — any seat taken on the
       * way let go — and the prompt names the cause, where any other turn
       * fails. A stopped setup and a parked seat wait go on as for any turn. */
      const skipComputer = (error: unknown) => {
        if (!state.answer.incident || error instanceof DirectTurnSetupCancelled || error instanceof ComputerWaitParked) throw error;
        state.computerSkipped ??= error instanceof Error ? error.message : String(error);
        state.wants = "off";
        teamComputer = undefined;
        delete state.integrations.localComputer;
        releaseTurnComputer(state.resourceOwner);
      };
      // A place the organisation disallows, or a Cloud home never offers, is
      // refused before anything is prepared; Auto below simply skips them.
      const wantedKind = teamComputer ? "box" : state.wants === "local" ? "thisComputer" : state.wants === "vm" ? "localVm"
        : state.wants === "cloud" ? (cloudBackend === "vps" ? "vps" : "box") : undefined;
      const placeRefusal = wantedKind && computerPlaceRefusal(wantedKind);
      if (placeRefusal) skipComputer(Object.assign(new Error(placeRefusal.message), { status: 409, code: placeRefusal.code }));
      // Where an explicit place came from, so its failure names the one
      // control that changes it (and a failed Auto-recorded pin is cleared).
      // Auto and a team's shared computer are nobody's per-turn choice.
      const namedPlace = teamComputer || state.wants === undefined || state.wants === "off" ? undefined : state.wants;
      state.placeSource = !namedPlace ? undefined
        : state.opts?.runOn === "cloud" ? "routine"
        : state.plan.pinned ? (honouredPin(dispatchTask) ? "pin" : "auto-pin")
        : "works-on";
      // An engine that cannot use the cloud computer, or a Tool selection
      // that leaves its tools out, is refused here, before anything is
      // created or woken — never handed to another engine.
      if (state.wants === "cloud" && state.placeSource) {
        const unsupported = cloudPlaceRefusal(cloudEngine(state.instance, state.bot.modelSelection.model), state.placeSource, state.bot.name)
          ?? computerToolsRefusal(state.toolScope, state.placeSource, state.bot.name);
        if (unsupported) skipComputer(unsupported);
      }
      state.previewCapture = null;
      state.browserCapture = null;
      let computerKind: "box" | "vps" | "vm" | "local" | null = null;
      let autoVpsProblem: string | null = null;
      /** Whether Auto's VPS check reached SSH and Docker (vpsUnavailableHint). */
      let autoVpsReachable: boolean | undefined;
      /** The Local VM frame capture for the poller and the settled transcript
       * screenshot. The shared desktop outlives the turn: once another thread
       * owns it, a capture still in flight would picture ITS work under this
       * bot's name — live and in the settled frame, which is taken after the
       * lease is already released. No owner means the desktop is simply
       * idle: that final frame is ours to keep. */
      const localVmPreviewFor = (localVmTarget: LocalVmTarget, claimThreadId: string) => () => {
        const owner = localVmLeaseFor(localVmTarget).current(localVmOwnerBusy);
        if (owner && owner.threadId !== claimThreadId) {
          throw new Error("the Local VM moved on to another turn");
        }
        return containerComputerFrame(undefined, undefined, localVmTarget);
      };
      /** The exclusive Local VM claim sequence, verbatim from the old inline
       * attach path, shared by dispatch (eager) and the first-screen-call
       * gate (issue #1361). Idempotent per turn: the resource claim and the
       * lease both re-assert the same owner, so a re-entrant call from the
       * gate no-ops once dispatch has already claimed. A lazy attach pins
       * the target it mounted the tools against: the claim must lease that
       * desktop, not whatever localVmTargetForBot resolves to by the time
       * the first screen call arrives. */
      const claimAutoLocalVm = async (claimThreadId: string, pinnedTarget?: LocalVmTarget): Promise<{ target: LocalVmTarget; runtime: Runtime }> => {
        state.localVmTarget = pinnedTarget ?? localVmThreadTargets.get(claimThreadId) ?? { ...localVmTargetForThread(state.bot.id, claimThreadId) };
        const localVmTarget = state.localVmTarget;
        await bindTurnComputer(state.resourceOwner, `computer:vm:${localVmTarget.key}`, true);
        if (localVmImageBusy || localVmModeChangeBusy || localVmLifecycleBusy.has(localVmTarget.key)) {
          throw new Error("this Local VM is being started, stopped, or replaced — wait for setup to finish");
        }
        // Claim before the first await. The lifecycle route performs its
        // matching check synchronously, so neither side can enter while the
        // other is between inspection and mutation.
        if (!localVmLeaseFor(localVmTarget).claim(claimThreadId, state.bot.id, localVmOwnerBusy)) {
          throw new Error("this Local VM is already being used by another turn — wait for that turn to finish");
        }
        // Only a turn that wins its lease extends pool affinity; a thread
        // retrying behind a stranger lets the TTL lapse and migrates.
        if (localVmMode(cfg) === "pool") localVmSeatPool.touch(claimThreadId);
        localVmThreadTargets.set(claimThreadId, localVmTarget);
        localVmActiveThreads.set(localVmTarget.key, claimThreadId);
        localVmIdleFor(localVmTarget).touch();
        // The lease is held from here. An eager attach that fails below
        // fails the turn and settle releases it; a lazy claim's rejection is
        // swallowed into the slot's failed flag and the turn carries on, so
        // without this the exclusive lease would sit held for the rest of a
        // turn that never got the VM — the very serialisation #1361 removes.
        const dropLease = () => {
          if (localVmThreadTargets.get(claimThreadId) !== localVmTarget) return;
          localVmLeaseFor(localVmTarget).release(claimThreadId);
          if (localVmActiveThreads.get(localVmTarget.key) === claimThreadId) localVmActiveThreads.delete(localVmTarget.key);
          localVmThreadTargets.delete(claimThreadId);
          // bindTurnComputer above also took the turn-level resource; a
          // later turn's exclusive bind queues behind it just the same.
          state.resource = `computer:vm:${localVmTarget.key}`;
          turnResources.releaseOne(state.resource, state.resourceOwner);
          if (turnComputerResources.get(state.resourceOwner.threadId)?.resource === state.resource) turnComputerResources.delete(state.resourceOwner.threadId);
        };
        let localVm: Awaited<ReturnType<typeof readyLocalVmForTurn>>;
        try {
          localVm = await readyLocalVmForTurn(state.bot.id, localVmTarget);
        } catch (error) {
          dropLease();
          throw error;
        }
        if (!localVm.ready || !localVm.runtime) {
          dropLease();
          throw new Error(`${localVm.problem ?? "the Local VM is not ready"} (App Settings → Computers)`);
        }
        // The readiness walk can wait minutes for the desktop, and the group
        // path re-validates its lease afterwards; the direct path needs the
        // same guard so a turn never attaches MCP to a desktop another turn
        // now owns.
        const owner = localVmLeaseFor(localVmTarget).current(localVmOwnerBusy);
        if (owner?.threadId !== claimThreadId || owner.botId !== state.bot.id) {
          dropLease();
          throw new Error("the Local VM lease expired while preparing the turn");
        }
        // Same contract as the Boat and VPS branches below: without this the
        // poller never starts, so the Local VM publishes no `screen` events
        // and every client that only has the stream (the phone) waits
        // forever. The web panel hid the gap by polling the screenshot
        // route itself.
        state.previewCapture = localVmPreviewFor(localVmTarget, claimThreadId);
        return { target: localVmTarget, runtime: localVm.runtime };
      };

      // Issue #1369: a lazy claim that rejects must not leave its turn busy
      // behind a gate that can only refuse. Surface the terminal
      // computer-unavailable error, then end the turn. Fenced to this
      // dispatch generation and a still-busy thread, so a rejection landing
      // after settle — or after a newer turn owns the thread — never touches
      // the newer turn. The gate's refusals stay fail-closed for any screen
      // call racing this teardown; the turn-failed buzz and incident follow
      // the dispatch-failure rules (person-started turns only).
      const surfaceLazyClaimRejection = (label: string) => (failure: string, error?: unknown) => {
        if (activeInternalGenerationByThread.get(state.threadId) !== state.resourceOwner.generation || !threadBusy(state.bot.id, state.threadId)) return;
        // The wait ceiling parked this turn (#1651): register the resume and
        // settle the live turn. No error entry, no incident — the parked chip
        // the wait appended is the whole story. The slot still fails, so the
        // gate keeps refusing screen calls for the rest of this generation
        // while the interrupt lands.
        if (state.resourceOwner.computerParkedOn) {
          registerComputerResume({
            botId: state.bot.id,
            threadId: state.threadId,
            resource: state.resourceOwner.computerParkedOn,
            generation: state.resourceOwner.generation,
            afterMessageId: store.activePath(state.threadId).findLast((entry: any) => entry.role === "user")?.id
          });
          void interruptDirectThread(state.bot.id, state.threadId, { preserveComputerResume: true, cause: "computer-park" }).catch(() => {});
          return;
        }
        // A place that failed (mountBotBoat) is already read as its one line
        // and one way on, and never sticks as an Auto-recorded pin.
        const placeFailure: any = error instanceof PlaceUnavailableError ? error : undefined;
        if (placeFailure) clearFailedAutoPin(state.bot.id, state.threadId, placeFailure.place);
        const message = placeFailure?.message ?? `computer unavailable — ${label} could not be claimed for this turn (${failure})`;
        store.appendMessage(state.threadId, {
          role: "bot",
          kind: "activity",
          tool: failedTurnTool(message, placeFailure ? { place: placeFailure.row } : {})
        });
        if (state.opts?.automationSource === undefined && !state.opts?.commsDepth && !state.opts?.cardContinuation) {
          notify(deliverableNotification("turn-failed", state.bot, state.threadId, redactSecretsInText(message), { avatarUrl: state.bot.avatarUrl }));
          reportIncident({ kind: "could-not-start", bot: state.bot, threadId: state.threadId, detail: message });
          // Claude settles the interrupt below as exit_before_result; the
          // completion fold must not report this failure a second time.
          state.resourceOwner.lazyClaimFailureReported = true;
        }
        // A routine, a delegation or a resume reports this exactly as it
        // reports a place that failed at dispatch: with this cause, before
        // the interrupt settles the turn as merely "interrupted".
        state.opts?.onDispatchError?.(message);
        void interruptDirectThread(state.bot.id, state.threadId).catch(() => {});
      };

      /** A lazily claimed remote desktop (the VPS, the bot's Boat) streams
       * from the moment its claim lands. The dispatch-site poller start saw
       * no capture (the claim runs after dispatch), so restart the poller
       * with this one, keeping any browser capture and whether this turn
       * already touched its screen. Same still-running guard as dispatch: a
       * poller started after its own turn.completed would never stop. */
      const adoptClaimedCapture = (capture: () => Promise<{ png: string; format: string }>) => {
        state.previewCapture = capture;
        if (!threadBusy(state.bot.id, state.threadId)) return;
        const touched = screenPollers.get(state.threadId)?.touched ?? false;
        stopScreenPoller(state.bot.id, state.threadId);
        startScreenPoller(
          state.bot.id,
          state.threadId,
          { computer: capture, ...(state.browserCapture ? { browser: state.browserCapture } : {}) },
          { screenIsTheWork: touched },
        );
      };

      // Explicit destinations are strict. In particular, Local VM must never
      // fall through to host CUA and accidentally click on the user's Mac.
      // The Local VM attach, shared by explicit "Local VM" and by Auto. Explicit
      // is strict and throws with the reason. Auto only reaches a VM this bot
      // already has — ready now, or one whose desktop image is prepared and can
      // be recreated on demand after idling away — and never creates a first
      // VM on its own; every failure there is a quiet "not this place".
      const attachLocalVm = async (strict: boolean): Promise<boolean> => {
        if (!mountsComputerMcp) {
          if (!strict) return false;
          throw new Error("this model cannot use the Local VM — choose Claude or an ACP model provider, or select another computer destination");
        }
        if (!strict && localVmMode(cfg) === "pool") {
          // localVmTargetForThread records pool affinity, so a turn the
          // fast path is about to skip must not reserve or refresh a seat.
          // Gate on the side-effect-free candidate assign() would pick —
          // the automationSource bypass below stays authoritative.
          const poolCandidate = poolLocalVmTarget(localVmSeatPool.candidate(state.threadId, localVmPoolSeatHolder));
          if (!localVmSeen.has(poolCandidate.key) && !state.opts?.automationSource) return false;
        }
        state.localVmTarget = { ...localVmTargetForThread(state.bot.id, state.threadId) };
        const localVmTarget = state.localVmTarget;
        let lazyReadyVm: { runtime: Runtime } | null = null;
        if (!strict) {
          // Nothing this process has ever seen for this target, and nobody is
          // relying on an unattended run: do not pay for a runtime probe.
          if (!localVmSeen.has(localVmTarget.key) && !state.opts?.automationSource) return false;
          const seen = await containerComputerStatus(undefined, undefined, localVmTarget).catch(() => null);
          if (!seen || !autoLocalVmAttachable(seen)) return false;
          if (localVmImageBusy || localVmModeChangeBusy || localVmLifecycleBusy.has(localVmTarget.key)) return false;
          if (seen.ready && seen.runtime) lazyReadyVm = { runtime: seen.runtime };
        }
        try {
          if (lazyReadyVm) {
            // Lazy exclusivity (issue #1361): a VM that is ready right now
            // mounts without claiming — screen-less Auto turns never touch
            // the lease, and the first screen tools/call fires the claim
            // through the computer-control gate. A VM that must be created
            // or recreated first keeps the eager claim below: the bridge
            // child needs the container to exist, and readyLocalVmForTurn
            // is what boots it.
            state.integrations.localComputer = containerComputerMcp(
              lazyReadyVm.runtime,
              controlIntegration(state.bot.id, state.threadId, state.dispatchClaimId),
              localVmTarget,
            );
            autoVmClaims.set(state.threadId, {
              owner: state.resourceOwner,
              lazy: true,
              label: "the Local VM",
              localVm: true,
              onRejected: surfaceLazyClaimRejection("the Local VM"),
              claim: async () => {
                await claimAutoLocalVm(state.threadId, localVmTarget);
                // The dispatch-site poller start saw a null previewCapture
                // (this lazy mount runs before any claim exists), so this
                // turn would publish no live `screen` events and settle no
                // final computer frame. Restart the poller with the now-live
                // computer capture, keeping any browser capture and whether
                // this turn already touched its screen. Same still-running
                // guard as dispatch: a poller started after its own
                // turn.completed would never be torn down.
                if (state.previewCapture && threadBusy(state.bot.id, state.threadId)) {
                  const touched = screenPollers.get(state.threadId)?.touched ?? false;
                  stopScreenPoller(state.bot.id, state.threadId);
                  startScreenPoller(
                    state.bot.id,
                    state.threadId,
                    { computer: state.previewCapture, ...(state.browserCapture ? { browser: state.browserCapture } : {}) },
                    { screenIsTheWork: touched },
                  );
                }
              }
            });
            return true;
          }
          const claimed = await claimAutoLocalVm(state.threadId);
          state.integrations.localComputer = containerComputerMcp(
            claimed.runtime,
            controlIntegration(state.bot.id, state.threadId, state.dispatchClaimId),
            claimed.target,
          );
          // Hand the same claim to the first-screen-call gate. This eager
          // path has already claimed, so the gate's fire-once call can only
          // re-assert the same owner — a no-op (issue #1361).
          autoVmClaims.set(state.threadId, {
            owner: state.resourceOwner,
            label: "the Local VM",
            claim: async () => { await claimAutoLocalVm(state.threadId); }
          });
          return true;
        } catch (error) {
          // A wait ceiling settled this turn as parked, not as an unavailable
          // Auto destination. Let dispatch register its resume instead of
          // continuing the provider without the requested computer.
          if (strict || error instanceof ComputerWaitParked) throw error;
          if (directTurnGenerationByThread.get(state.threadId) === state.dispatchClaimId) releaseLocalVmThread(state.threadId);
          return false;
        }
      };
      // An explicit place that cannot be attached fails the turn with its
      // cause and the next action; it never quietly moves the work elsewhere.
      try {
        if (state.wants === "vm") {
          if (await attachLocalVm(true)) computerKind = "vm";
        } else if (state.wants === "local") {
          state.integrations.localComputer = await mountHostComputer(
            state.resourceOwner, state.bot.id, mountsLocalComputer, surfaceLazyClaimRejection("this computer"),
            savedSteps.journals(directRequestOwners.get(state.threadId)),
          );
          computerKind = "local";
        }

        // A VPS is a local-agent computer mount, never a remote agent runner.
        // Explicit Cloud may prepare/start it. Auto remains read-only unless
        // the person explicitly opted this bot into remote lifecycle actions.
        // On Auto an engine that cannot use a computer simply skips it.
        if ((state.wants === "cloud" || (state.wants === undefined && managedPolicy.computerAllowed("vps"))) && cloudBackend === "vps" &&
            canWorkOnCloud(cloudEngine(state.instance))) {
          // The VPS "computer" is the desktop inside this bot's managed
          // container, and only screen work needs that desktop to itself.
          // So the lease is claimed on the first computer call, through the
          // computer-control gate (the Local VM's seam, #1361), never at
          // mount: a bot's turns that never touch the computer tools run
          // side by side, and its 3-hourly routine no longer queues behind
          // — or fails after 30 minutes behind — its own long-running task.
          // Container lifecycle (provision, start) is serialized by the
          // runner's per-container lock, not by this turn.
          vpsThreadStarted(state.bot.id, state.threadId);
          const mounted = await mountBotVps(state.bot, state.resourceOwner, {
            start: vps.vpsStartsForTurn({ wants: state.wants, autoStartVps: state.bot.autoStartVps, automationSource: state.opts?.automationSource }),
            // The claim restarts the poller with the capture, the way the
            // Local VM's lazy claim does.
            onClaimed: (vpsCapture: any) => {
              adoptClaimedCapture(vpsCapture);
            },
            onRejected: surfaceLazyClaimRejection("the VPS computer")
          }).catch((error: unknown) => {
            // Explicit Cloud is strict. On Auto a start the person allowed
            // that could not finish is one more reason the VPS is
            // unavailable, read below like any other.
            if (state.wants === "cloud") throw error;
            return { problem: error instanceof Error ? error.message : String(error), reachable: undefined };
          });
          if ("integration" in mounted) {
            state.integrations.localComputer = mounted.integration;
            computerKind = "vps";
          } else {
            vpsThreadEnded(state.bot.id, state.threadId);
            if (state.wants === "cloud") {
              throw new Error(mounted.problem ?? "the VPS computer could not be created or reached");
            }
            autoVpsProblem = mounted.problem ?? "the VPS computer could not be reached";
            autoVpsReachable = mounted.reachable;
          }
        }

        if (teamComputer) {
          const attached = await attachTeamBoat(teamComputer, state.bot.id, state.resourceOwner, canWorkOnCloud(cloudEngine(state.instance)));
          Object.assign(state.integrations, attached.mount);
          state.previewCapture = attached.capture;
          computerKind = "box";
        }
        // Cloud is strict when selected. A turn reaches the Boat only when
        // this conversation is on it (Works on, a pin, a cloud routine, or
        // select_computer): an Auto turn never reads the Boat account, so it
        // adds no Boat call, cannot be stopped by a Boat being deleted, and
        // never records a place nobody chose. Even then the Boat is created
        // or woken only by the bot's first computer call (mountBotBoat): a
        // chat that never touches the screen uses no plan hours.
        if (!teamComputer && cloudBackend === "box" && boat.boatConfigured(cfg) && state.wants === "cloud") {
          state.integrations.localComputer = mountBotBoat(state.bot, state.resourceOwner, {
            // The row a failed attach always wrote: the place's one line and
            // its one way on, read where the place came from (an
            // Auto-recorded pin is cleared, as dispatch clears it).
            source: state.placeSource,
            onClaimed: adoptClaimedCapture,
            onRejected: surfaceLazyClaimRejection("the cloud computer")
          });
          computerKind = "box";
        }
        if (state.wants === "cloud" && cloudBackend === "box" && !boat.boatConfigured(cfg)) {
          throw boatNotConfigured(state.bot, state.placeSource ?? "works-on");
        }
        if (state.wants === "cloud" && cloudBackend === "box" && computerKind !== "box") {
          throw new Error("the cloud computer could not be created or reached");
        }
      } catch (error) {
        // Auto, Off and a team's shared computer name no place; they fail as
        // they are.
        skipComputer(!namedPlace || !state.placeSource ? error : await asPlaceFailure(error, namedPlace, state.placeSource, state.bot, cloudBackend));
      }

      // Auto-only host fallback. Electron owns cua-driver/TCC attribution;
      // the harness only reads its already-running connection descriptor.
      // Auto reaches a Local VM this bot already has before it ever touches the
      // host's own desktop: on a headless server that VM is the only desktop
      // there is, and a person who prepared one meant it to be used.
      if (state.wants === undefined && !state.integrations.localComputer && !computerPlaceRefusal("localVm") && await attachLocalVm(false)) computerKind = "vm";
      // An unattended run on a bot with a VPS configured never lands on the
      // host's own desktop instead: a scheduled job clicking on someone's
      // laptop is worse than a scheduled job that fails and says why.
      const unattendedVps = cloudBackend === "vps" && Boolean(state.opts?.automationSource);
      if (
        !state.integrations.localComputer &&
        state.wants === undefined &&
        !unattendedVps &&
        !computerPlaceRefusal("thisComputer") &&
        shouldMountLocalComputer({
          requested: undefined,
          hostPlatform: process.platform,
          providerSupportsLocal: mountsLocalComputer
        })
      ) {
        const cua = readCuaConnection();
        if (cua) {
          // Lazy host claim (issue #1650): the gated integration mounts
          // now, but the exclusive computer:host seat is taken only by the
          // first screen tools/call, through the computer-control gate —
          // the same seam as the Local VM (#1361) and the VPS. An Auto
          // turn that never touches the screen holds no desktop seat and
          // records no pin; a claim that finds the seat held waits behind
          // the holder like every other seat instead of failing on the
          // spot.
          autoVmClaims.set(state.threadId, {
            owner: state.resourceOwner,
            lazy: true,
            label: "this computer",
            onRejected: surfaceLazyClaimRejection("this computer"),
            claim: async () => {
              await bindTurnComputer(state.resourceOwner, HOST_COMPUTER_RESOURCE, true);
            }
          });
          state.integrations.localComputer = gatedLocalComputer(
            cua, controlIntegration(state.bot.id, state.threadId, state.dispatchClaimId, "this computer"),
            savedSteps.journals(directRequestOwners.get(state.threadId)),
          );
          computerKind = "local";
        }
      }
      // Auto found this bot's VPS unavailable and no other computer took its
      // place. A scheduled run fails and says why: its work is the screen,
      // and nobody is there to read a reply. Every other turn runs — a
      // Chief's assignment or a card's resume that never touches the screen
      // must not fail on a VPS it never uses — and its model is told the
      // true reason and the one way on, so work that does need the screen
      // says so instead of claiming it. A turn with select_computer can
      // start the VPS itself.
      let vpsUnavailableNote = "";
      if (
        state.wants === undefined &&
        cloudBackend === "vps" &&
        !state.integrations.localComputer &&
        autoVpsProblem &&
        !computerSelectionTurns.has(state.threadId)
      ) {
        const hint = vps.vpsUnavailableHint({ automationSource: state.opts?.automationSource, autoStartVps: state.bot.autoStartVps, reachable: autoVpsReachable });
        if (state.opts?.automationSource) skipComputer(new Error(`${autoVpsProblem}. ${hint}`));
        else vpsUnavailableNote = ` This bot's VPS computer is unavailable this turn (${autoVpsProblem}), so no computer is mounted. Work that needs no screen can go ahead. If the request needs the VPS desktop, do not claim to have used it: say it is unavailable${hint ? ` and what the person can do: ${hint}` : "."}`;
      }
      // Agent control tools include peer comms and the secure credential
      // request card. A comms-invoked turn (depth ≥ cap) gets none — hard recursion
      // stop, so the user's tokens can't be burned by a bot-to-bot loop.
      // Only drivers that mount the tools get the integration (and, via the
      // integrations.agents gate below, the prompt hint) — a bot on a driver
      // without it must not be told about tools it cannot call. Any bot can
      // still be the TARGET of ask_bot regardless of its driver.
      // One reachability rule for the roster, list_bots and @mention
      // resolution: a bot is never told about — or nudged toward — a peer
      // that ask_bot and delegate_bot would then refuse.
      const sectionPeers = reachablePeers(store.bots, state.bot);
      if (state.agentsMounted) {
        // Only a direct human request can create separate self-owned jobs.
        // Coordinated children and self-opened jobs stay inside their scope;
        // a later real user message on the same task is a fresh request.
        state.origin = state.opts?.cardContinuation
          ? store.activePath(state.threadId).findLast((message: any) => message.role === "user" && message.kind === "text")
          : state.userMessage;
        const ownThreadCreation = state.boundedCoordination && !state.coordinated && Boolean(state.origin && !state.origin.peerAsk);
        state.integrations.agents = agentsIntegration(state.bot.id, state.threadId, state.commsDepth, skillAuthoring, state.dispatchClaimId, state.opts?.coordination?.id, state.boundedCoordination, ownThreadCreation, worksInWorkspace, !engineHasNativeWebSearch(state.instance.driverKind, withholdHostToolsFor(state.instance), state.model));
      }
      if (state.instance.adapter.capabilities.hooks === true && hooksEnabled()) {
        state.integrations.hooks = hooksIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
        void runLifecycleEvent(state.bot.id, state.threadId, "before_submit_prompt", {}).catch(() => {});
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit coordination nudge. The agent still chooses the matching
      // peer tool, so the harness stays the single owner of turns/permissions.
      const tagged = state.integrations.agents && !state.peerHop
        ? mentionedBots(
            state.providerText,
            sectionPeers,
          )
        : [];
      // A person's request that names a teammate: its engine starts now, in
      // the work thread coordinate_bots would use, so the delegation does not
      // wait for a cold start (perf round 3).
      if (!state.warmOnly && state.integrations.agents && state.boundedCoordination && !state.commsDepth && !state.opts?.coordination && !store.groupByThread(state.threadId)) {
        prewarmNamedTeammates(state.bot, state.threadId, namedTeammates(state.providerText, sectionPeers, tagged));
      }
      const coordinationPrompt = state.bot.chiefOfStaff
        ? chiefOfStaffSystemPrompt(
            state.bot.id,
            store.bots,
            Boolean(state.integrations.agents) && !state.peerHop,
            state.boundedCoordination,
          )
        : state.integrations.agents && !state.peerHop && sectionPeers.length > 0
          // Ordinary bots could always CALL the peer tools; until now the
          // one generic sentence they got never named a teammate, so the
          // first move of any collaboration was a list_bots round trip the
          // model mostly did not think to make.
          ? peerRosterSystemPrompt(sectionPeers, state.boundedCoordination, botCreationOffered(state.bot, ownerBotsReadOnly(state.bot)), sameOwnerRosterMember(state.bot))
          : "";
      const credentialPrompt = state.integrations.agents ? CREDENTIAL_PROMPT + (state.boundedCoordination || state.peerHop ? "" : THREADS_PROMPT) + WIDGET_PROMPT + WIDGET_APPROVAL_PROMPT : "";
      const routinePrompt = state.integrations.agents ? ROUTINE_PROMPT : "";
      const profilePrompt = state.integrations.agents ? botProfilePrompt(state.bot) : "";
      const recallPrompt = state.integrations.agents && state.bot.memoryEnabled !== false ? SESSION_SEARCH_SYSTEM_PROMPT : "";
      const learnPrompt = skillAuthoring ? LEARN_PROMPT : "";

      // (activeVpsThreads was already claimed above, before the provision or
      // reuse await, so the backend guards saw this turn the whole time.)
      // Wait immediately before dispatch: resources are already claimed, but
      // the engine cannot edit the project until the snapshot has settled.
      // snapshot() absorbs failures, so checkpointing may delay but never fail
      // a turn.
      if (checkpointCwd) {
        // Pinned by this dispatch: a sibling thread's snapshot in the same
        // folder must not reclaim this turn's "before" state while it runs.
        const before = await checkpoints.snapshot(state.bot.id, checkpointCwd, `turn ${state.threadId.slice(0, 8)}`, undefined, { pin: state.dispatchClaimId });
        if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
          if (before) void checkpoints.release(state.bot.id, checkpointCwd, state.dispatchClaimId);
          throw new DirectTurnSetupCancelled("turn stopped during checkpoint");
        }
        forgetTurnCheckpoint(state.threadId);
        if (before) turnCheckpoints.set(state.threadId, { botId: state.bot.id, cwd: checkpointCwd, hash: before, pin: state.dispatchClaimId });
      }
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
        throw new DirectTurnSetupCancelled("turn stopped before dispatch");
      }
      // Mint the browser bearer at the last possible moment. The desktop
      // registration is asynchronous, so validate this exact setup claim
      // again inside browserIntegration before the capability is published.
      // Also the one bot snapshot setupModeActive and the prompt's soul
      // (below) share, so a soul saved mid-dispatch is seen by both instead
      // of the two disagreeing about whether setup mode is still active.
      const liveBot = store.bot(state.bot.id);
      const setupMode =
        state.peerToolsMounted &&
        setupModeActive({
          soul: liveBot?.soul ?? state.bot.soul,
          description: liveBot?.description ?? state.bot.description,
          text: state.providerText
        });
      if (liveBot && state.instance.adapter.capabilities.dataMcp === true) {
        const data = dataIntegration(state.bot.id, { threadId: state.threadId, generation: state.dispatchClaimId });
        if (data) state.integrations.data = data;
      }
      // One place per turn. On Auto the branches above may have reached a
      // computer; then the built-in browser stays unmounted and web work
      // happens in that computer's own browser. Not on this computer, the
      // person's own screen (2026-10-28): the built-in browser stays beside
      // it, so a lookup never opens a window in front of them
      // (HOST_SCREEN_RULE in server/surface.ts).
      const mountedComputer = surfaceOfComputerKind(computerKind);
      if (computerKind === "local") hostScreenTurns.set(state.threadId, { botId: state.bot.id, generation: state.dispatchClaimId });
      else hostScreenTurns.delete(state.threadId);
      if (
        liveBot &&
        state.plan.browser &&
        !(state.plan.computer === undefined && mountedComputer && mountedComputer !== "local") &&
        // On the person's computer, web pages open in their own browser
        // (sagax-desktop browse), on their network, not on this server.
        // Auto keeps the built-in browser: it is one of the places it picks.
        !(state.turnPlace.target === "user-desktop" && !state.turnAuto?.auto && state.integrations.custom?.[DESKTOP_BRIDGE_MCP_NAME]) &&
        builtInBrowserEnabled(cfg) &&
        liveBot.browser !== false &&
        state.instance.adapter.capabilities.browserMcp === true
      ) {
        const selectedProfile = liveBot.browserProfile;
        state.browser = await browserIntegration(state.bot.id, selectedProfile, { threadId: state.threadId, generation: state.dispatchClaimId });
        if (state.browser) state.integrations.browser = state.browser.integration;
        // The browser lost its frame source when the Electron surface was
        // removed: previewCapture is set by the computer branches above, and
        // nothing replaced it here. A bot with only a browser was pictured
        // not at all; a bot with both was pictured on its desktop even while
        // the work was a web page, because agent-browser runs its own headless
        // Chrome on the host rather than inside that desktop.
        if (state.browser) {
          const frame = { binaryPath: state.browser.spec.command, env: state.browser.spec.env };
          const session = state.browser.session;
          // The preview shares the profile with tool calls: claim the same
          // exclusive browser:<session> resource the tools/call path claims,
          // and skip the frame while another thread holds it.
          state.browserCapture = async () => {
            const owner = turnResourceOwners.get(state.threadId);
            if (!owner || !claimTurnResource(owner, `browser:${session}`)) throw new Error("another thread is using this browser");
            return browserRuntime.previewFrame(session, () => agentBrowserFrame(frame));
          };
        }
      }
      // Auto remembers no place (2026-10-16): where this turn works, the
      // built-in browser or a computer it claims, is never written to the
      // conversation. The next message decides again; only the person's own
      // pin holds a place (honouredPin).
      const computerSelection = computerSelectionTurns.get(state.threadId);
      if (computerSelection) computerSelection.mounted = mountedComputer ?? (state.integrations.browser ? "browser" : undefined);
      // A cancelled adapter can be between accepting sendTurn and revealing
      // its provider turn id. Never overlap a replacement with that ambiguous
      // pre-id window: wait for the old handshake to settle or for its bounded
      // quarantine to expire, then revalidate this exact claim before launch.
      // An embedding endpoint the person runs reads this turn's recall query
      // first (bounded, server/semantic-recall.ts), before the claim below
      // is revalidated. Without one nothing is awaited.
      if (state.bot.memoryEnabled !== false && autoRecallEnabled(cfg) && semanticEmbeddingEndpoint(cfg)) await prepareSemanticRecall(state.bot.id, recallQuery(state.resolvedImages.text));
      await pendingCancelledProviderHandshakes.waitForClear(state.threadId);
      if (!markDirectTurnDispatching(state.bot.id, state.dispatchClaimId, state.threadId)) {
        throw new DirectTurnSetupCancelled("turn stopped before dispatch");
      }
      const computerPromptKind = resolveComputerPromptKind({
        kind: computerKind,
        vmPrivate: localVmMode(cfg) === "per-bot"
      });
      const coordinationNode = state.opts?.coordination ? coordinator.node(state.opts.coordination.id) : undefined;
      if (state.opts?.coordination && (!coordinationNode || coordinationNode.status !== "running" || roomHandoffProblem(coordinationNode,
        coordinationNode.parentId ? coordinator.node(coordinationNode.parentId) : undefined))) {
        throw new DirectTurnSetupCancelled("Coordination access changed before dispatch");
      }
      // Single stream (thread mode off): a person's turn in a stream segment
      // carries the digest of their earlier topics (server/single-stream.ts),
      // never on a call (a phone turn stays short), and those topics leave
      // the recent-work brief so nothing is said twice.
      const streamPart = !state.onCall && streamTurn(state.bot, state.threadId, { person: state.commsDepth === 0 && !coordinationNode && !state.opts?.automationSource && !state.opts?.unattended && !state.warmOnly && !state.userMessage.peerAsk })
        ? streamDigestPrompt(state.bot, state.threadId) : null;
      if (streamPart?.text) refreshStreamDigests(state.bot.id, state.threadId);
      // Stable prefix on every engine. Compact tool list on Claude Code only,
      // local or cloud: Grok, Codex and Pi discover tools from the full list.
      const promptMode = {
        bot: parseLocalPromptMode((liveBot ?? state.bot).localPrompt),
        engine: parseLocalPromptMode(process.env.SAGAX_LOCAL_PROMPT)
      };
      const stablePrompt = usesStablePrompt(promptMode);
      state.compactPrompt = usesCompactPrompt({ ...promptMode, driverKind: state.instance.driverKind, model: state.model })
        ? compactPromptFor(liveBot ?? state.bot, typeof state.turnPrincipal === "string" && state.turnPrincipal ? state.turnPrincipal : effectiveBotOwner(state.bot))
        : undefined;
      const promptApprovalLevel = approvalModeForTurn(state.bot, state.commsDepth > 0, state.threadId);
      // Cold / automation turns (routines, webhooks, proactive): tighter
      // per-section budgets, lazy skill index, short rich-output (V1/R3).
      const coldPrompt = state.opts?.automationSource !== undefined;
      const promptParts = [
        { id: "finish-until", label: "Do not finish until", text: finishUntilPrompt((liveBot ?? state.bot).finishUntil) },
        // #1372: a 1:1 goal's instruction, while it works; never the person's message
        { id: "goal", label: "Goal", text: soloGoalSystemPrompt(soloGoals.get(state.threadId)) },
        { id: "user-profile", label: "About the user", text: userProfileSystemPrompt(botUserProfile(state.bot)) },
        { id: "ai-client", label: "AI client", text: aiClientThreadPerson(state.bot, state.threadId, state.commsDepth, state.userMessage) },
        { id: "model", label: "Model", text: state.onCall ? "" : modelPrompt({ engine: engineDisplayName(state.instance), model: String(state.model ?? ""), actual: modelFallbackByThread.get(state.threadId)?.requested === state.model ? modelFallbackByThread.get(state.threadId)?.actual : modelFallbackByPayer.get(modelFallbackPayerKey(state.threadId, state.instance.instanceId, String(state.model ?? ""))) }) },
        // first after the soul: the block names agent tools, so it only goes
        // to a turn whose engine actually mounted them (setupMode is already
        // false when they are not — see agentsMounted above)
        { id: "setup", label: "Setup", text: setupSystemPrompt(setupMode, { skills: skillAuthoring, cwd: liveBot?.cwd ?? state.bot.cwd }) },
        { id: "files", label: "File locations", text: worksInWorkspace ? workspaceLocationsPrompt(state.bot.id, state.cwd, liveBot?.cwd ?? state.bot.cwd, { attachFile: Boolean(state.integrations.agents) && !HOSTED_WORKSPACE, confidential: store.isConfidentialThread(state.threadId), relativePaths: state.instance.driverKind === "claudeAgent", ...(stablePrompt ? { cwdElsewhere: true } : {}) }) : "" },
        // The conversation's own folder, on its own line, so the rest of the
        // file locations is the same bytes in every conversation of this bot.
        { id: "files-cwd", label: "Current working folder", text: stablePrompt && worksInWorkspace ? workspaceCwdPrompt(state.cwd) : "" },
        { id: "shell", label: "Long-running commands", text: worksInWorkspace ? longCommandsPrompt(computerPromptKind) : "" },
        { id: "computer", label: "Computer", text: computerPrompt(computerPromptKind) },
        { id: "team-computer", label: "Team computer", text: teamComputerPrompt(teamComputer) },
        // Auto's standing rules, volatile: a reused session gets them once;
        // each message carries only where it starts (withWorkplaceNote)
        { id: "workplace", label: "Workspace", text: state.turnAuto?.auto ? `\n${AUTO_COMPUTER_RULES}` : "" },
        { id: "plan", label: "Surface", text: surfacePrompt({ computer: mountedComputer, browser: Boolean(state.integrations.browser) }, { pinned: state.plan.pinned, note: state.plan.note + vpsUnavailableNote + (state.computerSkipped && state.plan.computer !== "off" ? computerSkippedNote(redactSecretsInText(state.computerSkipped)) : ""), canSelect: computerSelectionTurns.has(state.threadId) || (state.warmOnly && state.maySelectComputer), cloudHome: false }) },
        { id: "cloud-home", label: "OMB Cloud", text: "" },
        // gated on the integration, not the key: the hint only goes to a
        // bot whose driver actually mounted the tools
        { id: "mcp", label: "MCP servers", text: customMcpPrompt(Object.keys(state.integrations.custom ?? {})) + githubWithheldPrompt(githubWithheld) },
        { id: "perspicax", label: "Perspicax", text: perspicaxPrompt },
        // run_with_engine is shown to a person's own direct turn only (not one hop away)
        { id: "claude-ai", label: "Claude connectors", text: engineConnectorsPromptFor(liveBot ?? state.bot, state.instance, state.speaker, { level: promptApprovalLevel, relay: Boolean(state.integrations.agents) && state.commsDepth === 0 }) },
        // the level this turn really runs at (approvalModeForTurn), so Full never asks for a typed GO
        { id: "approval-level", label: "Approval level", text: approvalLevelPrompt(promptApprovalLevel) },
        // #1819: effective ask-before-contact (Full skips the Sagax peer card)
        { id: "peer-contact", label: "Peer contact", text: peerContactPrompt({
          canContact: Boolean(coordinationPrompt),
          asksBeforeContact: peerReviewRequired(liveBot ?? state.bot, state.threadId)
        }) },
        // 2026-10-30: the bot knows it is proactive, and how (server/proactive-wake.ts)
        { id: "proactive", label: "Proactive", text: proactivePrompt(proactiveModeFor(liveBot ?? state.bot)) },
        // what this turn reaches, in one line: "what connectors do you have" needs no tool call (server/turn-reach.ts)
        { id: "reach", label: "Reach", text: turnReachPrompt(liveBot ?? state.bot, state.instance, state.speaker, state.threadId, state.integrations, Boolean(mountedComputer)) },
        { id: "browser", label: "Browser", text: state.integrations.browser ? BUILT_IN_BROWSER_SYSTEM_PROMPT + myChromePromptFor(state.bot, state.threadId) : "" },
        { id: "data", label: "Data", text: state.integrations.data ? BUILT_IN_DATA_SYSTEM_PROMPT : "" },
        { id: "coordination", label: "Team", text: coordinationPrompt ? ` ${coordinationPrompt}` : "" },
        { id: "assignment", label: "Teammate task", text: coordinationNode?.parentId || (state.warmOnly && state.opts?.warmCoordination === true) ? `\n${coordinationSystemInstructions()}` : "" },
        { id: "outstanding", label: "Outstanding teammate work", text: outstandingAssignmentsPrompt(state.threadId) },
        { id: "credential", label: "Credentials", text: credentialPrompt },
        // its own paragraph, so a smaller model reads it as a rule of its
        // own; never on a call (the tools are not shown there either)
        { id: "reactions", label: "Reactions", text: state.integrations.agents && !state.onCall ? REACTION_PROMPT : "" },
        { id: "recall", label: "Recall", text: recallPrompt },
        { id: "routine", label: "Routines", text: routinePrompt },
        { id: "routine-execution", label: "Routine execution", text: state.opts?.automationSource === "schedule" || state.opts?.automationSource === "manual" ? ROUTINE_EXECUTION_PROMPT : "" },
        { id: "profile", label: "Profile changes", text: profilePrompt },
        { id: "learn", label: "Skill authoring", text: learnPrompt },
        { id: "rich-output", label: "Rich output", text: richOutputPrompt((liveBot ?? state.bot).emailDrafts !== false) },
        { id: "dev-pods", label: "Coding view", text: devPodsPrompt(devPodsThreads.isOn(state.threadId)) },
        { id: "section-context", label: "Section context", text: sectionContextSystemPrompt(state.bot.section) },
        { id: "team-memory", label: "Team memory", text: teamMemory.systemPrompt(state.bot.section) + (state.integrations.agents ? TEAM_MEMORY_PROMPT : "") },
        // who on the team roster is busy right now; volatile, so a teammate
        // starting or finishing work never changes the stable half
        teamAvailabilityPart(coordinationPrompt ? sectionPeers : []),
        // what the bot said lately in its other conversations, so a task
        // never redoes — or forgets — what another one already did
        // not on a call: a phone turn stays short (docs/voice-mode-xai.md, "Latency")
        { id: "recent", label: "Recent work", text: state.onCall ? "" : recentWorkPrompt(recentWorkFor(state.bot, state.threadId, { userName: botUserName(state.bot) }).filter((line: any) => !streamPart?.threadIds.has(line.threadId)).slice(0, state.compactPrompt ? LOCAL_RECENT_WORK_LINES : undefined)) },
        { id: "stream", label: "Earlier topics", text: streamPart?.text ?? "" },
        // RULES.md: listed here, placed right after the soul by buildSystemPrompt
        { id: "rules", label: "Rules (RULES.md)", text: rulesSystemPrompt(state.bot.id, { writes: Boolean(state.integrations.agents) }) },
        { id: "memory", label: "Memory", text: memoryPromptFor(state.bot, { managedWrites: Boolean(state.integrations.agents), fileTools: worksInWorkspace, withholdHostTools: withholdHostToolsFor(state.instance) }) },
        { id: "host-tools", label: "Host tools", text: withholdHostToolsFor(state.instance) ? WITHHELD_HOST_TOOLS_PROMPT : "" },
        // docs/: an index only, never the documents (server/workspace-files.ts)
        { id: "docs", label: "Documents index", text: docsIndexPrompt(state.bot.id, { tools: state.integrations.agents ? "agents" : worksInWorkspace ? "files" : "none" }) },
        // liveBot was captured before awaited setup work; an assignment PUT
        // in that window must still reach this turn's prompt.
        { id: "skills", label: "Skills index", text: scopedSkillsPrompt(state.bot, state.instance, orgSpeakerPrincipal(state.bot, state.speaker), { managedTools: skillDiscoveryAvailable(Boolean(state.integrations.agents), state.toolScope), fileAccess: Boolean(state.privateWorkspace), syncNative: true, indexOnly: coldPrompt })?.text ?? "" },
        { id: "skill-instructions", label: "Skill instructions", text: coldPrompt ? "" : skillInstructions },
        { id: "playbooks", label: "Playbooks", text: coldPrompt ? "" : packagePlaybooks },
        { id: "webhook", label: "Webhook provenance", text: state.opts?.automationSource === "webhook" ? WEBHOOK_PROMPT : "" },
        { id: "mentions", label: "Mentions", text: state.boundedCoordination && tagged.length ? `The user named these existing teammates: ${tagged.map((b: any) => uniquePeerName(b, sectionPeers) ? peerName(b.name) : `${peerName(b.name)} (${b.id})`).join(", ")}. Use coordinate_bots when their contribution is needed (a unique name works as its bot_ids entry), with relay=true when the user only wants one teammate's own answer passed back; do not substitute native helper agents for these bots.` : mentionPrompt(tagged) },
        // a voice call: the phone-call instruction (server/voice-call-prompt.ts)
        { id: "voice-call", label: "Phone call", text: state.voiceCallText },
      ];
      const builtPrompt = buildSystemPrompt(persona, liveBot?.soul ?? state.bot.soul ?? "", coldPrompt ? lightenColdPrompt(promptParts) : promptParts, stablePrompt || state.instance.driverKind === "claudeAgent"
        ? new Set([
          ...(state.instance.driverKind === "claudeAgent" ? CLAUDE_REUSE_VOLATILE_SECTIONS : []),
          ...(stablePrompt ? COMPACT_VOLATILE_SECTIONS : []),
        ])
        : undefined);
      const prompt = stablePrompt ? compactVolatileOrder(builtPrompt) : builtPrompt;
      turnPromptBytes.set(state.threadId, { stable: Buffer.byteLength(prompt.stable), volatile: Buffer.byteLength(prompt.volatile) });
      const catalogBytes = toolDefinitionBytes(state.integrations.agents?.env);
      const buckets = measureContextBuckets({
        sections: prompt.sections,
        promptBytes: Buffer.byteLength(prompt.stable) + Buffer.byteLength(prompt.volatile),
        messages: state.transcript.length,
        messageBytes: state.transcript.reduce((sum: any, entry: any) => sum + Buffer.byteLength(entry.text ?? ""), 0),
        toolsBytes: catalogBytes.tools,
        agentsBytes: catalogBytes.agents
      });
      if (buckets) turnContextBuckets.set(state.threadId, buckets);
      else turnContextBuckets.delete(state.threadId);
      // the dev panel's Connectors card: what this turn really reached
      if (!state.warmOnly) store.patchTask(state.bot.id, state.threadId, { connectors: turnConnectorsFor(liveBot ?? state.bot, state.instance, state.speaker, state.integrations, state.turnPlace.principal, state.instance.adapter.capabilities.customMcp === true) });
      if (!state.warmOnly) turnTrace(state.threadId, "prompt-built");
      // the Files list's "last used": what this turn's prompt carried
      markWorkspaceUse(state.bot.id, promptSectionPaths(prompt.sections));
      // Automatic recall rides in front of THIS turn's message, never in the
      // system prompt: the volatile half is re-sent whole whenever any part of
      // it changes, and recall changes nearly every turn.
      state.recalled = autoRecallPrompt(state.bot, state.threadId, state.resolvedImages.text, {
        // a routine run starts fresh by design, and a webhook is untrusted:
        // neither pulls earlier conversations in. A call turn takes a
        // couple of notes, never other conversations: what the engine
        // reads before it can answer is the pause the person hears.
        conversations: state.commsDepth === 0 && !coordinationNode && !state.opts?.automationSource && !state.opts?.unattended && !state.onCall,
        userName: botUserName(state.bot),
        ...(state.onCall ? { budget: CALL_RECALL_BUDGET } : state.compactPrompt ? { budget: LOCAL_RECALL_BUDGET } : {})
      });
      runningTurnEngines.set(state.threadId, state.instance);
      if (!state.warmOnly) limitFailover.noteDispatch(state.threadId, {
        botId: state.bot.id, engine: { instanceId: state.instance.instanceId, driverKind: state.instance.driverKind }, selection: state.bot.modelSelection,
        payer: autoPayerKey(state.bot, state.speaker), ...(ownerPaysForMember(state.bot, state.speaker, state.opts?.trigger?.kind === "user" ? state.opts.trigger.principalId : state.opts?.sender?.id) ? { owner: true } : {}), speaker: state.speaker, ...(state.opts?.trigger ? { trigger: state.opts.trigger } : {}), at: Date.now(),
        ...(isLocalModelId(state.bot.modelSelection.model) ? { local: true } : {})
      });
      idleEngines.noteBusy(state.threadId);
      // The prompt carries the soul as saved now. If it changed during setup,
      // decide again from what is actually sent — except on a continuation
      // wake inside an automation run, where a delegated result is reviving
      // its source unattended. That turn runs
      // as the resume it planned (the new soul reaches the session through
      // system-prompt refresh), so its record keeps the config of the session
      // it resumed. The next dispatch then sees that stored config differ
      // from the soul saved now and gives the source the fresh session and
      // replay a soul change owes it. Re-deciding here instead would start a
      // new session whose record already carries the new soul, and the
      // following wake would resume it — a session started under the old soul
      // must never survive a soul change by laundering its record. A
      // person-facing delegated return still re-decides here: that turn is
      // the one the person watches.
      const dispatchedConfig = sessionConfig(liveBot?.soul ?? state.bot.soul);
      if (state.strictResume && !state.voiceView && !(state.opts?.cardContinuation && state.continuingRoutine) && dispatchedConfig !== state.plannedConfig) state.dispatchContext = decideContext(dispatchedConfig);
      // Before sendTurn: an adapter may emit the whole turn before it resolves.
      if (!state.warmOnly) handoffs.dispatching(state.threadId, state.dispatchClaimId, state.dispatchContext.handoff);
      // Read receipts (server/read-receipts.ts): the person's words this turn
      // carries are what the bot has now seen. A card continuation carries
      // none of its own: it sees the conversation it resumes.
      if (!state.warmOnly) {
        const carriedIds = [state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])];
        const textIds = new Set(activeMessages.filter((m: any) => m.kind === "text" && !m.roomRequest).map((m: any) => m.id));
        noteBotRead(state.bot.id, state.threadId, carriedIds.some((id) => textIds.has(id)) ? carriedIds : state.contextOrder.filter((id: any) => textIds.has(id)));
      }
      // Slice 4: this turn's credentials (an owner key is read now).
      // (solo mode takes no extra await: its dispatch timing is unchanged)
      const turnAccess = IDENTITY.kind === "perspicax" ? await orgTurnAccess(state.threadId, state.bot, state.instance, state.speaker, state.bot.modelSelection.model) : undefined;
      if (!state.warmOnly) turnTrace(state.threadId, "access");
      // An engine slash command typed by a person (or set in a routine)
      // reaches the engine verbatim (server/harness-commands.ts); a peer hop
      // or a card continuation never runs one.
      const typedCommand = !state.opts?.cardContinuation && state.commsDepth === 0
        ? await typedCommandForTurn(state.resolvedImages.text, harnessCommandSource(state.bot, state.threadId, {
          scope: {
            botId: state.bot.id,
            ...(state.cwd ? { cwd: state.cwd } : {}),
            ...(withholdHostToolsFor(state.instance) ? { withholdHostTools: true } : {}),
            mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp()
          },
          speaker: state.speaker,
          ...(turnAccess ? { access: turnAccess } : {})
        }), harnessCommands)
        : { kind: "none" as const };
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) throw new DirectTurnSetupCancelled("turn stopped during command lookup");
      if (!state.warmOnly) turnTrace(state.threadId, "command");
      const engineCommand = typedCommand.kind === "engine" ? typedCommand : null;
      // With no session to resume, the command runs in a new one that never
      // saw the conversation: the next turn must still rebuild it, so the
      // bookkeeping that would mark the context delivered is left for it.
      state.contextStillPending = Boolean(engineCommand && state.dispatchContext.sessionReset && state.transcript.length > 0 &&
        !replaysNatively(state.instance.driverKind));
      if (!state.warmOnly) voiceLatency.mark(state.threadId, "dispatch", state.voiceView ? { run: {
        model: state.voiceTurnPick?.modelLabel ?? String(state.model ?? ""),
        contextBytes: Buffer.byteLength(state.dispatchContext.turnText),
        session: voiceBriefed ? "new" : "resumed"
      } } : undefined);
      // A call turn (and the warm that prepares its process, so the two share
      // one spawn contract) runs at the engine's low effort: the person is
      // waiting for the first word (server/voice-call-effort.ts).
      // A pre-warm off a call (server/thread-prewarm.ts) takes the next
      // turn's own effort and flags, or the turn would relaunch it.
      const turnEffort = state.onCall
        ? callTurnEffort({ driverKind: state.instance.driverKind, levels: state.instance.adapter.capabilities.effortLevels, effort: state.effort })
        : resolveEngineTurnEffort(state.effort, state.instance.driverKind, state.instance.adapter.capabilities.effortLevels);
      // A routine run while the server boots waits for an engine start slot
      // (server/engine-start-gate.ts): the runs that came due during a
      // restart start two at a time instead of every engine at once.
      // After boot, routine turns keep a steady limit (SAGAX_ROUTINE_ENGINE_SLOTS)
      // and wait while memory is critical (server/engine-memory-guard.ts).
      // A card continuation of a routine is not held by the steady gate: it
      // may be the peer a slot holder waits on (no deadlock).
      if (state.opts?.automationSource && !state.warmOnly && !state.onCall && (engineStartGate.booting || !state.opts?.cardContinuation)) {
        await holdBootEngineSlot(state.threadId, `${state.bot.name} (${state.instance.driverKind})`, state.instance);
        turnTrace(state.threadId, "engine-slot");
        if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) throw new DirectTurnSetupCancelled("turn stopped while waiting for an engine slot");
      }
      if (!state.warmOnly && typeof state.userMessage.at === "number") noteTurnQueued(state.threadId, state.userMessage.at);
      if (!state.warmOnly) turnTrace(state.threadId, "send");
      // Each picture within the model's limits: a scaled copy for a large one.
      const modelImages = await fitTurnImagesForModel(state.turnImages, { language: languageOfPerson(state.turnPlace.principal) });
      // #1137: when the owner pays, the owner's computer serves its model.
      const deskPerson = desktopModelPersonFor(state.bot, state.instance, state.speaker, state.turnPlace.principal);
      state.dispatch = await guardTurnDispatch(withDesktopModelPerson(deskPerson, () => runAsBotEngine(state.bot.id, () => {
        if (IDENTITY.kind === "perspicax") desktopLocalModels.assertAvailable(deskPerson, state.model, state.instance.driverKind);
        const replayRequest = state.personLine && !state.opts?.unattended && !state.guestConfined
          ? { botId: state.bot.id, message: state.userMessage, turnText: state.text, placePicked: state.wants === "local" && state.placeSource !== "auto-pin" }
          : null;
        return savedSteps.dispatch.sendTurn(state.instance, replayRequest, {
        threadId: state.threadId,
        botId: state.bot.id,
        ...(state.compactPrompt ? { compactPrompt: state.compactPrompt } : {}),
        // the per-turn latency line's queue stage (drivers/acp/turn-latency.ts)
        ...(!state.warmOnly && typeof state.userMessage.at === "number" ? { receivedAt: state.userMessage.at } : {}),
        ...(turnAccess ? { access: turnAccess } : {}),
        // on a live call the engine process stays warm from turn to turn.
        // A warm uses the same flag so the first spoken turn's contract matches.
        ...(state.onCall ? { keepWarm: true } : {}),
        ...(state.warmOnly ? { warmOnly: true, ...(state.onCall ? { cachePrime: true } : {}), ...(state.opts?.warmSignal ? { warmSignal: state.opts.warmSignal } : {}) } : {}),
        startupRecovery: !state.warmOnly &&
          (state.opts?.automaticRecoveryIndex ?? 0) < botRecoveryBackups(liveBot ?? state.bot, cfg).length,
        text: state.warmOnly ? "" : (engineCommand ? engineCommand.engineText : withRecalled(state.recalled, state.dispatchContext.turnText)),
        ...(engineCommand ? { harnessCommand: { name: engineCommand.command.name, args: engineCommand.args, ...(engineCommand.command.path ? { path: engineCommand.command.path } : {}) } } : {}),
        ...(state.recalled && !state.warmOnly && !engineCommand ? { recalled: state.recalled } : {}),
        images: modelImages,
        approvalMode: engineTurnLevel(state.bot, state.threadId, auditFullAccessTurn(state.bot, state.threadId, approvalModeForTurn(state.bot, state.commsDepth > 0, state.threadId))),
        toolScope: state.toolScope,
        ...(state.guestConfined ? { guestConfined: true, confinedWhy: confinedWhy(state.threadId) } : {}),
        model: state.model,
        effort: turnEffort,
        variant: state.variant,
        // a rewound thread never resumes the abandoned branch's session
        // the active task's own session — another task's cursor would
        // resume the wrong conversation and defeat the context bubble
        resumeCursor: state.dispatchContext.resumeCursor,
        sessionReset: state.dispatchContext.sessionReset,
        ...(state.dispatchContext.recoveryText !== undefined && !engineCommand ? { recoveryText: state.dispatchContext.recoveryText } : {}),
        transcript: state.voiceView ? state.voiceView.transcript : state.transcript,
        // #1276: a compact prompt sends the stable half first and what differs
        // between conversations last, for an engine that takes the prompt
        // whole (pi without a session); same sections, nothing dropped.
        system: state.compactPrompt ? prompt.stable + prompt.volatile : prompt.text,
        systemStable: prompt.stable,
        systemVolatile: prompt.volatile,
        systemVolatileSections: prompt.volatileSections,
        // the mentions half describes this turn: identical consecutive tags
        // must still deliver their note (SendTurnInput.mentionTurn)
        // and so does an interrupted call turn's marker
        mentionTurn: tagged.length > 0 || Boolean(state.userMessage.voiceCall?.interrupted),
        integrations: state.integrations,
        ...(withholdHostToolsFor(state.instance) ? { withholdHostTools: true } : {}),
        ...turnCommandEnvironment(state.instance, state.bot.id, state.threadId),
        toolErrorCorrectiveRounds: toolErrorCorrectiveRoundsFor(cfg, process.env, { botEnabled: state.bot.loopGuard }),
        // Auto may leave their computer mid-turn: the engine's own traffic
        // goes through it only when the Workspace is fixed there.
        ...(() => { const networkProxy = state.turnAuto?.auto ? undefined : turnNetworkProxy(state.threadId, state.bot.id, state.turnPlace); return networkProxy ? { networkProxy } : {}; })(),
        ...(state.integrations.browser && browserIsThePlace(state.plan) ? { preloadBrowserTools: true } : {}),
        mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp(),
        claudeAiConnectors: claudeAiConnectorsFor(state.bot, state.instance, state.speaker, turnAccess?.via),
        grokCloudConnectors: grokCloudConnectorsForTurn(accountConnectorInput(state.bot, state.instance, state.speaker, turnAccess?.via)),
        ...pluginDirsFor(state.bot, state.instance, orgSpeakerPrincipal(state.bot, state.speaker)),
        mcpCallTimeoutMs: mcpCallTimeoutMinutes(cfg) * 60_000,
        cwd: state.cwd
      }, (input: any) => state.instance.adapter.sendTurn(input));
      })), () => !directTurnClaimExists(state.bot.id, state.dispatchClaimId, state.threadId), async () => {
        await state.instance.adapter.interruptTurn(state.threadId).catch(() => {});
      });
      if (state.warmOnly) {
        // A duplex interrupt while the person is still talking cancels this
        // claim: there is no spoken turn yet, and releasing the process
        // would make the first words pay a cold start. Hangup aborts the
        // signal and is the path that closes it. The interrupt also
        // quarantines this handshake for 30s; the warm has no provider
        // turn id to retire, so leaving the mark would hold the first
        // utterance until it expired.
        clearCancelledProviderHandshake(state.threadId, `direct:${state.dispatchClaimId}`);
        if (state.opts?.warmSignal?.aborted) state.instance.adapter.releaseWarmSession?.(state.threadId);
        else {
          state.warmOk = true;
          // The HTTP pool is already warm from GET /models. One 1-token
          // completion on the opener's model opens the chat path and, when
          // the prompt is long enough for the provider, writes the prefix.
          // Not awaited: the call's first turn does not wait on it.
          if (state.instance.driverKind === "grok" && state.instance.generateText) {
            const fast = pickFastSentenceModel(state.instance.models.options.map((option: any) => option.id));
            if (fast) {
              void state.instance.generateText(".", {
                system: VOICE_FIRST_SENTENCE_SYSTEM,
                model: fast,
                maxTokens: 1
              }).catch(() => undefined);
            }
          }
        }
        return;
      }

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
    } catch (cause: any) {
      await finishCatch(state, cause);
    } finally {
      await finishFinally(state);
    }
  })();
  return state.userMessage;
};

  return startTurn;
}
