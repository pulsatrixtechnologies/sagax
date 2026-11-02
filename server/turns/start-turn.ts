// #1388 wave 4 step 3: startTurn runtime (leaf phase modules re-exported).
// Never imports server/index.ts.
import { createHash, randomUUID } from "node:crypto";
import type { ConnectorSwitch } from "../connector-switch.ts";
import type { ComputerWant, PlaceSource } from "../surface.ts";
import type { LocalVmTarget, Runtime } from "../container-computer.ts";
import { recoveryCapabilityError } from "../automatic-recovery.ts";
import type { StartTurnHost } from "./start-turn-types.ts";

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
    EngineAccessLost,
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
    TurnAuthenticationRefusedError,
    TurnNotStartedError,
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
    checkedTaskModelSwitch,
    checkpoints,
    chiefOfStaffSystemPrompt,
    claimTurnResource,
    claudeAiConnectorsFor,
    claudeUserMcpEnabled,
    clearCancelledProviderHandshake,
    clearDirectTurnDispatch,
    clearFailedAutoPin,
    clearInternalTurn,
    clearTurnDigestState,
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
    endMemoryTurn,
    engineAccessNotice,
    engineConnectorsPromptFor,
    engineDisplayName,
    engineHasNativeWebSearch,
    engineIsFresh,
    engineReference,
    engineStartGate,
    engineTurnLevel,
    enginesRead,
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
    hasQueuedSteeredMessages,
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
    isModelRefusal,
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
    nextInChain,
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
    releasePlain,
    releaseTurnComputer,
    releaseTurnResources,
    rememberAutoRefusal,
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
    subscriptionExpiredCard,
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
    turnAccessByThread,
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
  void _activeVpsThreads; void _bus; void _localVmTargetForBot; void _reachable; void _sessions; void _turnOrigin; void _wants; void _webhooks; void _releaseBootEngineSlot;

  const startTurn = async function startTurn(
    botId: string,
    text: string,
    opts?: any,
  ) {

    let agentsMounted: any; let answer: any; let autoBaseSelection: any; let autoTurn: any; let backupRefused: any; let bot: any; let boundedCoordination: any; let card: any; let commsDepth: any; let computerSkipped: any; let continuingRoutine: any; let coordinated: any; let dispatchClaimId: any; let effort: any; let engine: any; let guestConfined: any; let instance: any; let instanceId: any; let levels: any; let line: any; let maySelectComputer: any; let model: any; let notice: any; let onCall: any; let onDispatchError: any; let payer: any; let peerHop: any; let peerToolsMounted: any; let person: any; let personLine: any; let placedText: any; let plan: any; let profile: any; let providerText: any; let recoveryUserMessageId: any; let requestMessageId: any; let resolvedImages: any; let resourceOwner: any; let selection: any; let source: any; let speaker: any; let spoken: any; let task: any; let threadId: any; let toolScope: any; let trigger: any; let turnAuto: any; let turnImages: any; let turnPlace: any; let turnPrincipal: any; let userMessage: any; let variant: any; let voiceCallText: any; let voiceCallTurn: any; let voiceTurnPick: any; let warmOnly: any;
  workspaceMaintenance.assertAvailable();
  profile = store.bot(botId);
  if (!profile) throw Object.assign(new Error("no such bot"), { status: 404 });
  // No named thread: never a confidential one (peerThreadFor).
  threadId = opts?.threadId ?? peerThreadFor(profile);
  continuingRoutine = opts?.cardContinuation ? activeRoutineRunForThread(threadId) : null;
  if (continuingRoutine) {
    onDispatchError = opts?.onDispatchError;
    opts = {
      ...opts,
      runOn: continuingRoutine.runOn,
      automationSource: continuingRoutine.triggerSource ?? (continuingRoutine.manual ? "manual" : "schedule"),
      // Slice 6: the routine still speaks as the person it runs as.
      speaker: routineRunSpeaker(continuingRoutine),
      onDispatchError: (message: any) => {
        routines?.failThread(threadId, message);
        onDispatchError?.(message);
      }
    };
  }
  // A thread whose own model can't run runs on its bot's from now on.
  healThreadModel(botId, threadId);
  // Organization server: the same, for a thread's own model that this
  // turn's payer has no credentials for here (a model picked on a desktop,
  // such as a local model on pi) while the bot's own model can run.
  if (IDENTITY.kind === "perspicax") {
    healOrgRefusedThreadModel(botId, threadId, resolveTurnSpeaker({
      speaker: opts?.speaker,
      sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
      peerAsk: opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk),
      trigger: opts?.trigger,
      automationSource: opts?.automationSource
    }));
  }
  // A usage limit (server/limit-failover-host.ts): back on the thread's own
  // engine once it reset, or onto a backup while it is known to refuse.
  // Never for a warm-up or a card's continuation of a running turn.
  if (!opts?.warmOnly && !opts?.cardContinuation) {
    const switching = limitFailover.beforeTurn(botId, threadId, resolveTurnSpeaker({
      speaker: opts?.speaker,
      sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
      peerAsk: opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk),
      trigger: opts?.trigger,
      automationSource: opts?.automationSource
    }));
    if (switching) await switching;
  }
  bot = store.projectBotForTask(botId, threadId);
  if (!bot) throw Object.assign(new Error("no such task"), { status: 404 });
  // A bot pinned to a computer never starts on this server, including a 1:1.
  // The desktop pulls the turn and runs it with the engines on that machine.
  if (!opts?.warmOnly && directMachinePlan({ host: bot.host, workers: registeredWorkers }).kind === "hold") {
    return holdDirectMachineTurn(bot, threadId, text, opts);
  }
  // A person who does not own this bot runs on their own model and effort
  // when they set one. The stored bot and the thread stay the owner's.
  if (IDENTITY.kind === "perspicax") {
    const earlySpeaker = resolveTurnSpeaker({
      speaker: opts?.speaker,
      sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
      peerAsk: opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk),
      trigger: opts?.trigger,
      automationSource: opts?.automationSource
    });
    person = earlySpeaker.origin === "person" ? earlySpeaker.principalId?.trim().toLowerCase() : "";
    // #1137: when the owner pays, the bot answers on the owner's model, not
    // on a model of the viewer's own.
    const ownerPays = speakerPayerMode(bot, earlySpeaker) === "owner";
    if (person && !ownerPays && sharedBotForViewer(recordedBotOwner(bot), person)) {
      selection = applyViewerModelOverride(
        bot.modelSelection,
        viewerBotOverrideStore.getOne(person, bot.id),
        (level: any, instanceId: any) => {
          levels = registry.get(instanceId)?.adapter.capabilities.effortLevels;
          return Array.isArray(levels) && effortAcceptedByEngine(level, levels);
        },
      );
      if (selection !== bot.modelSelection) bot = { ...bot, modelSelection: selection };
    }
    // #1137, #1154: the bot's model cannot run for the person who pays (no
    // credentials of theirs for its engine, or their session does not offer
    // it), so it answers with a model they can run, for this turn only.
    if (!opts?.warmOnly && !opts?.cardContinuation) warmPayerAccountModels(bot, earlySpeaker);
    const switched = speakerTurnSelection(bot, earlySpeaker);
    if (switched && !opts?.warmOnly) {
      bot = { ...bot, modelSelection: switched.selection };
      turnModelSwitches.set(threadId, { botId: bot.id, requested: switched.requested, actual: switched.selection, ...(person ? { principalId: person } : {}) });
      turnModelRequested.set(threadId, switched.requested);
    } else if (switched) {
      bot = { ...bot, modelSelection: switched.selection };
    } else {
      turnModelSwitches.delete(threadId);
      turnModelRequested.delete(threadId);
    }
  }
  // Auto (docs/plans/2026-10-08-auto-model.md): this turn's model. A
  // person's turn runs on the orchestration model; work a bot handed out
  // (a peer hop, a routine, a parallel task it opened) on the model its
  // class of work calls for; a continuation keeps the thread's last pick.
  // The stored bot and thread keep Auto and their base model.
  autoTurn = null;
  let autoContinuing = false;
  /** The thread's own selection (Auto and its base) before the pick replaced it. */
  autoBaseSelection = bot.modelSelection;
  if (bot.modelSelection.auto === true) {
    const autoPeerAsk = opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk);
    const autoSpeaker = resolveTurnSpeaker({
      speaker: opts?.speaker,
      sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
      peerAsk: autoPeerAsk,
      trigger: opts?.trigger,
      automationSource: opts?.automationSource
    });
    // A fresh coordinate_bots hop rides a card continuation but is new work.
    const freshAutoHop = Boolean(opts?.coordination && !opts.coordination.resumed);
    autoContinuing = !freshAutoHop && Boolean(opts?.cardContinuation || opts?.computerSelectionContinuation || opts?.compactOnly || opts?.warmOnly);
    const worker = Boolean(autoPeerAsk) || (opts?.commsDepth ?? 0) > 0 || opts?.automationSource !== undefined || opts?.autoWorker === true;
    autoTurn = autoPickForTurn({
      bot, threadId, speaker: autoSpeaker, text,
      role: autoContinuing && !opts?.autoSkip?.length ? "continue" : worker ? "worker" : "orchestration",
      fallback: worker ? "worker" : "orchestration",
      // A guest's turn on a Cloud home only goes to an engine that confines it.
      guestConfined: cloudGuestDriven(threadId) || cloudGuestDrivenHandoff(opts?.coordination?.id) || botmailConfined(threadId),
      ...(opts?.autoSkip ? { skip: opts.autoSkip } : {})
    });
    // Recorded on the task once the turn is admitted (below), never before.
    if (autoTurn) bot = { ...bot, modelSelection: autoTurn.pick.selection };
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
  let connectorSwitch: ConnectorSwitch | null = null;
  const personText = opts?.userMessage
    ? (opts.userMessage.role === "user" && opts.userMessage.kind === "text" ? opts.userMessage.text ?? "" : "")
    : text;
  if (!autoTurn && !opts?.warmOnly && !opts?.cardContinuation && !opts?.computerSelectionContinuation && !opts?.compactOnly && personText) {
    const switchSpeaker = resolveTurnSpeaker({
      speaker: opts?.speaker,
      sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
      peerAsk: opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk),
      trigger: opts?.trigger,
      automationSource: opts?.automationSource
    });
    const personsRequest = (switchSpeaker.origin === "person" || switchSpeaker.origin === "operator")
      && !opts?.automationSource && !opts?.peerAsk && !opts?.userMessage?.peerAsk && !(opts?.commsDepth ?? 0) && !opts?.coordination;
    connectorSwitch = personsRequest ? connectorSwitchForTurn(bot, threadId, switchSpeaker, personText) : null;
    if (connectorSwitch) {
      bot = { ...bot, modelSelection: { instanceId: connectorSwitch.instanceId, model: connectorSwitch.model, ...(connectorSwitch.effort ? { effort: connectorSwitch.effort } : {}), ...(connectorSwitch.account ? { account: connectorSwitch.account } : {}) } };
    }
  }
  // A turn said on a live call, and the warm that prepares its process, run
  // on a fast model (server/voice-turn.ts): the person waits in silence for
  // the first word. Pinned or Auto alike; a request that needed another
  // engine's connector keeps it. Heavy work is handed to a parallel task on
  // the bot's main model by the call turn itself.
  voiceTurnPick= null;
  /** The turn runs in the call's own session, from a short view of the
   * conversation (server/voice-turn.ts), not in the conversation's session. */
  voiceCallTurn = false;
  if (!connectorSwitch && voiceCalls.active(threadId) && !opts?.commsDepth && !opts?.coordination && !opts?.automationSource
    && !opts?.compactOnly && !opts?.unattended && !(opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk))) {
    const voiceSpeaker = resolveTurnSpeaker({
      speaker: opts?.speaker,
      sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
      trigger: opts?.trigger,
      automationSource: opts?.automationSource
    });
    voiceCallTurn = true;
    voiceTurnPick = voicePickForTurn(bot, autoBaseSelection, voiceSpeaker,
      cloudGuestDriven(threadId) || cloudGuestDrivenHandoff(opts?.coordination?.id) || botmailConfined(threadId));
    if (voiceTurnPick) {
      bot = { ...bot, modelSelection: voiceTurnPick.selection };
      autoTurn = null;
    }
  } else if (!voiceCalls.active(threadId) && voiceSessions.has(threadId)) {
    // the call expired without a hang-up: its session is gone with it
    voiceSessions.end(threadId);
  }
  // 2026-10-30: a proactive wake runs on the fast model when there is one,
  // the same pick as a call turn (#1694): most wakes are a quick look.
  // Auto keeps its own pick; a request that needed a connector keeps it.
  // Wakes use triggerSource "proactive"; legacy rows may still be webhook+proactive.
  const proactiveWake =
    opts?.automationSource === "proactive" ||
    (opts?.automationSource === "webhook" && activeRoutineRunForThread(threadId)?.proactive);
  if (!voiceTurnPick && !autoTurn && !connectorSwitch && !opts?.warmOnly && proactiveWake) {
    const wakePick = voicePickForTurn(bot, autoBaseSelection, resolveTurnSpeaker({ speaker: opts?.speaker, automationSource: opts?.automationSource }), botmailConfined(threadId));
    if (wakePick) bot = { ...bot, modelSelection: wakePick.selection };
  }
  // Routines and legacy peer delivery already have their own completion
  // owners. Only ordinary chats opt into this scheduler; its child turns
  // carry an exact node id rather than inheriting a routine's lifetime.
  // A teammate's warm is shaped as the coordinate_bots turn it precedes.
  coordinated = Boolean(opts?.coordination) || (opts?.warmOnly === true && opts.warmCoordination === true);
  // Lot 3 (docs/runtime-contract.md §9 step 2): a routine or webhook run's
  // own conversation hands work out on the job runtime too, like a chat;
  // its run waits on that work (hasPendingDelegations) and the resume turn,
  // on the same thread, completes it. A room goal keeps its orchestrator.
  const routineRun = opts?.automationSource ? activeRoutineRunForThread(threadId) : null;
  const routineRunThread = Boolean(routineRun && routineRun.target !== "room-goal");
  boundedCoordination = (!opts?.automationSource || routineRunThread) && (!opts?.commsDepth || coordinated);
  if (bot.approvalGrant) {
    throw Object.assign(new Error("this bot's approval level is still being confirmed — try again"), { status: 409, code: "settling" });
  }
  // A turn answering a Team incidents report needs no computer: one it
  // cannot have right now — mid-change here, unpaid or missing at dispatch —
  // leaves it without one (computerSkipped, and the prompt says why) where
  // any other turn is refused. Deciding what a report needs never waits on
  // a screen; a report refused for it was a report lost.
  answer = turnAnswers(threadId, opts);
  computerSkipped = undefined;
  const transitionError = providerTransitionForTurn(bot, opts?.runOn, threadId);
  if (transitionError && !answer.incident) throw Object.assign(new Error(transitionError), { status: 409 });
  if (transitionError) computerSkipped = transitionError;
  // Only a turn on an engine being replaced waits; the others run on.
  if (providerInstancesChanging.has(bot.modelSelection.instanceId)) {
    throw Object.assign(new Error("this provider account is being updated — try again shortly"), { status: 409, code: "settling" });
  }
  // A workspace at its monthly spend limit starts no turn of any kind: a
  // person's message, a routine, a peer hop or a webhook all stop here.
  assertWithinBudget(cfg, DATA_DIR);
  if (boatLifecycleBusyBots.has(botId)) {
    const changing = "this bot's cloud computer is being changed — wait for it to finish";
    if (!answer.incident) throw Object.assign(new Error(changing), { status: 409, code: "settling" });
    computerSkipped ??= changing;
  }
  warmOnly = opts?.warmOnly === true;
  if (!warmOnly) turnTrace(threadId, opts?.automationSource ? `start:${opts.automationSource}` : opts?.cardContinuation ? "start:continuation" : "start", !opts?.automationSource);
  // The engine for a live call is already starting. This turn waits for it
  // and reuses the process. The warm itself must not wait.
  if (!warmOnly && voiceCalls.active(threadId)) await voiceWarmup.join(threadId);
  // A pre-warm (opened conversation, composer, routine) still starting: this
  // turn waits for it and takes its process over.
  if (!warmOnly && threadPrewarm.has(threadId)) await joinPrewarm(threadId);
  if (!warmOnly) turnTrace(threadId, "prewarm-joined");
  assertTurnAdmission(botId, threadId);
  // Steering is never a cancel. A message sent while teammates are working
  // runs now, with their assignments still attached: they keep running and
  // their results still return here (outstandingAssignmentsPrompt tells this
  // turn which are still out). Stop, in this conversation, is the gesture
  // that ends coordination — see interruptDirectThread.
  // Revoke anything a previous turn left behind before minting this turn's
  // integrations. Completion and interrupt paths do the same; a proxy the
  // warm engine kept is honoured again only through this turn's records.
  revokeEarlierTurnCapabilities(threadId);
  // a webhook turn, or one inherited from a bot already running unattended
  if (opts?.automationSource === "webhook" || opts?.unattended) markUnattended(bot.id, threadId);
  // a person typing into this bot ends the unattended window immediately
  else if (opts?.automationSource === undefined && !opts?.commsDepth && !opts?.cardContinuation && !warmOnly) {
    clearUnattended(threadId);
    delegationWakeBudget.reset(threadId);
  }
  task = store.taskByThread(bot.id, threadId);
  if (!task) throw Object.assign(new Error("no such task"), { status: 404 });
  if (hostedModels && !hostedModels.allows(bot.modelSelection)) throw Object.assign(new Error(hostedModels.error()), { status: 409 });
  // A fresh request decides where to work again: a select_computer move
  // held only the request it was made in.
  if (!opts?.computerSelectionContinuation && !opts?.compactOnly && !warmOnly && (!opts?.cardContinuation || Boolean(opts?.coordination && !opts.coordination.resumed))) {
    computerSelectionMoves.delete(threadId);
  }
  plan = turnSurfacePlan(bot, opts?.runOn, threadId);
  if (!namesEngine(bot.modelSelection)) {
    // No engine at all: the default one, or a plain sentence, never `provider instance ""`.
    const healed = healBotEngine(bot);
    if (!namesEngine(healed.modelSelection)) throw noEngineError();
    bot = healed;
  }
  instance = registry.get(bot.modelSelection.instanceId);
  if (!instance) {
    // Still on the removed Computer engine: its move failed or found no
    // engine. Try it again now, so the next message runs on the new engine.
    if (removedComputerInstanceIds(cfg.instances).has(bot.modelSelection.instanceId)) void retryComputerEngineMove();
    throw Object.assign(
      new Error(`${engineReference(bot.modelSelection.instanceId)} is unavailable — pick another model in settings`),
      { status: 409 },
    );
  }
  const policyRefusal = policyModelRefusal(instance);
  if (policyRefusal) throw Object.assign(new Error(policyRefusal), { status: 409, code: "managed_policy" });
  // #1098: outside the organization's list, the turn runs only on its
  // payer's own subscription or key
  const orgRefusal = orgEngineTurnRefusal(bot, instance, resolveTurnSpeaker({
    speaker: opts?.speaker,
    sender: opts?.sender ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.sender),
    peerAsk: opts?.peerAsk ?? (opts?.editedMessageId ? undefined : opts?.userMessage?.peerAsk),
    trigger: opts?.trigger,
    automationSource: opts?.automationSource
  }));
  if (orgRefusal) throw Object.assign(new Error(orgRefusal), { status: 409, code: "engine_not_allowed" });
  // 2026-10-30 (lot 2): a model turned off never runs a turn by name
  const modelRefusal = bot.modelSelection.auto === true ? undefined : modelSwitchRefusal(instance.instanceId, bot.modelSelection.model, effectiveBotOwner(bot));
  if (modelRefusal) throw Object.assign(new Error(modelRefusal), { status: 409, code: "model_turned_off" });
  toolScope = toolScopeForTurn(bot.id);
  // On a Cloud home a guest's turn never gets a shell or reads outside its
  // own folder (docs/cloud-pro.md): an engine that cannot run it that way is
  // refused, in one plain line, before anything is recorded.
  // (The thread is idle here: a mark a turn that never started left is stale.)
  guestDrivenTurns.delete(threadId);
  // A mail-woken routine run (bot email, S2) is confined the same way: no
  // shell, no reads outside its folder.
  const mailConfined = botmailConfined(threadId);
  guestConfined = cloudGuestDriven(threadId) || cloudGuestDrivenHandoff(opts?.coordination?.id) || mailConfined;
  if (guestConfined && instance.adapter.capabilities.guestTurns !== "confined") {
    if (mailConfined && !cloudGuestDriven(threadId)) throw Object.assign(new Error(BOTMAIL_ENGINE_REFUSAL), { status: 409, code: "botmail_engine" });
    throw Object.assign(new Error(guestEngineRefusal(threadId)), { status: 409, code: "guest_engine" });
  }
  // Codex and the API drivers cannot start without a prompt. Sending them
  // an empty one would bill a turn and show it. Claude is the engine that
  // can hold a process with stdin open and no model call.
  if (warmOnly && instance.adapter.capabilities.warmSession !== true) {
    console.error(`[voice-call] warm skipped: ${instance.driverKind}`);
    opts?.onWarmSettled?.(false);
    return {
      id: `warm-${randomUUID()}`,
      at: Date.now(),
      role: "user" as const,
      kind: "text" as const,
      text: "",
      ...(opts?.voiceCall ? { voiceCall: opts.voiceCall } : {})
    };
  }
  // Resolve only transport tags from this newly submitted text. The original
  // string remains the durable message. Native-image providers get a
  // path-free prompt and bounded inputs instead of needing a Read tool;
  // path-reading drivers retain the attachment tag as their compatibility route.
  resolvedImages = extractTurnImages(text);
  // Files sealed at rest go plain in place for the engine (server/content-at-rest.ts):
  // this message's attachments before anything reads them; the bot's memory
  // files in parallel with the rest of the setup, awaited before the engine
  // starts (below).
  if (!warmOnly && supportsWorkspaceFiles(instance.driverKind)) void holdBotMemoryPlain(bot.id, turnHolder(threadId));
  const attachmentsHold = warmOnly ? undefined : holdTurnAttachments(threadId, [text], resolvedImages.images, { picturesByPath: instance.driverKind === "codex" });
  if (attachmentsHold) {
    await attachmentsHold;
    // The wait yielded: another start may have taken this slot since the
    // checks above. From here to the dispatch claim nothing yields again.
    assertTurnAdmission(botId, threadId);
  }
  const usesNativeImageInput = instance.adapter.capabilities.nativeImageInput === true;
  providerText = promptWithDataContext(usesNativeImageInput ? resolvedImages.text : text, opts?.dataContext);
  turnImages = usesNativeImageInput ? resolvedImages.images : [];
  commsDepth = opts?.commsDepth ?? 0;
  // Classify the turn where the peer paths' depth actually arrives: by the
  // time it settles, the fold has only a thread id to go on.
  if (commsDepth > 0) markInternalTurn(threadId);
  else clearInternalTurn(threadId);
  if (answer.quiet) quietTurnThreads.add(threadId);
  else quietTurnThreads.delete(threadId);
  // a task takes its name from the first thing you asked it to do
  if (!warmOnly && resolvedImages.text.trim() && !opts?.cardContinuation) {
    const titled = store.titleTaskFromFirstMessage(bot.id, resolvedImages.text, threadId);
    // The snippet is only the fallback name. A cheap one-shot may trade it
    // for a title a person would have typed, but never on a peer-opened
    // row: its title belongs to the assigned work. Everywhere else, the
    // swap happens only while the row still carries the snippet — a rename
    // by a person has already broken that equality by then.
    const snippet = titled?.title;
    if (titled && snippet && !titled.openedBy?.botId && personalFeatureOn("llmThreadTitles", llmThreadTitlesEnabled(cfg), vaultPrincipalForThread(threadId)) && instance.generateText) {
      void generateThreadTitle(instance, resolvedImages.text)
        .then((title: any) => {
          if (title) store.retitleTask(bot.id, threadId, snippet, title);
        })
        .catch(() => undefined);
    }
  }

  // Spoken words never reach the log. A direct send says so itself; a
  // drained queue (or a continuation) carries it on the user lines it runs.
  const turnLineIds = new Set(opts?.excludeMessageIds ?? []);
  spoken = opts?.via === "call" || opts?.userMessage?.via === "call" ||
    (turnLineIds.size > 0 && store.messagesFor(threadId).some((message: any) => turnLineIds.has(message.id) && message.via === "call"));
  if (warmOnly) console.error(`[voice-call] warming thread ${threadId}`);
  else console.error(turnStartLogLine({
    botId, text: resolvedImages.text, images: turnImages.length, depth: commsDepth, card: Boolean(opts?.cardContinuation), spoken,
    confidential: store.isConfidentialThread(threadId)
  }));
  instanceId = instance.instanceId;
  // A turn always runs on the bot's own engine, model, effort and variant,
  // wherever it works: a cloud computer is a tool it mounts, never a reason
  // to swap the engine (the provider_not_configured incident).
  model = bot.modelSelection.model;
  const askedEffort = bot.modelSelection.effort;
  variant = bot.modelSelection.variant;
  // What this turn runs on, kept for the bot text it writes (a quiet line
  // under the reply shows it). A warm-up writes no reply.
  if (!warmOnly) turnRunByThread.set(threadId, turnRunFor(bot.modelSelection, turnModelRequested.get(threadId)));
  assertModelVariantSupported({ variant, effort: askedEffort }, instance.adapter.capabilities);
  // A selection can be persisted while its engine is offline. Re-check when
  // the engine returns so an old or unsupported value never reaches a CLI.
  if (askedEffort && !effortAcceptedByEngine(askedEffort, instance.adapter.capabilities.effortLevels ?? [])) {
    throw Object.assign(
      new Error(`effort "${askedEffort}" is not offered by this bot's engine — choose another level in settings`),
      { status: 409 },
    );
  }
  // The engine takes it but this model may not (shared/model-capabilities.ts):
  // then nothing is sent and the model runs at its own default.
  effort = effortForModel(askedEffort, instance.models.options.find((option: any) => option.id === bot.modelSelection.model),
    instance.adapter.capabilities.effortLevels);

  // an edit hands us its already-branched user message; a plain send appends
  userMessage= opts?.userMessage;
  if (opts?.editedMessageId) {
    const edited = store.branchMessage(threadId, opts.editedMessageId, text, opts.sendId, opts.sender, opts.dataContext);
    if (!edited) throw Object.assign(new Error("only a user text message can be edited"), { status: 400 });
    store.patchTask(bot.id, threadId, { rewound: true });
    userMessage = edited;
  }
  if (!userMessage) {
    userMessage = warmOnly
      ? { id: `warm-${randomUUID()}`, at: Date.now(), role: "user", kind: "text", text: "", ...(opts?.voiceCall ? { voiceCall: opts.voiceCall } : {}) }
      : opts?.cardContinuation
      ? { id: `card-${randomUUID()}`, at: Date.now(), role: "user", kind: "text", text }
      : store.appendMessage(threadId, {
          role: "user",
          kind: "text",
          text,
          replyToId: opts?.replyTo?.id,
          sendId: opts?.sendId,
          ...(opts?.dataContext ? { dataContext: opts.dataContext } : {}),
          peerAsk: opts?.peerAsk,
          sender: opts?.sender,
          ...(opts?.peerAsk && autoTurn?.pick.role === "worker" ? { autoModel: autoModelRecord(autoTurn.pick, Date.now()) } : {}),
          ...(opts?.voiceCall ? { voiceCall: opts.voiceCall } : {}),
          ...spokenLineFields(opts?.via, opts?.callId),
          ...(opts?.relayed ? { relayed: true } : {})
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
  personLine = !opts?.coordination && !opts?.cardContinuation && !opts?.automationSource && !opts?.compactOnly
    && !opts?.computerSelectionContinuation && !opts?.editedMessageId && !warmOnly && !commsDepth && !opts?.peerAsk && !userMessage.peerAsk;
  if (personLine && coordinator.answer(threadId, text)) {
    store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: "Answer passed to the waiting work", ok: true } });
    settleInputRequests(threadId);
    opts?.onTurnSettled?.();
    queueMicrotask(drainQueuedSends);
    return userMessage;
  }
  if (!warmOnly && opts?.voiceCall?.utteranceId) {
    liveVoiceUtteranceByThread.set(threadId, opts.voiceCall.utteranceId);
  }
  // Organization server (slice 3, D13): no turn without engine access. The
  // person's message stays; the thread gets the card saying why, the owner
  // a notification, and the sender an ordinary accepted send.
  speaker = resolveTurnSpeaker({
    speaker: opts?.speaker,
    sender: opts?.sender ?? (opts?.editedMessageId ? undefined : userMessage.sender),
    peerAsk: opts?.peerAsk ?? (opts?.editedMessageId ? undefined : userMessage.peerAsk),
    trigger: opts?.trigger,
    automationSource: opts?.automationSource
  });
  // an automatic recovery re-enters with these options: same speaker
  opts = { ...opts, speaker };
  // A voice call turn gets the hidden phone-call instruction; the first
  // written turn after a call is told the call ended. Only a person's own
  // turn: a continuation or a peer hop is not said on the phone.
  // The thread is on a live call (server/voice-call-session.ts): the engine
  // stays warm between turns and the turn's context stays short.
  onCall = Boolean(voiceCalls.active(threadId)) && !opts?.commsDepth && !userMessage.peerAsk;
  voiceCallText = opts?.cardContinuation || opts?.commsDepth || userMessage.peerAsk
    ? ""
    : voiceCallSection(
      userMessage,
      store.activePath(threadId).findLast((message: any) => message.role === "user" && message.id !== userMessage?.id && !message.peerAsk && message.at <= userMessage!.at),
      userMessage.sender?.name ?? botUserName(bot),
    );
  // Organization server: where this turn's tools run, and for whom, decided
  // once (server/desktop-bridge.ts); the speaker's own attachments are
  // pointed there and small text ones given inline.
  const turnRemote = remoteComputerForTurn({
    organization: IDENTITY.kind === "perspicax",
    runOnCloud: opts?.runOn === "cloud" || cloudOnlyBot(bot.id),
    hasTeamComputer: Boolean(inheritedTeamComputer(bot))
  });
  const turnWorks = turnWorksOn(plan, turnRemote.forceCloud);
  turnPrincipal = sandboxPrincipalForTurn({
    botOwnerPrincipalId: effectiveBotOwner(bot),
    confidentialOwnerPrincipalId: confidentialThreadOwner(threadId),
    routine: routineLineage(speaker),
    speakerPrincipalId: orgSpeakerPrincipal(bot, speaker)
  });
  const turnPersonAsked = !routineLineage(speaker) && Boolean(orgSpeakerPrincipal(bot, speaker));
  // Auto (2026-10-15; routines 2026-11-01): a person-asked turn prefers
  // the person's computer when connected, else the cloud. A routine starts
  // in the cloud; routinesAllowed only permits an explicit computer_select
  // to this_computer. A thread opened with a workspace starts there when
  // allowed (server/auto-computer.ts).
  const turnAutoWanted = turnWorks.auto ? autoWorkspaceWanted(bot, threadId) : null;
  const turnAutoStart = turnWorks.auto && IDENTITY.kind === "perspicax" && turnPrincipal ? autoStartTarget({
    wanted: turnAutoWanted,
    routine: routineLineage(speaker),
    personAsked: turnPersonAsked,
    desktopConnected: desktopBridges.connected(turnPrincipal.trim().toLowerCase()),
    routinesAllowed: workplacePreference(turnPrincipal.trim().toLowerCase()).routines,
    sandboxConfigured: Boolean(userSandbox),
    browserAvailable: plan.browser
  }) : null;
  turnPlace = decideWorkplace({
    desktopTargeted: plan.computer === "local" || plan.computer === "vm" || turnAutoStart?.target === "this_computer" || turnAutoStart?.target === "local_vm",
    routine: routineLineage(speaker),
    principal: turnPrincipal,
    personAsked: turnPersonAsked
  });
  turnAuto = autoComputerStateFor(turnPlace, turnWorks, routineLineage(speaker), turnAutoStart, plan.browser);
  // Each call turn's words carry the call mark themselves: a live session
  // gets the volatile call section only when it changed, so from the second
  // call turn on the section alone never reached the engine.
  if (userMessage.voiceCall && !opts.cardContinuation && !opts.commsDepth && !userMessage.peerAsk) {
    providerText = voiceCallTurnPrompt(providerText, userMessage.voiceCall);
  }
  // A greeting, thanks or small talk alone (server/small-talk.ts) asks for
  // no action: the engine is told so, and the cloud computer is not woken.
  const smallTalk = !warmOnly && !opts.cardContinuation && !opts.commsDepth && !opts.automationSource && !userMessage.peerAsk
    && !userMessage.voiceCall && !routineLineage(speaker) && isSmallTalk(userMessage.text, bot.name);
  if (smallTalk) providerText += SMALL_TALK_TURN_NOTE;
  if (!opts.cardContinuation && !warmOnly) {
    // Pictures ride as image input only on Claude Code, which reads them for
    // sure; another engine gets the saved picture files to read instead.
    const office = officeTurnText(providerText, turnPlace.principal, usesNativeImageInput && instance.driverKind === "claudeAgent", turnImages);
    providerText = office.text;
    turnImages.push(...office.images);
  }
  placedText = opts.cardContinuation ? { text: providerText, staging: null } : workplaceTurnText(providerText, turnPlace);
  providerText = withWorkplaceNote(placedText.text, turnPlace, turnAuto);
  // The engine's container runs in UTC: tell it the time where its person is
  // (server/turn-clock.ts), so times are said in their zone.
  const clockZone = opts.cardContinuation || !turnClockEnabled() ? null : turnZoneFor(bot, speaker);
  if (clockZone) providerText = withTurnClock(providerText, new Date(), clockZone);
  // A compaction summarizes with the bot's engine too, so it is gated like
  // a turn, and so is a fresh delegated turn (a hop, as ask_bot's is); other
  // card continuations resume a turn already admitted.
  const freshHop = Boolean(opts.coordination && !opts.coordination.resumed);
  const accessRefusal = opts.cardContinuation && !opts.compactOnly && !freshHop ? null
    : orgEngineRefusal(bot, instance, speaker, bot.modelSelection.model) ?? ownerModelOfflineRefusal(bot, instance, speaker, bot.modelSelection.model);
  if (accessRefusal) {
    if (warmOnly) {
      console.error(`[voice-call] warm skipped: ${accessRefusal.reason}`);
      opts?.onWarmSettled?.(false);
      return userMessage;
    }
    engine = engineDisplayName(instance);
    // A backup the usage-limit failover picked: one plain error, no card.
    backupRefused = limitBackupRefusedInThread(botId, threadId, speaker);
    card = accessCardFor(bot, accessRefusal, engine);
    if (!backupRefused && !repeatsShownFailure(store.messagesFor(threadId), { role: "bot", kind: "access", access: card }, bot.id)) {
      store.appendMessage(threadId, {
        role: "bot",
        kind: "access",
        access: card
      });
    }
    notice = backupRefused ?? engineAccessNotice(accessRefusal.reason, engine, accessRefusal);
    const refusedRun = routineLineage(speaker) ? activeRoutineRunForThread(threadId)?.id : undefined;
    notifyAccess(deliverableNotification("turn-failed", bot, threadId, notice, { avatarUrl: bot.avatarUrl }), card, refusedRun);
    console.error(`[omb-turn] bot=${botId} refused: ${accessRefusal.reason}${accessRefusal.cause ? `/${accessRefusal.cause}` : ""} (${instance.instanceId})`);
    opts?.coordination?.settle({ ok: false, text: notice });
    opts?.onDispatchError?.(notice);
    opts?.onTurnSettled?.();
    return userMessage;
  }
  // Auto: one discreet line when this turn starts on another place than the
  // thread last showed, or could not start where it was sent.
  if (turnAuto?.auto && turnAutoStart && !warmOnly && !opts.cardContinuation) noteAutoWorkspace(threadId, turnAutoStart, turnAutoWanted !== null);
  recoveryUserMessageId = opts?.coordination
    ? store.activePath(threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id
    : userMessage.id;
  // Auto: the pick is this thread's now that the turn is admitted, and
  // work handed out gets its activity row (which model, and why).
  if (autoTurn) {
    const earlierPick = store.taskByThread(bot.id, threadId)?.autoModel;
    store.patchTask(bot.id, threadId, { autoModel: autoModelRecord(autoTurn.pick, Date.now()) });
    autoTurnsByThread.set(threadId, { payer: autoTurn.payer, entry: { instanceId: autoTurn.pick.selection.instanceId, model: autoTurn.pick.selection.model } });
    // The person's own turn (2026-10-29): the words decide the model, so a
    // turn that runs on another model than the last one says so in one
    // line (the chip and the picker say it on the first turn).
    const ownTurnMoved = autoTurn.pick.role === "orchestration" && earlierPick !== undefined &&
      (earlierPick.instanceId !== autoTurn.pick.selection.instanceId || earlierPick.model !== autoTurn.pick.selection.model);
    if ((autoTurn.pick.role === "worker" || ownTurnMoved) && !warmOnly && !autoContinuing) {
      store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        autoModel: autoModelRecord(autoTurn.pick, Date.now()),
        tool: { name: `notice: ${explainPick(autoTurn.pick)}`, ok: true }
      });
    }
  } else autoTurnsByThread.delete(threadId);
  if (connectorSwitch) {
    line = { engine: connectorSwitch.engineLabel, connector: connectorSwitch.connector };
    store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: `notice: ${connectorSwitchText(line)}`, ok: true, connectorSwitch: line } });
  }
  // Admitted: every refusal above has passed and no other turn runs on this
  // thread, so this is the one moment the ledger's "who asked" may change.
  if (!warmOnly && opts?.trigger) turnTriggers.set(threadId, opts.trigger);
  // A fresh delegated turn (coordinate_bots) is a new hop on its thread:
  // it records its speaker so a hop it starts in turn carries the same one.
  // A teammate's warm records the speaker its coordinate_bots turn will, so
  // both are judged for the same person (mcpIdentityEnv).
  if (!opts.cardContinuation || (opts.coordination && !opts.coordination.resumed) || (warmOnly && opts.warmCoordination === true)) {
    turnSpeakers.set(threadId, speaker);
    turnSpeakerPrincipals.set(threadId, orgSpeakerPrincipal(bot, speaker));
    // a fresh turn of its own: an earlier aside no longer taints it (phone tools)
    if (!warmOnly) phoneToolTaintedThreads.delete(threadId);
    if (routineLineage(speaker)) {
      turnRoutineLineage.add(threadId);
      payer = turnPayer({ speaker, owner: { principalId: effectiveBotOwner(bot) }, peerOwnerPrincipalId: peerOwnerPrincipal(speaker) }).principalId;
      if (payer) turnRoutinePayers.set(threadId, payer);
      else turnRoutinePayers.delete(threadId);
      trigger = directRequestOwners.get(threadId)?.automation ?? (speaker.origin === "peer" ? speaker.routineTrigger : undefined);
      if (trigger) turnRoutineTriggers.set(threadId, trigger);
      else turnRoutineTriggers.delete(threadId);
    } else {
      turnRoutineLineage.delete(threadId);
      turnRoutinePayers.delete(threadId);
      turnRoutineTriggers.delete(threadId);
    }
  }
  // A card continuation neither starts nor ends the person's ask: it
  // resumes the turn their last message began, so that record stands.
  if (!warmOnly && !opts?.cardContinuation) {
    if (commsDepth === 0 && opts?.automationSource === undefined && !opts?.unattended && !userMessage.peerAsk) {
      personAskAt.set(threadId, userMessage.at);
      // Where the person is now (server/main-thread.ts). A line relayed
      // from Slack was written there, not in this conversation: the line
      // says so (Message.relayed), also in a turn a computer switch continues.
      if (!userMessage.relayed) store.setTaskAskedAt(bot.id, threadId, userMessage.at);
      // Continuing an old run as a normal conversation makes that task
      // visible again; these new replies are not routine report updates.
      if (task.routineRunId) store.patchTask(bot.id, threadId, { routineRunId: undefined });
    } else {
      personAskAt.delete(threadId);
    }
  }

  // 2026-10-28: every turn of an engine that mounts the agents server gets
  // it; a teammate one hop away gets it without the peer tools (peerHop).
  // The person-facing parts (setup, skill authoring, the computer choice,
  // the team roster) stay with the turns that may reach a peer.
  peerHop = peerHopTurn(commsDepth, coordinated);
  agentsMounted = instance.adapter.capabilities.agentsMcp === true;
  peerToolsMounted = agentsMounted && !peerHop;

  // busy flips immediately so the composer locks; the dispatch itself runs
  // in the background — boat provisioning can take ~90s and must never
  // hang the HTTP request
  dispatchClaimId = randomUUID();
  // The same request again after its turn failed on a usage limit: the root
  // that turn opened (the work it handed out) continues with this turn. Its
  // own resume may have started meanwhile; then it answers the request, and
  // this turn does not run (nothing of it is recorded yet).
  if (!warmOnly && opts?.continuesGeneration &&
      ["answered", "resumed"].includes(coordinator.continueRoot(opts.continuesGeneration, dispatchClaimId))) {
    throw Object.assign(new Error("its teammates' results already answer this request"), { status: 409, code: "answered" });
  }
  if (smallTalk) {
    smallTalkTurns.set(threadId, { generation: dispatchClaimId, messageId: userMessage.id });
    if (smallTalkTurns.size > 2_000) smallTalkTurns.delete(smallTalkTurns.keys().next().value!);
  }
  // Guest-driven for as long as it runs, wherever it runs (cloudGuestDriven).
  if (guestConfined) guestDrivenTurns.set(threadId, dispatchClaimId);
  resourceOwner= { threadId, generation: dispatchClaimId };
  turnResourceOwners.set(threadId, resourceOwner);
  directTurnGenerationByThread.set(threadId, dispatchClaimId);
  requestMessageId = opts?.cardContinuation ? opts.requestMessageId : userMessage.id;
  const previousRequest = directRequestOwners.get(threadId);
  // This request replaces the thread's last one, which may have finished a
  // moment ago with its fence still up: its own settle waits on the digest,
  // while a queued line (the next Team incidents report, a person's
  // follow-up) drains at turn.completed. Close a finished one first, or it
  // reads unsettled forever.
  if (previousRequest && previousRequest.messageId !== requestMessageId) {
    settleTrackedRequest(threadId, new Set([userMessage.id, ...(opts?.excludeMessageIds ?? [])]));
    savedSteps.requestEnded(threadId, previousRequest.generations);
  }
  const requestGenerations = requestMessageId && previousRequest?.messageId === requestMessageId
    ? previousRequest.generations : new Set<string>();
  if (requestGenerations.size >= 500) { requestGenerations.clear(); requestMessageId = undefined; }
  requestGenerations.add(dispatchClaimId);
  // Settled once, for everything this request hands on. A continuation (a
  // card answer, a wake, a resume after the person acted, a surface change)
  // keeps the origin of the request it continues while that record is
  // still its own, and never re-reads a stored line: nothing on one says a
  // routine or a webhook wrote it.
  const continuation = Boolean(opts?.cardContinuation || opts?.computerSelectionContinuation);
  const continued = previousRequest && !previousRequest.stopped &&
    (requestMessageId ? previousRequest.messageId === requestMessageId : opts?.cardContinuation) ? previousRequest.origin : undefined;
  const requestOrigin = requestWorkOrigin({ trigger: opts?.automationSource, guest: guestConfined, handed: opts?.origin, continued,
    line: !continuation && requestMessageId === userMessage.id ? userMessage : undefined });
  directRequestOwners.set(threadId, { generation: dispatchClaimId, messageId: requestMessageId,
    generations: requestGenerations, turnId: null, ...(opts?.automationSource ? { automation: opts.automationSource } : {}), origin: requestOrigin,
    ...(userMessage.voiceCall || opts?.voiceCall ? { voiceCall: true as const } : {}),
    ...(personLine || (continued && previousRequest?.personLine) ? { personLine: true as const } : {}) });
  // On a Cloud home, a turn that is not provably the owner's leaves this
  // bot's memory "pending" until it ends (server/lending-memory.ts).
  // An unknown control-plane wake may invalidate a prior final, but it must
  // never acquire authority by guessing the latest user as its origin.
  const pendingSource = requestMessageId ?? store.activePath(threadId).findLast((message: any) => message.role === "user")?.id;
  if (!warmOnly && pendingSource) store.patchMessage(threadId, pendingSource, { requestPending: true });
  if (!warmOnly && opts?.coordination) directCoordinationSettlers.set(dispatchClaimId, opts.coordination.settle);
  // Ordinary sources need the same exact completion ownership as queued
  // follow-ups: any normal turn may ask teammates to coordinate work.
  // A warm has no turn to settle.
  if (!warmOnly) directFollowupSettlers.set(dispatchClaimId, { threadId, settle: opts?.onTurnSettled });
  directTurnDispatchClaims.set(threadId, { id: dispatchClaimId, botId, threadId, phase: "setup", ...(warmOnly ? { warm: true } : {}) });
  directTurnBots.set(threadId, bot);
  beginInternalCapabilityGeneration(threadId, dispatchClaimId);
  // The surface paragraph is part of the stable prompt. A call warm has no
  // saved user row, so it cannot register a selection, but the first spoken
  // turn will. Predict that paragraph or the engine relaunches on the first
  // words.
  const sharedComputerBlocksSelect = !remoteComputerForTurn({
    organization: IDENTITY.kind === "perspicax",
    runOnCloud: opts?.runOn === "cloud",
    hasTeamComputer: Boolean(inheritedTeamComputer(bot))
  }).skipRemote && Boolean(inheritedTeamComputer(bot));
  maySelectComputer = !opts?.computerSelectionContinuation && !opts?.cardContinuation && !opts?.automationSource && !opts?.unattended &&
      !opts?.commsDepth && !opts?.coordination && !sharedComputerBlocksSelect && bot.computer !== "off" && agentsMounted;
  if (!warmOnly && maySelectComputer) {
    source = store.activePath(threadId).findLast((message: any) => message.id === userMessage?.id && message.role === "user" && !message.peerAsk);
    if (source) computerSelectionTurns.set(threadId, { generation: dispatchClaimId, botId: bot.id, source, text, dataContext: opts?.dataContext });
  }
  // A warm must not look like work: no busy flag, no watchdog, no reopen
  // of a closed thread, no cleared badge. The first utterance joins it.
  if (!warmOnly) {
    store.setTaskActivity(bot.id, threadId, "working");
    // Watch from admission, not dispatch: a turn can wedge in setup — context
    // compaction that never returns, a hung browser or VM mount — long before
    // any provider event exists, and a watch armed only at dispatch never saw
    // those. Every setup exit below settles or throws into the catch, which
    // settles under the same generation ownership it already enforces.
    watchdog.watch(threadId, bot.id);
    // A closed thread that gets a new turn is open again: the person (or the
    // opener) picked it back up, so its row returns to the sidebar and
    // list_threads stops calling it closed. No-op on an open thread.
    store.setTaskClosedBy(bot.id, threadId, null);
    // The badge is "this bot answered you, and you have not looked yet". A
    // person starting a turn has looked; a teammate's hop has not — the fold
    // never re-marks an internal turn, so clearing here would silently spend
    // a signal the person still owes a glance to.
    if (commsDepth === 0) store.patchTask(bot.id, threadId, { unread: false });
    turnUsage.delete(threadId);
    turnContext.delete(threadId);
  }

    void (async () => {
    let warmOk = false;
    try {

      if (warmOnly && opts?.warmSignal?.aborted) {
        instance.adapter.releaseWarmSession?.(threadId);
        return;
      }
      if (enginesRead) {
        await enginesRead;
        if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) throw new DirectTurnSetupCancelled("turn stopped while the engines were read");
      }
      // A call warm must not compact or rewrite the resume cursor. The first
      // spoken turn decides that, and a reset discards this process.
      if (!warmOnly) {
      // Readiness can wait on the network. Admit the task first so its busy
      // state, Stop action and watchdog own that wait just like VM setup.
      if (opts?.runOn === "cloud") {
        const readiness = await cloudRoutineReadiness(botId, threadId);
        if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) {
          throw new DirectTurnSetupCancelled("turn stopped during cloud readiness");
        }
        if (!readiness.ready) throw new Error(readiness.reason ?? "The cloud computer is not ready");
      }
      // A call turn starts its own short session: the conversation's fold
      // waits for its next written turn, off the person's silence.
      if (!voiceCallTurn) await compactConversation({ bot, threadId, generation: dispatchClaimId, instance, model,
        excludedIds: new Set([userMessage.id, ...(opts?.excludeMessageIds ?? [])]), manual: opts?.compactOnly === true });
      turnTrace(threadId, "compacted");
      if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) throw new DirectTurnSetupCancelled("turn stopped during context setup");
      if (opts?.compactOnly) {
        clearDirectTurnDispatch(threadId, dispatchClaimId);
        revokeInternalCapabilityGeneration(threadId, dispatchClaimId);
        settleDirectFollowup(dispatchClaimId);
        releaseTurnResources(resourceOwner);
        store.setTaskActivity(bot.id, threadId, "idle");
        watchdog.settle(threadId);
        directTurnBots.delete(threadId);
        retryDelegationsWaitingOn(bot.id);
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
      const skipTranscript = new Set<string>([userMessage.id, ...(opts?.excludeMessageIds ?? [])]);
      const activeMessages = store.activePath(threadId);
      const coordinationChildren = opts?.coordination?.resumed
        ? new Set(coordinator.children(opts.coordination.id).map((child: any) => child.id)) : undefined;
      for (const m of activeMessages) {
        if (!opts?.coordination || !m.roomRequest) continue;
        if ((m.roomRequest.phase === "request" && m.roomRequest.id === opts.coordination.id) ||
          (m.roomRequest.phase === "result" && coordinationChildren?.has(m.roomRequest.id))) skipTranscript.add(m.id);
      }
      const context = directContext(bot, threadId, activeMessages);
      const contextOrder = context.map((m: any) => m.id);
      const replayable = context.filter((m: any) => !skipTranscript.has(m.id));
      const record = latestCompaction(activeMessages, task);
      const selection = selectReplay(context, { budgetBytes: cfg.context?.rebuildBytes ?? DEFAULT_REBUILD_BYTES, excludedIds: skipTranscript, compaction: record });
      const transcript = selection.transcript.map(({ role, text }: any) => ({ role, text }));
      const contextReset = selection.compacted > 0 && record?.id !== task.appliedCompactionId;
      // Whether this engine had a session here is decided on the cursors
      // from before the reset below: a fold is a continuation, not a new
      // engine joining (turn-context.ts COMPACTED_PREAMBLE).
      const cursorsBeforeReset = task.resumeCursors;
      // The record is durable even if a crash occurs before this bookkeeping.
      // A retry then sees the unapplied record again and rebuilds safely.
      if (contextReset && !warmOnly && !voiceCallTurn) store.patchTask(bot.id, threadId, { resumeCursors: {} });
      // A fold of a stale session reads as a pause, never "continue where you left off".
      const pausedFold = contextReset && Boolean(record && task.contextSummaries?.some((entry: any) => entry.id === record.id && entry.stale));

      // After a rewind (edit / branch switch) the provider's native session
      // still contains the abandoned branch: start a fresh session instead of
      // resuming, and for cursor-resuming drivers replay the surviving path
      // inline (transcript-replay drivers get it via transcript). The flag is
      // cleared only once the turn is actually dispatched — clearing it here
      // would cost the next attempt its history if this dispatch fails.
      const rewound = Boolean(task.rewound);
      // A fresh engine — the user switched this bot's model mid-thread — has no
      // current session here either, so it gets the same replay. Distinct from
      // rewound: the OTHER instances' cursors are left alone (a rewind wipes
      // them all), and "fresh" is decided by who ran the last turn, not by
      // whether we hold a cursor — see engineIsFresh.
      const externalContextMarker = isExternalContextMarker(task.lastInstanceId)
        ? task.lastInstanceId
        : undefined;
      const fresh =
        !rewound &&
        !externalContextMarker &&
        engineIsFresh({ instanceId, lastInstanceId: task.lastInstanceId, resumeCursors: cursorsBeforeReset, transcript: replayable });
      // An engine that records what its session was handed resumes it with only
      // the context messages outside that record. A record of another session
      // (the one it replaced) or one that no longer lines up with the branch is
      // not trusted: the session is rebuilt by the same replay as any other.
      const strictResume = instance.adapter.capabilities.strictResume === true;
      const cursor = task.resumeCursors[instanceId];
      const handed = strictResume && !rewound && !contextReset && !fresh && !externalContextMarker && cursor !== undefined
        ? task.handedMessages?.[instanceId] : undefined;
      const unseen = handed && handedStateUsable(handed, cursor, contextOrder) ? unseenMessages(replayable, contextOrder, handed) : undefined;
      // A teammate's result or reply: without records this turn would replay.
      const externalUpdate = Boolean(opts?.coordination?.resumed || unseen?.some((m: any) => m.keep));
      // What a resumed session keeps from its launch: the standing instructions
      // (tools, servers and — for Claude — the model are passed on every launch),
      // plus settings that a live turn cannot change. Codex now reasserts its
      // model/provider on resume, but an in-flight turn and an omitted effort
      // retain the prior selection, so both still belong to the session here. An
      // external update that finds any of it changed since the session started
      // gets the fresh session and replay it always got, rather than a resume.
      const persistentConfig = [bot.name, bot.title, bot.description, sectionContextSystemPrompt(bot.section),
        ...(instance.driverKind === "codex" ? [model, effort ?? null] : [])];
      const sessionConfig = (soul: string | undefined) =>
        createHash("sha256").update(JSON.stringify([...persistentConfig, soul])).digest("hex").slice(0, 16);
      const plannedConfig = sessionConfig(bot.soul);
      // Agent-tool gate shared by skill authoring, the /setup turn-text rewrite,
      // the setup prompt block, and the peer-comms integration below: a driver
      // that never mounts agent tools (or a turn already at the comms-depth cap)
      // must not be steered into — or told about — tools it cannot call.
      const skillAuthoring = personalFeatureOn("skillAuthoring", skillAuthoringEnabled(cfg), vaultPrincipalForThread(threadId)) && peerToolsMounted;
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
        bot.id,
        providerText,
        skillsLibraryEnabled(cfg) ? (store.bot(bot.id)?.assignedSkills ?? bot.assignedSkills) : undefined,
        { inline: skillCommandInline({ workspaceFiles: supportsWorkspaceFiles(instance.driverKind), organization: IDENTITY.kind === "perspicax" }),
          overrides: (() => {
            const person = IDENTITY.kind === "perspicax" ? orgSpeakerPrincipal(bot, speaker) : localPrincipalId();
            return skillsLibraryEnabled(cfg) && person ? personalSkills.commands(person, new Set(personalSkillInputs(bot, person).filter((skill: any) => skill.shadowed).map((skill: any) => skill.name))) : [];
          })()
        },
      );
      const setupText = peerToolsMounted ? expandSetupTurnText(skillCommandText) : skillCommandText;
      const userTurnText = promptWithReply(
        skillAuthoring ? expandLearnTurnText(setupText) : setupText,
        opts?.replyTo,
        botUserName(bot),
      );
      // Decided again at dispatch when setup outlasted a soul edit (config).
      const decideContext = (config: string) => {
        // A Codex thread keeps the last effort it was sent and no turn can clear
        // one: back on the default, a thread that holds a level is rebuilt from
        // the transcript rather than resumed on that level.
        const effortHeld = !effort && typeof handed?.effort === "string";
        const handedStale = Boolean(handed && (!unseen || effortHeld || (externalUpdate && handed.config !== config)));
        const { block: unseenBlock, placed } = unseen && !handedStale ? renderUnseen(unseen) : { block: "", placed: [] };
        const { turnText: contextTurnText, resume } = buildTurnContext({
          text: userTurnText,
          transcript,
          rewound,
          fresh,
          compacted: contextReset,
          paused: pausedFold,
          externallyUpdated: Boolean(externalContextMarker) || handedStale,
          replaysNatively: replaysNatively(instance.driverKind)
        });
        // Snapshot the cursor alongside the context decision. An external result
        // can arrive during async computer/setup work and clear the task cursor;
        // this already-built turn must either keep its old session or replay on the
        // following turn, never start a blank session with no transcript.
        const resumeCursor = resume ? task.resumeCursors[instanceId] : undefined;
        // A cursor the provider no longer honours must not brick the thread: the
        // driver may fall back to ONE fresh session, and this is what it sends
        // there, so the new session is not blank (server/resume-recovery.ts). A
        // turn carrying an external update gets the replay it would have had.
        const recoveryIsReplay = resumeCursor !== undefined && externalUpdate && transcript.length > 0;
        const recoveryText = resumeCursor === undefined ? undefined : recoveryIsReplay
          ? buildTurnContext({ text: userTurnText, transcript, rewound: false, fresh: false, externallyUpdated: true, replaysNatively: false }).turnText
          : buildRecoveryText({ text: userTurnText, transcript });
        // What this turn puts in front of the provider, for each session it can end
        // up in (server/delta-context.ts). buildTurnContext prepends a replay only
        // when it replays, so a changed text means the transcript was sent.
        const carried = [...skipTranscript];
        const windowIds = selection.representedIds;
        return {
          turnText: withUnseenMessages(unseenBlock, contextTurnText),
          resumeCursor, sessionReset: !resume, recoveryText,
          handoff: strictResume ? {
            botId: bot.id, instanceId, config, resumeCursor: typeof resumeCursor === "string" ? resumeCursor : undefined,
            ...(instance.driverKind === "codex" ? { effort: effort ?? null } : {}),
            started: sessionStart(contextOrder, contextTurnText !== userTurnText ? windowIds : [], carried),
            recovery: sessionStart(contextOrder, recoveryText !== undefined ? windowIds : [], carried),
            resumed: sessionStart(contextOrder, [], [...placed, ...carried]),
            placed, carried, own: [userMessage.id, ...(opts?.excludeMessageIds ?? [])]
          } : undefined
        };
      };
      let dispatchContext = decideContext(plannedConfig);
      // A call turn (server/voice-turn.ts) runs in the call's own session,
      // never the conversation's: no conversation cursor, no handed-message
      // record. Its first dispatch (the warm, or the first spoken turn) closes
      // an idle process the thread kept, so the call never reuses the long
      // session; the first spoken turn carries the short view of the
      // conversation; the later ones resume the call session, with what it
      // has not seen (a task's result) in front of the words.
      // The conversation's session resumes after a call: the call's lines go
      // in front of the words (a rebuild or a replaying engine has them).
      const callSince = !voiceCallTurn && !warmOnly ? callLinesSince.get(threadId) : undefined;
      if (callSince !== undefined) {
        const from = contextOrder.indexOf(callSince);
        if (dispatchContext.resumeCursor !== undefined && !dispatchContext.sessionReset && from >= 0 && !replaysNatively(instance.driverKind)) {
          const lines = replayable.filter((m: any) => contextOrder.indexOf(m.id) > from);
          dispatchContext = { ...dispatchContext, turnText: withUnseenMessages(callLinesBlock(lines), dispatchContext.turnText) };
        }
        callLinesSince.delete(threadId);
      }
      const liveCall = voiceCallTurn ? voiceCalls.active(threadId) : undefined;
      const voiceView = liveCall ? voiceTranscript(context, { excludedIds: skipTranscript, ...(record ? { compaction: record } : {}) }) : null;
      let voiceHanded: string[] = [];
      let voiceAnchor: string | undefined;
      let voiceBriefed = false;
      if (liveCall && voiceView) {
        const plan = voiceSessions.plan(threadId, { callId: liveCall.callId, instanceId, model: String(model ?? "") });
        if (plan.fresh) {
          // the idle process may hold the conversation's session: never reuse it
          try { instance.adapter.releaseWarmSession?.(threadId); } catch { /* already closed */ }
        }
        // the warm starts the call's process: the first spoken turn takes it as is
        if (warmOnly) voiceSessions.dispatched(threadId, []);
        const byId = new Map<string, any>(activeMessages.map((message: any) => [message.id, message]));
        const ownReply = (id: string) => {
          const source = byId.get(byId.get(id)?.requestMessageId ?? "");
          return Boolean(source?.voiceCall);
        };
        const unseen = plan.brief ? [] : voiceSessions.unseen(threadId, replayable)
          .filter((m: any) => !(m.role === "user" && (m.spoken || byId.get(m.id)?.voiceCall)) && !(m.role === "assistant" && ownReply(m.id)));
        const natively = replaysNatively(instance.driverKind);
        const brief = voiceBriefText(voiceView.transcript, userTurnText);
        const text = warmOnly ? "" : natively ? userTurnText
          : plan.brief ? brief : withUnseenMessages(voiceUnseenBlock(unseen), userTurnText);
        voiceHanded = warmOnly ? [] : [...(plan.brief ? voiceView.representedIds : unseen.map((m: any) => m.id)), ...skipTranscript];
        voiceAnchor = warmOnly ? undefined : (contextOrder.at(-1) ?? userMessage.id);
        voiceBriefed = plan.brief;
        dispatchContext = {
          turnText: text,
          resumeCursor: plan.cursor,
          sessionReset: false,
          // a call session the engine no longer has starts again from the short view
          ...(plan.cursor !== undefined && !natively ? { recoveryText: brief } : {}),
          handoff: undefined
        } as typeof dispatchContext;
        console.log(`[voice-turn] thread ${threadId}: ${warmOnly ? "warm" : plan.brief ? "new call session" : "call session resumed"} on ${instanceId}/${String(model ?? "")}, ${Buffer.byteLength(text)} bytes of context`);
      }

      const persona = [
        `You are ${bot.name}, a personal bot in Sagax.`,
        bot.title && `Role: ${bot.title}.`,
        bot.description && `About: ${bot.description}`,
      ]
        .filter(Boolean)
        .join(" ");

      // The SOUL.md mirror is checked here, at dispatch, and only reported:
      // the prompt below reads bot.soul, never the file.
      if (!warmOnly) {
        const drift = checkSoulDrift(bot.id, bot.soul ?? "", bot.soulHash ?? "");
        if (drift.drift !== Boolean(bot.soulDrift)) store.patchBot(bot.id, { soulDrift: drift.drift });
      }
      if (!warmOnly && dispatchContext.handoff) handoffs.begin(threadId, dispatchClaimId, dispatchContext.handoff);

      const integrations: any = {};
      let githubWithheld: string[] = [];
      let browser: Awaited<ReturnType<typeof browserIntegration>> = null;
      const selectedSkills = selectBundledSkills(
        providerText,
        [
          ...(instance.adapter.capabilities.phoneMcp === true ? ["phoneMcp"] : []),
          ...(skillAuthoring ? ["skillAuthoring"] : []),
        ],
        availableSkills(),
      );
      if (selectedSkills.some((skill: any) => skill.manifest.requiredCapabilities.includes("phoneMcp"))) {
        integrations.phone = phoneIntegration(bot.id, threadId, dispatchClaimId);
      }
      if (messagesWanted()) integrations.messages = messagesIntegration(bot.id, threadId, dispatchClaimId);
      // user-configured MCP servers (config.json mcpServers): only to a
      // driver that can mount them. Their tools are
      // never pre-allowed, so every call rides the normal permission flow.
      if (instance.adapter.capabilities.customMcp === true) {
        await refreshMcpOAuth(bot);
        const mounted = mcpServersAsPerson(bot, orgSpeakerPrincipal(bot, speaker), threadId);
        attachCustomMcp(integrations, mounted.servers, cfg);
        githubWithheld = mounted.githubWithheld;
      }
      // Slice 5: the bot's Perspicax profiles, as the person who speaks.
      let perspicaxPrompt = "";
      if (IDENTITY.kind === "perspicax" && instance.adapter.capabilities.customMcp === true && (store.bot(bot.id) ?? bot).perspicax?.profiles.length) {
        const perspicax = await perspicaxTurnIntegration({ bot, threadId, generation: dispatchClaimId, speaker, taken: Object.keys(integrations.custom ?? {}), ...(warmOnly ? { quiet: true } : {}) });
        if (Object.keys(perspicax.custom).length) integrations.custom = { ...integrations.custom, ...perspicax.custom };
        perspicaxPrompt = perspicax.prompt;
      }
      if (!warmOnly) turnTrace(threadId, "integrations");
      // a call's tools should not come and go between its turns: say so when they do
      const callMcp = voiceCalls.noteMcp(threadId, Object.keys(integrations.custom ?? {}));
      if (callMcp.added.length || callMcp.removed.length) {
        console.warn(`[voice-call] thread ${threadId}: MCP servers changed between call turns${callMcp.added.length ? `; added ${callMcp.added.join(", ")}` : ""}${callMcp.removed.length ? `; missing ${callMcp.removed.join(", ")}` : ""}`);
      }
      // CLI engines work inside the bot's own workspace directory rather
      // than the user's home: a bot with file tools and acceptEdits gets a
      // desk, not the whole house — and the workspace is where its
      // MEMORY.md lives. API/box engines have no local filesystem story.
      const worksInWorkspace = supportsWorkspaceFiles(instance.driverKind);
      if (worksInWorkspace) {
        ensureWorkspace(bot.id);
        // memory sealed at rest opens back to plain in place for the engine's
        // file tools (started above, off the turn's path), until the turn ends
        // baseline for the journal's turn-boundary diff (see the bus hook)
        // A warm has no turn to journal. endMemoryTurn would close the previous one.
        if (!warmOnly && bot.memoryEnabled !== false) beginMemoryTurn(bot.id, threadId);
      }
      const privateWorkspace = worksInWorkspace ? ensureTaskWorkspace(bot.id, threadId) : undefined;
      const skillInstructions = renderSkillInstructions(selectedSkills, {
        includeRoot: worksInWorkspace
      });
      const packagePlaybooks = installedPlaybookInstructions(providerText, bot.playbooks);
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
        privateWorkspace
          // A confidential thread works in its own folder, never the bot's
          // project folder other threads share (server/confidential-threads.ts).
          ? store.pinTaskCwd(bot.id, threadId, privateWorkspace, { privateOnly: cloudGuestOpened(threadId) || store.isConfidentialThread(threadId) })
          : null;
      // A bot's threads run side by side in one project folder, like several
      // Claude Code or Codex sessions open in one repo: the folder is never a
      // turn-long claim. What truly needs one writer queues on its own — the
      // per-turn snapshot per folder (server/checkpoints.ts), memory through
      // memory_update — and the engines key their sessions by id, not folder.
      const cwd = pinnedCwd ?? undefined;
      // Checkpoint explicit project folders, where a bot can overwrite the
      // user's work. Its private Sagax workspace is app-owned and changes
      // on nearly every ordinary chat; snapshotting it would add hidden disk
      // and process overhead without a user project to list changes for.
      const checkpointCwd = cwd && cwd !== privateWorkspace ? cwd : undefined;
      // dweb is opt-in: without an explicit daemon URL, do not advertise
      // tools that would fail on every call or spawn an unnecessary proxy.
      const dwebUrl = process.env.DWEB_URL?.trim();
      if (dwebUrl) integrations.dweb = { url: dwebUrl };
      // Cloud routines on a solo server use the bot's Boat. The per-bot
      // backend applies only to ordinary turns. An organization server
      // never attaches that Boat, a VPS, or a shared team computer: Cloud,
      // including a cloud routine, is the person's one server environment.
      const inheritedComputer = computerSkipped ? undefined : inheritedTeamComputer(bot);
      const remote = remoteComputerForTurn({
        organization: IDENTITY.kind === "perspicax",
        runOnCloud: opts?.runOn === "cloud",
        hasTeamComputer: Boolean(inheritedComputer)
      });
      let teamComputer = remote.skipRemote ? undefined : inheritedComputer;
      const cloudBackend = teamComputer || opts?.runOn === "cloud" || bot.cloudBackend !== "vps" ? "box" : "vps";
      const mountsComputerMcp = instance.adapter.capabilities.computerMcp === true;
      const mountsLocalComputer = instance.adapter.capabilities.localComputerMcp === true;
      // Where this turn's hands may land. The bot's "Works on" choice is
      // strict; a browser-only bot gets no computer at all, and a bot whose
      // browser is withheld (workspace flag, its own switch, or an engine
      // without browser tools) gets told so instead of silently falling back
      // to a desktop it was never meant to touch.
      // The conversation's own place wins over the bot default: the person
      // pinned it from the composer, or its first Auto turn recorded where it
      // landed. A team computer or a cloud routine is not this conversation's
      // choice, so those ignore the pin.
      const dispatchTask = store.taskByThread(bot.id, threadId);
      // Organization server: the person's computers are reached through
      // turnPlace (their server environment, or their own computer through
      // the desktop app). Auto, Cloud, a cloud routine, Local VM and This
      // computer claim nothing here, and a team computer does not either.
      let wants: ComputerWant = computerSkipped ? "off" : remote.skipRemote && plan.computer !== "off" ? "off" : plan.computer;
      mountUserSandbox(integrations, {
        botId: bot.id, threadId, generation: dispatchClaimId,
        customMcp: instance.adapter.capabilities.customMcp === true,
        decision: turnPlace, staging: placedText.staging, auto: turnAuto
      });
      await mountPersonalMcp(integrations, {
        botId: bot.id, threadId, generation: dispatchClaimId,
        customMcp: instance.adapter.capabilities.customMcp === true, principal: turnPlace.principal
      });
      await mountPluginMcp(integrations, {
        botId: bot.id, threadId, generation: dispatchClaimId,
        customMcp: instance.adapter.capabilities.customMcp === true, principal: turnPlace.principal
      });
      /** A Team incidents turn's computer is optional (turnAnswers): a place
       * that cannot be prepared leaves it with none — any seat taken on the
       * way let go — and the prompt names the cause, where any other turn
       * fails. A stopped setup and a parked seat wait go on as for any turn. */
      const skipComputer = (error: unknown) => {
        if (!answer.incident || error instanceof DirectTurnSetupCancelled || error instanceof ComputerWaitParked) throw error;
        computerSkipped ??= error instanceof Error ? error.message : String(error);
        wants = "off";
        teamComputer = undefined;
        delete integrations.localComputer;
        releaseTurnComputer(resourceOwner);
      };
      // A place the organisation disallows, or a Cloud home never offers, is
      // refused before anything is prepared; Auto below simply skips them.
      const wantedKind = teamComputer ? "box" : wants === "local" ? "thisComputer" : wants === "vm" ? "localVm"
        : wants === "cloud" ? (cloudBackend === "vps" ? "vps" : "box") : undefined;
      const placeRefusal = wantedKind && computerPlaceRefusal(wantedKind);
      if (placeRefusal) skipComputer(Object.assign(new Error(placeRefusal.message), { status: 409, code: placeRefusal.code }));
      // Where an explicit place came from, so its failure names the one
      // control that changes it (and a failed Auto-recorded pin is cleared).
      // Auto and a team's shared computer are nobody's per-turn choice.
      const namedPlace = teamComputer || wants === undefined || wants === "off" ? undefined : wants;
      const placeSource: PlaceSource | undefined = !namedPlace ? undefined
        : opts?.runOn === "cloud" ? "routine"
        : plan.pinned ? (honouredPin(dispatchTask) ? "pin" : "auto-pin")
        : "works-on";
      // An engine that cannot use the cloud computer, or a Tool selection
      // that leaves its tools out, is refused here, before anything is
      // created or woken — never handed to another engine.
      if (wants === "cloud" && placeSource) {
        const unsupported = cloudPlaceRefusal(cloudEngine(instance, bot.modelSelection.model), placeSource, bot.name)
          ?? computerToolsRefusal(toolScope, placeSource, bot.name);
        if (unsupported) skipComputer(unsupported);
      }
      let previewCapture: (() => Promise<{ png: string; format: string }>) | null = null;
      let browserCapture: (() => Promise<{ png: string; format: string }>) | null = null;
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
        const localVmTarget = pinnedTarget ?? localVmThreadTargets.get(claimThreadId) ?? { ...localVmTargetForThread(bot.id, claimThreadId) };
        await bindTurnComputer(resourceOwner, `computer:vm:${localVmTarget.key}`, true);
        if (localVmImageBusy || localVmModeChangeBusy || localVmLifecycleBusy.has(localVmTarget.key)) {
          throw new Error("this Local VM is being started, stopped, or replaced — wait for setup to finish");
        }
        // Claim before the first await. The lifecycle route performs its
        // matching check synchronously, so neither side can enter while the
        // other is between inspection and mutation.
        if (!localVmLeaseFor(localVmTarget).claim(claimThreadId, bot.id, localVmOwnerBusy)) {
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
          const resource = `computer:vm:${localVmTarget.key}`;
          turnResources.releaseOne(resource, resourceOwner);
          if (turnComputerResources.get(resourceOwner.threadId)?.resource === resource) turnComputerResources.delete(resourceOwner.threadId);
        };
        let localVm: Awaited<ReturnType<typeof readyLocalVmForTurn>>;
        try {
          localVm = await readyLocalVmForTurn(bot.id, localVmTarget);
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
        if (owner?.threadId !== claimThreadId || owner.botId !== bot.id) {
          dropLease();
          throw new Error("the Local VM lease expired while preparing the turn");
        }
        // Same contract as the Boat and VPS branches below: without this the
        // poller never starts, so the Local VM publishes no `screen` events
        // and every client that only has the stream (the phone) waits
        // forever. The web panel hid the gap by polling the screenshot
        // route itself.
        previewCapture = localVmPreviewFor(localVmTarget, claimThreadId);
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
        if (activeInternalGenerationByThread.get(threadId) !== resourceOwner.generation || !threadBusy(bot.id, threadId)) return;
        // The wait ceiling parked this turn (#1651): register the resume and
        // settle the live turn. No error entry, no incident — the parked chip
        // the wait appended is the whole story. The slot still fails, so the
        // gate keeps refusing screen calls for the rest of this generation
        // while the interrupt lands.
        if (resourceOwner.computerParkedOn) {
          registerComputerResume({
            botId: bot.id,
            threadId,
            resource: resourceOwner.computerParkedOn,
            generation: resourceOwner.generation,
            afterMessageId: store.activePath(threadId).findLast((entry: any) => entry.role === "user")?.id
          });
          void interruptDirectThread(bot.id, threadId, { preserveComputerResume: true, cause: "computer-park" }).catch(() => {});
          return;
        }
        // A place that failed (mountBotBoat) is already read as its one line
        // and one way on, and never sticks as an Auto-recorded pin.
        const placeFailure: any = error instanceof PlaceUnavailableError ? error : undefined;
        if (placeFailure) clearFailedAutoPin(bot.id, threadId, placeFailure.place);
        const message = placeFailure?.message ?? `computer unavailable — ${label} could not be claimed for this turn (${failure})`;
        store.appendMessage(threadId, {
          role: "bot",
          kind: "activity",
          tool: failedTurnTool(message, placeFailure ? { place: placeFailure.row } : {})
        });
        if (opts?.automationSource === undefined && !opts?.commsDepth && !opts?.cardContinuation) {
          notify(deliverableNotification("turn-failed", bot, threadId, redactSecretsInText(message), { avatarUrl: bot.avatarUrl }));
          reportIncident({ kind: "could-not-start", bot, threadId, detail: message });
          // Claude settles the interrupt below as exit_before_result; the
          // completion fold must not report this failure a second time.
          resourceOwner.lazyClaimFailureReported = true;
        }
        // A routine, a delegation or a resume reports this exactly as it
        // reports a place that failed at dispatch: with this cause, before
        // the interrupt settles the turn as merely "interrupted".
        opts?.onDispatchError?.(message);
        void interruptDirectThread(bot.id, threadId).catch(() => {});
      };

      /** A lazily claimed remote desktop (the VPS, the bot's Boat) streams
       * from the moment its claim lands. The dispatch-site poller start saw
       * no capture (the claim runs after dispatch), so restart the poller
       * with this one, keeping any browser capture and whether this turn
       * already touched its screen. Same still-running guard as dispatch: a
       * poller started after its own turn.completed would never stop. */
      const adoptClaimedCapture = (capture: () => Promise<{ png: string; format: string }>) => {
        previewCapture = capture;
        if (!threadBusy(bot.id, threadId)) return;
        const touched = screenPollers.get(threadId)?.touched ?? false;
        stopScreenPoller(bot.id, threadId);
        startScreenPoller(
          bot.id,
          threadId,
          { computer: capture, ...(browserCapture ? { browser: browserCapture } : {}) },
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
          const poolCandidate = poolLocalVmTarget(localVmSeatPool.candidate(threadId, localVmPoolSeatHolder));
          if (!localVmSeen.has(poolCandidate.key) && !opts?.automationSource) return false;
        }
        const localVmTarget = { ...localVmTargetForThread(bot.id, threadId) };
        let lazyReadyVm: { runtime: Runtime } | null = null;
        if (!strict) {
          // Nothing this process has ever seen for this target, and nobody is
          // relying on an unattended run: do not pay for a runtime probe.
          if (!localVmSeen.has(localVmTarget.key) && !opts?.automationSource) return false;
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
            integrations.localComputer = containerComputerMcp(
              lazyReadyVm.runtime,
              controlIntegration(bot.id, threadId, dispatchClaimId),
              localVmTarget,
            );
            autoVmClaims.set(threadId, {
              owner: resourceOwner,
              lazy: true,
              label: "the Local VM",
              localVm: true,
              onRejected: surfaceLazyClaimRejection("the Local VM"),
              claim: async () => {
                await claimAutoLocalVm(threadId, localVmTarget);
                // The dispatch-site poller start saw a null previewCapture
                // (this lazy mount runs before any claim exists), so this
                // turn would publish no live `screen` events and settle no
                // final computer frame. Restart the poller with the now-live
                // computer capture, keeping any browser capture and whether
                // this turn already touched its screen. Same still-running
                // guard as dispatch: a poller started after its own
                // turn.completed would never be torn down.
                if (previewCapture && threadBusy(bot.id, threadId)) {
                  const touched = screenPollers.get(threadId)?.touched ?? false;
                  stopScreenPoller(bot.id, threadId);
                  startScreenPoller(
                    bot.id,
                    threadId,
                    { computer: previewCapture, ...(browserCapture ? { browser: browserCapture } : {}) },
                    { screenIsTheWork: touched },
                  );
                }
              }
            });
            return true;
          }
          const claimed = await claimAutoLocalVm(threadId);
          integrations.localComputer = containerComputerMcp(
            claimed.runtime,
            controlIntegration(bot.id, threadId, dispatchClaimId),
            claimed.target,
          );
          // Hand the same claim to the first-screen-call gate. This eager
          // path has already claimed, so the gate's fire-once call can only
          // re-assert the same owner — a no-op (issue #1361).
          autoVmClaims.set(threadId, {
            owner: resourceOwner,
            label: "the Local VM",
            claim: async () => { await claimAutoLocalVm(threadId); }
          });
          return true;
        } catch (error) {
          // A wait ceiling settled this turn as parked, not as an unavailable
          // Auto destination. Let dispatch register its resume instead of
          // continuing the provider without the requested computer.
          if (strict || error instanceof ComputerWaitParked) throw error;
          if (directTurnGenerationByThread.get(threadId) === dispatchClaimId) releaseLocalVmThread(threadId);
          return false;
        }
      };
      // An explicit place that cannot be attached fails the turn with its
      // cause and the next action; it never quietly moves the work elsewhere.
      try {
        if (wants === "vm") {
          if (await attachLocalVm(true)) computerKind = "vm";
        } else if (wants === "local") {
          integrations.localComputer = await mountHostComputer(
            resourceOwner, bot.id, mountsLocalComputer, surfaceLazyClaimRejection("this computer"),
            savedSteps.journals(directRequestOwners.get(threadId)),
          );
          computerKind = "local";
        }

        // A VPS is a local-agent computer mount, never a remote agent runner.
        // Explicit Cloud may prepare/start it. Auto remains read-only unless
        // the person explicitly opted this bot into remote lifecycle actions.
        // On Auto an engine that cannot use a computer simply skips it.
        if ((wants === "cloud" || (wants === undefined && managedPolicy.computerAllowed("vps"))) && cloudBackend === "vps" &&
            canWorkOnCloud(cloudEngine(instance))) {
          // The VPS "computer" is the desktop inside this bot's managed
          // container, and only screen work needs that desktop to itself.
          // So the lease is claimed on the first computer call, through the
          // computer-control gate (the Local VM's seam, #1361), never at
          // mount: a bot's turns that never touch the computer tools run
          // side by side, and its 3-hourly routine no longer queues behind
          // — or fails after 30 minutes behind — its own long-running task.
          // Container lifecycle (provision, start) is serialized by the
          // runner's per-container lock, not by this turn.
          vpsThreadStarted(bot.id, threadId);
          const mounted = await mountBotVps(bot, resourceOwner, {
            start: vps.vpsStartsForTurn({ wants, autoStartVps: bot.autoStartVps, automationSource: opts?.automationSource }),
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
            if (wants === "cloud") throw error;
            return { problem: error instanceof Error ? error.message : String(error), reachable: undefined };
          });
          if ("integration" in mounted) {
            integrations.localComputer = mounted.integration;
            computerKind = "vps";
          } else {
            vpsThreadEnded(bot.id, threadId);
            if (wants === "cloud") {
              throw new Error(mounted.problem ?? "the VPS computer could not be created or reached");
            }
            autoVpsProblem = mounted.problem ?? "the VPS computer could not be reached";
            autoVpsReachable = mounted.reachable;
          }
        }

        if (teamComputer) {
          const attached = await attachTeamBoat(teamComputer, bot.id, resourceOwner, canWorkOnCloud(cloudEngine(instance)));
          Object.assign(integrations, attached.mount);
          previewCapture = attached.capture;
          computerKind = "box";
        }
        // Cloud is strict when selected. A turn reaches the Boat only when
        // this conversation is on it (Works on, a pin, a cloud routine, or
        // select_computer): an Auto turn never reads the Boat account, so it
        // adds no Boat call, cannot be stopped by a Boat being deleted, and
        // never records a place nobody chose. Even then the Boat is created
        // or woken only by the bot's first computer call (mountBotBoat): a
        // chat that never touches the screen uses no plan hours.
        if (!teamComputer && cloudBackend === "box" && boat.boatConfigured(cfg) && wants === "cloud") {
          integrations.localComputer = mountBotBoat(bot, resourceOwner, {
            // The row a failed attach always wrote: the place's one line and
            // its one way on, read where the place came from (an
            // Auto-recorded pin is cleared, as dispatch clears it).
            source: placeSource,
            onClaimed: adoptClaimedCapture,
            onRejected: surfaceLazyClaimRejection("the cloud computer")
          });
          computerKind = "box";
        }
        if (wants === "cloud" && cloudBackend === "box" && !boat.boatConfigured(cfg)) {
          throw boatNotConfigured(bot, placeSource ?? "works-on");
        }
        if (wants === "cloud" && cloudBackend === "box" && computerKind !== "box") {
          throw new Error("the cloud computer could not be created or reached");
        }
      } catch (error) {
        // Auto, Off and a team's shared computer name no place; they fail as
        // they are.
        skipComputer(!namedPlace || !placeSource ? error : await asPlaceFailure(error, namedPlace, placeSource, bot, cloudBackend));
      }

      // Auto-only host fallback. Electron owns cua-driver/TCC attribution;
      // the harness only reads its already-running connection descriptor.
      // Auto reaches a Local VM this bot already has before it ever touches the
      // host's own desktop: on a headless server that VM is the only desktop
      // there is, and a person who prepared one meant it to be used.
      if (wants === undefined && !integrations.localComputer && !computerPlaceRefusal("localVm") && await attachLocalVm(false)) computerKind = "vm";
      // An unattended run on a bot with a VPS configured never lands on the
      // host's own desktop instead: a scheduled job clicking on someone's
      // laptop is worse than a scheduled job that fails and says why.
      const unattendedVps = cloudBackend === "vps" && Boolean(opts?.automationSource);
      if (
        !integrations.localComputer &&
        wants === undefined &&
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
          autoVmClaims.set(threadId, {
            owner: resourceOwner,
            lazy: true,
            label: "this computer",
            onRejected: surfaceLazyClaimRejection("this computer"),
            claim: async () => {
              await bindTurnComputer(resourceOwner, HOST_COMPUTER_RESOURCE, true);
            }
          });
          integrations.localComputer = gatedLocalComputer(
            cua, controlIntegration(bot.id, threadId, dispatchClaimId, "this computer"),
            savedSteps.journals(directRequestOwners.get(threadId)),
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
        wants === undefined &&
        cloudBackend === "vps" &&
        !integrations.localComputer &&
        autoVpsProblem &&
        !computerSelectionTurns.has(threadId)
      ) {
        const hint = vps.vpsUnavailableHint({ automationSource: opts?.automationSource, autoStartVps: bot.autoStartVps, reachable: autoVpsReachable });
        if (opts?.automationSource) skipComputer(new Error(`${autoVpsProblem}. ${hint}`));
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
      const sectionPeers = reachablePeers(store.bots, bot);
      if (agentsMounted) {
        // Only a direct human request can create separate self-owned jobs.
        // Coordinated children and self-opened jobs stay inside their scope;
        // a later real user message on the same task is a fresh request.
        const origin = opts?.cardContinuation
          ? store.activePath(threadId).findLast((message: any) => message.role === "user" && message.kind === "text")
          : userMessage;
        const ownThreadCreation = boundedCoordination && !coordinated && Boolean(origin && !origin.peerAsk);
        integrations.agents = agentsIntegration(bot.id, threadId, commsDepth, skillAuthoring, dispatchClaimId, opts?.coordination?.id, boundedCoordination, ownThreadCreation, worksInWorkspace, !engineHasNativeWebSearch(instance.driverKind, withholdHostToolsFor(instance), model));
      }
      if (instance.adapter.capabilities.hooks === true && hooksEnabled()) {
        integrations.hooks = hooksIntegration(bot.id, threadId, dispatchClaimId);
        void runLifecycleEvent(bot.id, threadId, "before_submit_prompt", {}).catch(() => {});
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit coordination nudge. The agent still chooses the matching
      // peer tool, so the harness stays the single owner of turns/permissions.
      const tagged = integrations.agents && !peerHop
        ? mentionedBots(
            providerText,
            sectionPeers,
          )
        : [];
      // A person's request that names a teammate: its engine starts now, in
      // the work thread coordinate_bots would use, so the delegation does not
      // wait for a cold start (perf round 3).
      if (!warmOnly && integrations.agents && boundedCoordination && !commsDepth && !opts?.coordination && !store.groupByThread(threadId)) {
        prewarmNamedTeammates(bot, threadId, namedTeammates(providerText, sectionPeers, tagged));
      }
      const coordinationPrompt = bot.chiefOfStaff
        ? chiefOfStaffSystemPrompt(
            bot.id,
            store.bots,
            Boolean(integrations.agents) && !peerHop,
            boundedCoordination,
          )
        : integrations.agents && !peerHop && sectionPeers.length > 0
          // Ordinary bots could always CALL the peer tools; until now the
          // one generic sentence they got never named a teammate, so the
          // first move of any collaboration was a list_bots round trip the
          // model mostly did not think to make.
          ? peerRosterSystemPrompt(sectionPeers, boundedCoordination, botCreationOffered(bot, ownerBotsReadOnly(bot)), sameOwnerRosterMember(bot))
          : "";
      const credentialPrompt = integrations.agents ? CREDENTIAL_PROMPT + (boundedCoordination || peerHop ? "" : THREADS_PROMPT) + WIDGET_PROMPT + WIDGET_APPROVAL_PROMPT : "";
      const routinePrompt = integrations.agents ? ROUTINE_PROMPT : "";
      const profilePrompt = integrations.agents ? botProfilePrompt(bot) : "";
      const recallPrompt = integrations.agents && bot.memoryEnabled !== false ? SESSION_SEARCH_SYSTEM_PROMPT : "";
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
        const before = await checkpoints.snapshot(bot.id, checkpointCwd, `turn ${threadId.slice(0, 8)}`, undefined, { pin: dispatchClaimId });
        if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) {
          if (before) void checkpoints.release(bot.id, checkpointCwd, dispatchClaimId);
          throw new DirectTurnSetupCancelled("turn stopped during checkpoint");
        }
        forgetTurnCheckpoint(threadId);
        if (before) turnCheckpoints.set(threadId, { botId: bot.id, cwd: checkpointCwd, hash: before, pin: dispatchClaimId });
      }
      if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) {
        throw new DirectTurnSetupCancelled("turn stopped before dispatch");
      }
      // Mint the browser bearer at the last possible moment. The desktop
      // registration is asynchronous, so validate this exact setup claim
      // again inside browserIntegration before the capability is published.
      // Also the one bot snapshot setupModeActive and the prompt's soul
      // (below) share, so a soul saved mid-dispatch is seen by both instead
      // of the two disagreeing about whether setup mode is still active.
      const liveBot = store.bot(bot.id);
      const setupMode =
        peerToolsMounted &&
        setupModeActive({
          soul: liveBot?.soul ?? bot.soul,
          description: liveBot?.description ?? bot.description,
          text: providerText
        });
      if (liveBot && instance.adapter.capabilities.dataMcp === true) {
        const data = dataIntegration(bot.id, { threadId, generation: dispatchClaimId });
        if (data) integrations.data = data;
      }
      // One place per turn. On Auto the branches above may have reached a
      // computer; then the built-in browser stays unmounted and web work
      // happens in that computer's own browser. Not on this computer, the
      // person's own screen (2026-10-28): the built-in browser stays beside
      // it, so a lookup never opens a window in front of them
      // (HOST_SCREEN_RULE in server/surface.ts).
      const mountedComputer = surfaceOfComputerKind(computerKind);
      if (computerKind === "local") hostScreenTurns.set(threadId, { botId: bot.id, generation: dispatchClaimId });
      else hostScreenTurns.delete(threadId);
      if (
        liveBot &&
        plan.browser &&
        !(plan.computer === undefined && mountedComputer && mountedComputer !== "local") &&
        // On the person's computer, web pages open in their own browser
        // (sagax-desktop browse), on their network, not on this server.
        // Auto keeps the built-in browser: it is one of the places it picks.
        !(turnPlace.target === "user-desktop" && !turnAuto?.auto && integrations.custom?.[DESKTOP_BRIDGE_MCP_NAME]) &&
        builtInBrowserEnabled(cfg) &&
        liveBot.browser !== false &&
        instance.adapter.capabilities.browserMcp === true
      ) {
        const selectedProfile = liveBot.browserProfile;
        browser = await browserIntegration(bot.id, selectedProfile, { threadId, generation: dispatchClaimId });
        if (browser) integrations.browser = browser.integration;
        // The browser lost its frame source when the Electron surface was
        // removed: previewCapture is set by the computer branches above, and
        // nothing replaced it here. A bot with only a browser was pictured
        // not at all; a bot with both was pictured on its desktop even while
        // the work was a web page, because agent-browser runs its own headless
        // Chrome on the host rather than inside that desktop.
        if (browser) {
          const frame = { binaryPath: browser.spec.command, env: browser.spec.env };
          const session = browser.session;
          // The preview shares the profile with tool calls: claim the same
          // exclusive browser:<session> resource the tools/call path claims,
          // and skip the frame while another thread holds it.
          browserCapture = async () => {
            const owner = turnResourceOwners.get(threadId);
            if (!owner || !claimTurnResource(owner, `browser:${session}`)) throw new Error("another thread is using this browser");
            return browserRuntime.previewFrame(session, () => agentBrowserFrame(frame));
          };
        }
      }
      // Auto remembers no place (2026-10-16): where this turn works, the
      // built-in browser or a computer it claims, is never written to the
      // conversation. The next message decides again; only the person's own
      // pin holds a place (honouredPin).
      const computerSelection = computerSelectionTurns.get(threadId);
      if (computerSelection) computerSelection.mounted = mountedComputer ?? (integrations.browser ? "browser" : undefined);
      // A cancelled adapter can be between accepting sendTurn and revealing
      // its provider turn id. Never overlap a replacement with that ambiguous
      // pre-id window: wait for the old handshake to settle or for its bounded
      // quarantine to expire, then revalidate this exact claim before launch.
      // An embedding endpoint the person runs reads this turn's recall query
      // first (bounded, server/semantic-recall.ts), before the claim below
      // is revalidated. Without one nothing is awaited.
      if (bot.memoryEnabled !== false && autoRecallEnabled(cfg) && semanticEmbeddingEndpoint(cfg)) await prepareSemanticRecall(bot.id, recallQuery(resolvedImages.text));
      await pendingCancelledProviderHandshakes.waitForClear(threadId);
      if (!markDirectTurnDispatching(bot.id, dispatchClaimId, threadId)) {
        throw new DirectTurnSetupCancelled("turn stopped before dispatch");
      }
      const computerPromptKind = resolveComputerPromptKind({
        kind: computerKind,
        vmPrivate: localVmMode(cfg) === "per-bot"
      });
      const coordinationNode = opts?.coordination ? coordinator.node(opts.coordination.id) : undefined;
      if (opts?.coordination && (!coordinationNode || coordinationNode.status !== "running" || roomHandoffProblem(coordinationNode,
        coordinationNode.parentId ? coordinator.node(coordinationNode.parentId) : undefined))) {
        throw new DirectTurnSetupCancelled("Coordination access changed before dispatch");
      }
      // Single stream (thread mode off): a person's turn in a stream segment
      // carries the digest of their earlier topics (server/single-stream.ts),
      // never on a call (a phone turn stays short), and those topics leave
      // the recent-work brief so nothing is said twice.
      const streamPart = !onCall && streamTurn(bot, threadId, { person: commsDepth === 0 && !coordinationNode && !opts?.automationSource && !opts?.unattended && !warmOnly && !userMessage.peerAsk })
        ? streamDigestPrompt(bot, threadId) : null;
      if (streamPart?.text) refreshStreamDigests(bot.id, threadId);
      // Stable prefix on every engine. Compact tool list on Claude Code only,
      // local or cloud: Grok, Codex and Pi discover tools from the full list.
      const promptMode = {
        bot: parseLocalPromptMode((liveBot ?? bot).localPrompt),
        engine: parseLocalPromptMode(process.env.SAGAX_LOCAL_PROMPT)
      };
      const stablePrompt = usesStablePrompt(promptMode);
      const compactPrompt = usesCompactPrompt({ ...promptMode, driverKind: instance.driverKind, model })
        ? compactPromptFor(liveBot ?? bot, typeof turnPrincipal === "string" && turnPrincipal ? turnPrincipal : effectiveBotOwner(bot))
        : undefined;
      const promptApprovalLevel = approvalModeForTurn(bot, commsDepth > 0, threadId);
      // Cold / automation turns (routines, webhooks, proactive): tighter
      // per-section budgets, lazy skill index, short rich-output (V1/R3).
      const coldPrompt = opts?.automationSource !== undefined;
      const promptParts = [
        { id: "finish-until", label: "Do not finish until", text: finishUntilPrompt((liveBot ?? bot).finishUntil) },
        // #1372: a 1:1 goal's instruction, while it works; never the person's message
        { id: "goal", label: "Goal", text: soloGoalSystemPrompt(soloGoals.get(threadId)) },
        { id: "user-profile", label: "About the user", text: userProfileSystemPrompt(botUserProfile(bot)) },
        { id: "ai-client", label: "AI client", text: aiClientThreadPerson(bot, threadId, commsDepth, userMessage) },
        { id: "model", label: "Model", text: onCall ? "" : modelPrompt({ engine: engineDisplayName(instance), model: String(model ?? ""), actual: modelFallbackByThread.get(threadId)?.requested === model ? modelFallbackByThread.get(threadId)?.actual : modelFallbackByPayer.get(modelFallbackPayerKey(threadId, instance.instanceId, String(model ?? ""))) }) },
        // first after the soul: the block names agent tools, so it only goes
        // to a turn whose engine actually mounted them (setupMode is already
        // false when they are not — see agentsMounted above)
        { id: "setup", label: "Setup", text: setupSystemPrompt(setupMode, { skills: skillAuthoring, cwd: liveBot?.cwd ?? bot.cwd }) },
        { id: "files", label: "File locations", text: worksInWorkspace ? workspaceLocationsPrompt(bot.id, cwd, liveBot?.cwd ?? bot.cwd, { attachFile: Boolean(integrations.agents) && !HOSTED_WORKSPACE, confidential: store.isConfidentialThread(threadId), relativePaths: instance.driverKind === "claudeAgent", ...(stablePrompt ? { cwdElsewhere: true } : {}) }) : "" },
        // The conversation's own folder, on its own line, so the rest of the
        // file locations is the same bytes in every conversation of this bot.
        { id: "files-cwd", label: "Current working folder", text: stablePrompt && worksInWorkspace ? workspaceCwdPrompt(cwd) : "" },
        { id: "shell", label: "Long-running commands", text: worksInWorkspace ? longCommandsPrompt(computerPromptKind) : "" },
        { id: "computer", label: "Computer", text: computerPrompt(computerPromptKind) },
        { id: "team-computer", label: "Team computer", text: teamComputerPrompt(teamComputer) },
        // Auto's standing rules, volatile: a reused session gets them once;
        // each message carries only where it starts (withWorkplaceNote)
        { id: "workplace", label: "Workspace", text: turnAuto?.auto ? `\n${AUTO_COMPUTER_RULES}` : "" },
        { id: "plan", label: "Surface", text: surfacePrompt({ computer: mountedComputer, browser: Boolean(integrations.browser) }, { pinned: plan.pinned, note: plan.note + vpsUnavailableNote + (computerSkipped && plan.computer !== "off" ? computerSkippedNote(redactSecretsInText(computerSkipped)) : ""), canSelect: computerSelectionTurns.has(threadId) || (warmOnly && maySelectComputer), cloudHome: false }) },
        { id: "cloud-home", label: "OMB Cloud", text: "" },
        // gated on the integration, not the key: the hint only goes to a
        // bot whose driver actually mounted the tools
        { id: "mcp", label: "MCP servers", text: customMcpPrompt(Object.keys(integrations.custom ?? {})) + githubWithheldPrompt(githubWithheld) },
        { id: "perspicax", label: "Perspicax", text: perspicaxPrompt },
        // run_with_engine is shown to a person's own direct turn only (not one hop away)
        { id: "claude-ai", label: "Claude connectors", text: engineConnectorsPromptFor(liveBot ?? bot, instance, speaker, { level: promptApprovalLevel, relay: Boolean(integrations.agents) && commsDepth === 0 }) },
        // the level this turn really runs at (approvalModeForTurn), so Full never asks for a typed GO
        { id: "approval-level", label: "Approval level", text: approvalLevelPrompt(promptApprovalLevel) },
        // #1819: effective ask-before-contact (Full skips the Sagax peer card)
        { id: "peer-contact", label: "Peer contact", text: peerContactPrompt({
          canContact: Boolean(coordinationPrompt),
          asksBeforeContact: peerReviewRequired(liveBot ?? bot, threadId)
        }) },
        // 2026-10-30: the bot knows it is proactive, and how (server/proactive-wake.ts)
        { id: "proactive", label: "Proactive", text: proactivePrompt(proactiveModeFor(liveBot ?? bot)) },
        // what this turn reaches, in one line: "what connectors do you have" needs no tool call (server/turn-reach.ts)
        { id: "reach", label: "Reach", text: turnReachPrompt(liveBot ?? bot, instance, speaker, threadId, integrations, Boolean(mountedComputer)) },
        { id: "browser", label: "Browser", text: integrations.browser ? BUILT_IN_BROWSER_SYSTEM_PROMPT + myChromePromptFor(bot, threadId) : "" },
        { id: "data", label: "Data", text: integrations.data ? BUILT_IN_DATA_SYSTEM_PROMPT : "" },
        { id: "coordination", label: "Team", text: coordinationPrompt ? ` ${coordinationPrompt}` : "" },
        { id: "assignment", label: "Teammate task", text: coordinationNode?.parentId || (warmOnly && opts?.warmCoordination === true) ? `\n${coordinationSystemInstructions()}` : "" },
        { id: "outstanding", label: "Outstanding teammate work", text: outstandingAssignmentsPrompt(threadId) },
        { id: "credential", label: "Credentials", text: credentialPrompt },
        // its own paragraph, so a smaller model reads it as a rule of its
        // own; never on a call (the tools are not shown there either)
        { id: "reactions", label: "Reactions", text: integrations.agents && !onCall ? REACTION_PROMPT : "" },
        { id: "recall", label: "Recall", text: recallPrompt },
        { id: "routine", label: "Routines", text: routinePrompt },
        { id: "routine-execution", label: "Routine execution", text: opts?.automationSource === "schedule" || opts?.automationSource === "manual" ? ROUTINE_EXECUTION_PROMPT : "" },
        { id: "profile", label: "Profile changes", text: profilePrompt },
        { id: "learn", label: "Skill authoring", text: learnPrompt },
        { id: "rich-output", label: "Rich output", text: richOutputPrompt((liveBot ?? bot).emailDrafts !== false) },
        { id: "dev-pods", label: "Coding view", text: devPodsPrompt(devPodsThreads.isOn(threadId)) },
        { id: "section-context", label: "Section context", text: sectionContextSystemPrompt(bot.section) },
        { id: "team-memory", label: "Team memory", text: teamMemory.systemPrompt(bot.section) + (integrations.agents ? TEAM_MEMORY_PROMPT : "") },
        // who on the team roster is busy right now; volatile, so a teammate
        // starting or finishing work never changes the stable half
        teamAvailabilityPart(coordinationPrompt ? sectionPeers : []),
        // what the bot said lately in its other conversations, so a task
        // never redoes — or forgets — what another one already did
        // not on a call: a phone turn stays short (docs/voice-mode-xai.md, "Latency")
        { id: "recent", label: "Recent work", text: onCall ? "" : recentWorkPrompt(recentWorkFor(bot, threadId, { userName: botUserName(bot) }).filter((line: any) => !streamPart?.threadIds.has(line.threadId)).slice(0, compactPrompt ? LOCAL_RECENT_WORK_LINES : undefined)) },
        { id: "stream", label: "Earlier topics", text: streamPart?.text ?? "" },
        // RULES.md: listed here, placed right after the soul by buildSystemPrompt
        { id: "rules", label: "Rules (RULES.md)", text: rulesSystemPrompt(bot.id, { writes: Boolean(integrations.agents) }) },
        { id: "memory", label: "Memory", text: memoryPromptFor(bot, { managedWrites: Boolean(integrations.agents), fileTools: worksInWorkspace, withholdHostTools: withholdHostToolsFor(instance) }) },
        { id: "host-tools", label: "Host tools", text: withholdHostToolsFor(instance) ? WITHHELD_HOST_TOOLS_PROMPT : "" },
        // docs/: an index only, never the documents (server/workspace-files.ts)
        { id: "docs", label: "Documents index", text: docsIndexPrompt(bot.id, { tools: integrations.agents ? "agents" : worksInWorkspace ? "files" : "none" }) },
        // liveBot was captured before awaited setup work; an assignment PUT
        // in that window must still reach this turn's prompt.
        { id: "skills", label: "Skills index", text: scopedSkillsPrompt(bot, instance, orgSpeakerPrincipal(bot, speaker), { managedTools: skillDiscoveryAvailable(Boolean(integrations.agents), toolScope), fileAccess: Boolean(privateWorkspace), syncNative: true, indexOnly: coldPrompt })?.text ?? "" },
        { id: "skill-instructions", label: "Skill instructions", text: coldPrompt ? "" : skillInstructions },
        { id: "playbooks", label: "Playbooks", text: coldPrompt ? "" : packagePlaybooks },
        { id: "webhook", label: "Webhook provenance", text: opts?.automationSource === "webhook" ? WEBHOOK_PROMPT : "" },
        { id: "mentions", label: "Mentions", text: boundedCoordination && tagged.length ? `The user named these existing teammates: ${tagged.map((b: any) => uniquePeerName(b, sectionPeers) ? peerName(b.name) : `${peerName(b.name)} (${b.id})`).join(", ")}. Use coordinate_bots when their contribution is needed (a unique name works as its bot_ids entry), with relay=true when the user only wants one teammate's own answer passed back; do not substitute native helper agents for these bots.` : mentionPrompt(tagged) },
        // a voice call: the phone-call instruction (server/voice-call-prompt.ts)
        { id: "voice-call", label: "Phone call", text: voiceCallText },
      ];
      const builtPrompt = buildSystemPrompt(persona, liveBot?.soul ?? bot.soul ?? "", coldPrompt ? lightenColdPrompt(promptParts) : promptParts, stablePrompt || instance.driverKind === "claudeAgent"
        ? new Set([
          ...(instance.driverKind === "claudeAgent" ? CLAUDE_REUSE_VOLATILE_SECTIONS : []),
          ...(stablePrompt ? COMPACT_VOLATILE_SECTIONS : []),
        ])
        : undefined);
      const prompt = stablePrompt ? compactVolatileOrder(builtPrompt) : builtPrompt;
      turnPromptBytes.set(threadId, { stable: Buffer.byteLength(prompt.stable), volatile: Buffer.byteLength(prompt.volatile) });
      const catalogBytes = toolDefinitionBytes(integrations.agents?.env);
      const buckets = measureContextBuckets({
        sections: prompt.sections,
        promptBytes: Buffer.byteLength(prompt.stable) + Buffer.byteLength(prompt.volatile),
        messages: transcript.length,
        messageBytes: transcript.reduce((sum: any, entry: any) => sum + Buffer.byteLength(entry.text ?? ""), 0),
        toolsBytes: catalogBytes.tools,
        agentsBytes: catalogBytes.agents
      });
      if (buckets) turnContextBuckets.set(threadId, buckets);
      else turnContextBuckets.delete(threadId);
      // the dev panel's Connectors card: what this turn really reached
      if (!warmOnly) store.patchTask(bot.id, threadId, { connectors: turnConnectorsFor(liveBot ?? bot, instance, speaker, integrations, turnPlace.principal, instance.adapter.capabilities.customMcp === true) });
      if (!warmOnly) turnTrace(threadId, "prompt-built");
      // the Files list's "last used": what this turn's prompt carried
      markWorkspaceUse(bot.id, promptSectionPaths(prompt.sections));
      // Automatic recall rides in front of THIS turn's message, never in the
      // system prompt: the volatile half is re-sent whole whenever any part of
      // it changes, and recall changes nearly every turn.
      const recalled = autoRecallPrompt(bot, threadId, resolvedImages.text, {
        // a routine run starts fresh by design, and a webhook is untrusted:
        // neither pulls earlier conversations in. A call turn takes a
        // couple of notes, never other conversations: what the engine
        // reads before it can answer is the pause the person hears.
        conversations: commsDepth === 0 && !coordinationNode && !opts?.automationSource && !opts?.unattended && !onCall,
        userName: botUserName(bot),
        ...(onCall ? { budget: CALL_RECALL_BUDGET } : compactPrompt ? { budget: LOCAL_RECALL_BUDGET } : {})
      });
      runningTurnEngines.set(threadId, instance);
      if (!warmOnly) limitFailover.noteDispatch(threadId, {
        botId: bot.id, engine: { instanceId: instance.instanceId, driverKind: instance.driverKind }, selection: bot.modelSelection,
        payer: autoPayerKey(bot, speaker), ...(ownerPaysForMember(bot, speaker, opts?.trigger?.kind === "user" ? opts.trigger.principalId : opts?.sender?.id) ? { owner: true } : {}), speaker, ...(opts?.trigger ? { trigger: opts.trigger } : {}), at: Date.now(),
        ...(isLocalModelId(bot.modelSelection.model) ? { local: true } : {})
      });
      idleEngines.noteBusy(threadId);
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
      const dispatchedConfig = sessionConfig(liveBot?.soul ?? bot.soul);
      if (strictResume && !voiceView && !(opts?.cardContinuation && continuingRoutine) && dispatchedConfig !== plannedConfig) dispatchContext = decideContext(dispatchedConfig);
      // Before sendTurn: an adapter may emit the whole turn before it resolves.
      if (!warmOnly) handoffs.dispatching(threadId, dispatchClaimId, dispatchContext.handoff);
      // Read receipts (server/read-receipts.ts): the person's words this turn
      // carries are what the bot has now seen. A card continuation carries
      // none of its own: it sees the conversation it resumes.
      if (!warmOnly) {
        const carriedIds = [userMessage.id, ...(opts?.excludeMessageIds ?? [])];
        const textIds = new Set(activeMessages.filter((m: any) => m.kind === "text" && !m.roomRequest).map((m: any) => m.id));
        noteBotRead(bot.id, threadId, carriedIds.some((id) => textIds.has(id)) ? carriedIds : contextOrder.filter((id: any) => textIds.has(id)));
      }
      // Slice 4: this turn's credentials (an owner key is read now).
      // (solo mode takes no extra await: its dispatch timing is unchanged)
      const turnAccess = IDENTITY.kind === "perspicax" ? await orgTurnAccess(threadId, bot, instance, speaker, bot.modelSelection.model) : undefined;
      if (!warmOnly) turnTrace(threadId, "access");
      // An engine slash command typed by a person (or set in a routine)
      // reaches the engine verbatim (server/harness-commands.ts); a peer hop
      // or a card continuation never runs one.
      const typedCommand = !opts?.cardContinuation && commsDepth === 0
        ? await typedCommandForTurn(resolvedImages.text, harnessCommandSource(bot, threadId, {
          scope: {
            botId: bot.id,
            ...(cwd ? { cwd } : {}),
            ...(withholdHostToolsFor(instance) ? { withholdHostTools: true } : {}),
            mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp()
          },
          speaker,
          ...(turnAccess ? { access: turnAccess } : {})
        }), harnessCommands)
        : { kind: "none" as const };
      if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) throw new DirectTurnSetupCancelled("turn stopped during command lookup");
      if (!warmOnly) turnTrace(threadId, "command");
      const engineCommand = typedCommand.kind === "engine" ? typedCommand : null;
      // With no session to resume, the command runs in a new one that never
      // saw the conversation: the next turn must still rebuild it, so the
      // bookkeeping that would mark the context delivered is left for it.
      const contextStillPending = Boolean(engineCommand && dispatchContext.sessionReset && transcript.length > 0 &&
        !replaysNatively(instance.driverKind));
      if (!warmOnly) voiceLatency.mark(threadId, "dispatch", voiceView ? { run: {
        model: voiceTurnPick?.modelLabel ?? String(model ?? ""),
        contextBytes: Buffer.byteLength(dispatchContext.turnText),
        session: voiceBriefed ? "new" : "resumed"
      } } : undefined);
      // A call turn (and the warm that prepares its process, so the two share
      // one spawn contract) runs at the engine's low effort: the person is
      // waiting for the first word (server/voice-call-effort.ts).
      // A pre-warm off a call (server/thread-prewarm.ts) takes the next
      // turn's own effort and flags, or the turn would relaunch it.
      const turnEffort = onCall
        ? callTurnEffort({ driverKind: instance.driverKind, levels: instance.adapter.capabilities.effortLevels, effort })
        : resolveEngineTurnEffort(effort, instance.driverKind, instance.adapter.capabilities.effortLevels);
      // A routine run while the server boots waits for an engine start slot
      // (server/engine-start-gate.ts): the runs that came due during a
      // restart start two at a time instead of every engine at once.
      // After boot, routine turns keep a steady limit (SAGAX_ROUTINE_ENGINE_SLOTS)
      // and wait while memory is critical (server/engine-memory-guard.ts).
      // A card continuation of a routine is not held by the steady gate: it
      // may be the peer a slot holder waits on (no deadlock).
      if (opts?.automationSource && !warmOnly && !onCall && (engineStartGate.booting || !opts?.cardContinuation)) {
        await holdBootEngineSlot(threadId, `${bot.name} (${instance.driverKind})`, instance);
        turnTrace(threadId, "engine-slot");
        if (!directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId)) throw new DirectTurnSetupCancelled("turn stopped while waiting for an engine slot");
      }
      if (!warmOnly && typeof userMessage.at === "number") noteTurnQueued(threadId, userMessage.at);
      if (!warmOnly) turnTrace(threadId, "send");
      // Each picture within the model's limits: a scaled copy for a large one.
      const modelImages = await fitTurnImagesForModel(turnImages, { language: languageOfPerson(turnPlace.principal) });
      // #1137: when the owner pays, the owner's computer serves its model.
      const deskPerson = desktopModelPersonFor(bot, instance, speaker, turnPlace.principal);
      const dispatch = await guardTurnDispatch(withDesktopModelPerson(deskPerson, () => runAsBotEngine(bot.id, () => {
        if (IDENTITY.kind === "perspicax") desktopLocalModels.assertAvailable(deskPerson, model, instance.driverKind);
        const replayRequest = personLine && !opts?.unattended && !guestConfined
          ? { botId: bot.id, message: userMessage, turnText: text, placePicked: wants === "local" && placeSource !== "auto-pin" }
          : null;
        return savedSteps.dispatch.sendTurn(instance, replayRequest, {
        threadId,
        botId: bot.id,
        ...(compactPrompt ? { compactPrompt } : {}),
        // the per-turn latency line's queue stage (drivers/acp/turn-latency.ts)
        ...(!warmOnly && typeof userMessage.at === "number" ? { receivedAt: userMessage.at } : {}),
        ...(turnAccess ? { access: turnAccess } : {}),
        // on a live call the engine process stays warm from turn to turn.
        // A warm uses the same flag so the first spoken turn's contract matches.
        ...(onCall ? { keepWarm: true } : {}),
        ...(warmOnly ? { warmOnly: true, ...(onCall ? { cachePrime: true } : {}), ...(opts?.warmSignal ? { warmSignal: opts.warmSignal } : {}) } : {}),
        startupRecovery: !warmOnly &&
          (opts?.automaticRecoveryIndex ?? 0) < botRecoveryBackups(liveBot ?? bot, cfg).length,
        text: warmOnly ? "" : (engineCommand ? engineCommand.engineText : withRecalled(recalled, dispatchContext.turnText)),
        ...(engineCommand ? { harnessCommand: { name: engineCommand.command.name, args: engineCommand.args, ...(engineCommand.command.path ? { path: engineCommand.command.path } : {}) } } : {}),
        ...(recalled && !warmOnly && !engineCommand ? { recalled } : {}),
        images: modelImages,
        approvalMode: engineTurnLevel(bot, threadId, auditFullAccessTurn(bot, threadId, approvalModeForTurn(bot, commsDepth > 0, threadId))),
        toolScope,
        ...(guestConfined ? { guestConfined: true, confinedWhy: confinedWhy(threadId) } : {}),
        model,
        effort: turnEffort,
        variant,
        // a rewound thread never resumes the abandoned branch's session
        // the active task's own session — another task's cursor would
        // resume the wrong conversation and defeat the context bubble
        resumeCursor: dispatchContext.resumeCursor,
        sessionReset: dispatchContext.sessionReset,
        ...(dispatchContext.recoveryText !== undefined && !engineCommand ? { recoveryText: dispatchContext.recoveryText } : {}),
        transcript: voiceView ? voiceView.transcript : transcript,
        // #1276: a compact prompt sends the stable half first and what differs
        // between conversations last, for an engine that takes the prompt
        // whole (pi without a session); same sections, nothing dropped.
        system: compactPrompt ? prompt.stable + prompt.volatile : prompt.text,
        systemStable: prompt.stable,
        systemVolatile: prompt.volatile,
        systemVolatileSections: prompt.volatileSections,
        // the mentions half describes this turn: identical consecutive tags
        // must still deliver their note (SendTurnInput.mentionTurn)
        // and so does an interrupted call turn's marker
        mentionTurn: tagged.length > 0 || Boolean(userMessage.voiceCall?.interrupted),
        integrations,
        ...(withholdHostToolsFor(instance) ? { withholdHostTools: true } : {}),
        ...turnCommandEnvironment(instance, bot.id, threadId),
        toolErrorCorrectiveRounds: toolErrorCorrectiveRoundsFor(cfg, process.env, { botEnabled: bot.loopGuard }),
        // Auto may leave their computer mid-turn: the engine's own traffic
        // goes through it only when the Workspace is fixed there.
        ...(() => { const networkProxy = turnAuto?.auto ? undefined : turnNetworkProxy(threadId, bot.id, turnPlace); return networkProxy ? { networkProxy } : {}; })(),
        ...(integrations.browser && browserIsThePlace(plan) ? { preloadBrowserTools: true } : {}),
        mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp(),
        claudeAiConnectors: claudeAiConnectorsFor(bot, instance, speaker, turnAccess?.via),
        grokCloudConnectors: grokCloudConnectorsForTurn(accountConnectorInput(bot, instance, speaker, turnAccess?.via)),
        ...pluginDirsFor(bot, instance, orgSpeakerPrincipal(bot, speaker)),
        mcpCallTimeoutMs: mcpCallTimeoutMinutes(cfg) * 60_000,
        cwd
      }, (input: any) => instance.adapter.sendTurn(input));
      })), () => !directTurnClaimExists(bot.id, dispatchClaimId, threadId), async () => {
        await instance.adapter.interruptTurn(threadId).catch(() => {});
      });
      if (warmOnly) {
        // A duplex interrupt while the person is still talking cancels this
        // claim: there is no spoken turn yet, and releasing the process
        // would make the first words pay a cold start. Hangup aborts the
        // signal and is the path that closes it. The interrupt also
        // quarantines this handshake for 30s; the warm has no provider
        // turn id to retire, so leaving the mark would hold the first
        // utterance until it expired.
        clearCancelledProviderHandshake(threadId, `direct:${dispatchClaimId}`);
        if (opts?.warmSignal?.aborted) instance.adapter.releaseWarmSession?.(threadId);
        else {
          warmOk = true;
          // The HTTP pool is already warm from GET /models. One 1-token
          // completion on the opener's model opens the chat path and, when
          // the prompt is long enough for the provider, writes the prefix.
          // Not awaited: the call's first turn does not wait on it.
          if (instance.driverKind === "grok" && instance.generateText) {
            const fast = pickFastSentenceModel(instance.models.options.map((option: any) => option.id));
            if (fast) {
              void instance.generateText(".", {
                system: VOICE_FIRST_SENTENCE_SYSTEM,
                model: fast,
                maxTokens: 1
              }).catch(() => undefined);
            }
          }
        }
        return;
      }

      if (dispatch.cancelled) {
        retireProviderTurn(dispatch.value.turnId);
        throw new DirectTurnSetupCancelled("turn stopped during provider setup");
      }
      voiceLatency.mark(threadId, "engine", { warm: dispatch.value.reused === true });
      const requestOwner = directRequestOwners.get(threadId);
      if (requestOwner?.generation === dispatchClaimId && dispatch.value.turnId) {
        if (requestOwner.turnId && requestOwner.turnId !== dispatch.value.turnId) {
          requestOwner.messageId = undefined;
          requestOwner.origin = undefined;
        }
        requestOwner.turnId = dispatch.value.turnId;
      }
      bindInternalCapabilityToProviderTurn(threadId, dispatchClaimId, dispatch.value.turnId);
      handoffs.bindTurn(threadId, dispatchClaimId, dispatch.value.turnId);
      if (directFollowupSettlers.has(dispatchClaimId) && dispatch.value.turnId &&
        !directFollowupTurns.bind(threadId, dispatchClaimId, dispatch.value.turnId)) {
        // This exact queued turn completed before its dispatch ACK arrived.
        const outcome = directFollowupTurns.takeEarlyCompletion(threadId, dispatch.value.turnId);
        if (outcome) settleDirectCoordination(dispatchClaimId, outcome);
        settleDirectFollowup(dispatchClaimId);
      }
      clearDirectTurnDispatch(threadId, dispatchClaimId);
      // dispatched: the rewind is spent, and the old cursors are dead
      // A call turn ran in its own session: the conversation's session keeps
      // its pending rebuild and learns what the call said on its next turn.
      if (voiceView) {
        voiceSessions.dispatched(threadId, voiceHanded, voiceAnchor);
        if (!warmOnly) noteCallBesideConversation(bot, threadId, contextOrder[contextOrder.indexOf(userMessage.id) - 1]);
      }
      if (rewound && !contextStillPending && !voiceView) store.patchTask(bot.id, threadId, { rewound: false, resumeCursors: {} });
      if (contextReset && record && !contextStillPending && !voiceView) store.patchTask(bot.id, threadId, { appliedCompactionId: record.id, contextFloor: undefined });
      // and this engine now owns the thread's most recent turn
      // Consume exactly the external-update generation this turn replayed.
      // If a newer delegated result landed during setup, its unique marker
      // differs and must survive so the next turn also receives that update.
      if (!contextStillPending && !voiceView && (!isExternalContextMarker(task.lastInstanceId) || task.lastInstanceId === externalContextMarker)) {
        store.markTaskDispatched(bot.id, threadId, instanceId);
      }
      // a turn can settle before dispatch returns, and a poller started
      // after its own turn.completed would never be torn down — it would
      // keep polling the boat forever, carrying dead per-turn state. busy
      // is flipped false in the fold, so it is the honest "still running".
      if ((previewCapture || browserCapture) && threadBusy(bot.id, threadId)) {
        startScreenPoller(
          bot.id,
          threadId,
          { ...(previewCapture ? { computer: previewCapture } : {}), ...(browserCapture ? { browser: browserCapture } : {}) },
        );
      }
      // An adapter may publish completion synchronously just before its
      // dispatch promise resolves. The event could not use the turn-id map
      // above yet, so close this exact generation from durable busy state.
      if (!threadBusy(bot.id, threadId) && directTurnGenerationByThread.get(threadId) === dispatchClaimId) {
        revokeInternalCapabilityGeneration(threadId, dispatchClaimId);
        if (settlingResourceOwners.get(threadId) !== dispatchClaimId) releaseTurnResources(resourceOwner);
        retryDelegationsWaitingOn(bot.id);
        drainQueuedSends();
        drainComputerResumes();
        drainSecretResumes();
        drainTeamSetupResumes();
        drainDelegationWakes();
      }
    } catch (cause: any) {
let e: any = cause;
      // Only the driver can prove that a task was never submitted and its
      // old process is gone. A timeout/error string alone is not that proof.
      const mayRecover = e instanceof TurnNotStartedError &&
        directTurnClaimIsCurrent(bot.id, dispatchClaimId, threadId);
      if (e instanceof TurnNotStartedError) {
        retireProviderTurn(e.turnId);
        if (!mayRecover) e = new DirectTurnSetupCancelled("turn stopped during provider setup");
      }
      handoffs.abandon(threadId, dispatchClaimId);
      if (computerSelectionTurns.get(threadId)?.generation === dispatchClaimId) computerSelectionTurns.delete(threadId);
      clearCancelledProviderHandshake(threadId, `direct:${dispatchClaimId}`);
      clearDirectTurnDispatch(threadId, dispatchClaimId);
      revokeInternalCapabilityGeneration(threadId, dispatchClaimId);
      const ownsLatestGeneration = directTurnGenerationByThread.get(threadId) === dispatchClaimId;
      releaseTurnResources(resourceOwner);
      if (ownsLatestGeneration) {
        runningTurnEngines.delete(threadId);
        endMemoryTurn(threadId);
        releasePlain(turnHolder(threadId));
        clearTurnDigestState(threadId);
        releaseLocalVmThread(threadId);
        vpsThreadEnded(bot.id, threadId);
        watchdog.settle(threadId);
        turnUsage.delete(threadId);
        turnContext.delete(threadId);
      }
      if (e instanceof DirectTurnSetupCancelled) {
        settleDirectFollowup(dispatchClaimId, { ok: false, text: e.message });
        opts?.onDispatchError?.(e.message);
        if (ownsLatestGeneration && threadBusy(bot.id, threadId)) {
          store.setTaskActivity(bot.id, threadId, "idle");
          directTurnBots.delete(threadId);
          retryDelegationsWaitingOn(bot.id);
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
        settleDirectFollowup(dispatchClaimId, { ok: false, text: e instanceof Error ? e.message : String(e) });
        return;
      }
      if (e instanceof ComputerWaitParked) {
        settleDirectFollowup(dispatchClaimId, { ok: false, text: e.message });
        registerComputerResume({
          botId: bot.id,
          threadId,
          resource: e.resource,
          generation: e.generation,
          afterMessageId: store.activePath(threadId).findLast((entry: any) => entry.role === "user")?.id
        });
        // Settled as parked, not failed (#1651): the chip the wait appended
        // is the whole transcript story, and the registered resume owns what
        // happens next on this thread.
        if (store.taskByThread(bot.id, threadId)?.activity !== "dead") {
          store.setTaskActivity(bot.id, threadId, "parked.computer");
        }
        directTurnBots.delete(threadId);
        retryDelegationsWaitingOn(bot.id);
        drainQueuedSends();
        drainComputerResumes();
        drainSecretResumes();
        drainTeamSetupResumes();
        drainDelegationWakes();
        return;
      }
      // A failed place never sticks; a person's pin stays, and the message
      // names the composer.
      if (e instanceof PlaceUnavailableError) clearFailedAutoPin(bot.id, threadId, e.place);
      let message = e instanceof Error ? e.message : String(e);
      // Auto: an engine that refused to start this pick is skipped for this
      // payer, and the turn climbs the fallback chain once. A second
      // refusal is the engine's own error, below.
      if (mayRecover && autoTurn) {
        const refused = { instanceId, model };
        // Only a real "this model is not yours" is remembered; a network
        // blip or a rate limit is not held against the model.
        if (isModelRefusal(message)) rememberAutoRefusal(autoTurn.payer, refused);
        const next = opts?.autoRetried ? null : nextInChain(autoTurn.pick, refused);
        if (next && !directRequestOwners.get(threadId)?.stopped && !hasQueuedSteeredMessages(bot.id, threadId) &&
            store.activePath(threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id === recoveryUserMessageId) {
          store.setTaskActivity(bot.id, threadId, "idle");
          directTurnBots.delete(threadId);
          store.appendMessage(threadId, { role: "bot", kind: "activity", tool: {
            name: `notice: Auto: ${engineDisplayName(instance)} could not start ${autoTurn.pick.modelLabel}. Trying the next model once.`, ok: true
          } });
          try {
            await startTurn(bot.id, text, { ...opts, threadId, userMessage, editedMessageId: undefined,
              autoRetried: true, autoSkip: [...(opts?.autoSkip ?? []), refused] });
            directFollowupSettlers.delete(dispatchClaimId);
            directCoordinationSettlers.delete(dispatchClaimId);
            return;
          } catch (failure) {
            message += ` Auto could not start the next model: ${failure instanceof Error ? failure.message : String(failure)}`;
          }
        }
      }
      const current = store.projectBotForTask(bot.id, threadId);
      // The bot's own recovery setting (server/bot-runtime-settings.ts).
      const backups = botRecoveryBackups(current, cfg);
      const nextIndex = backups.findIndex((candidate: any, index: any) => index >= (opts?.automaticRecoveryIndex ?? 0) &&
        registry.get(candidate.instanceId)?.enabled && !orgEngineTurnRefusal(bot, registry.get(candidate.instanceId)!, opts?.speaker ?? { origin: "person" }) &&
        (!(e instanceof TurnAuthenticationRefusedError) || candidate.instanceId !== instanceId) &&
        (candidate.instanceId !== instanceId || candidate.model !== model));
      const backup = backups[nextIndex];
      if (mayRecover && backup && current && (!opts?.cardContinuation || opts.coordination) &&
          !directRequestOwners.get(threadId)?.stopped && !hasQueuedSteeredMessages(bot.id, threadId) &&
          // Unchanged since this turn began: an Auto turn compares the thread's
          // own selection (Auto and its base), not the pick it ran on.
          JSON.stringify(current.modelSelection) === JSON.stringify(autoTurn ? autoBaseSelection : bot.modelSelection) &&
          (backup.instanceId !== instanceId || backup.model !== model) &&
          store.activePath(threadId).findLast((m: any) => m.role === "user" && m.kind === "text")?.id === recoveryUserMessageId) {
        // No await between releasing the failed attempt and admitting its
        // replacement: a newer send or Stop must never lose to a stale retry.
        store.setTaskActivity(bot.id, threadId, "idle");
        directTurnBots.delete(threadId);
        const checked = checkedTaskModelSwitch(current, backup, false, true);
        const target = checked.ok ? registry.get(checked.selection.instanceId) : null;
        const refusal = !checked.ok ? checked.error : !target || !target.enabled ? "The backup engine is unavailable."
          : !store.taskByThread(bot.id, threadId)?.cwd ? "This older thread has no pinned working folder. Choose its backup manually."
          : policyModelRefusal(target) ?? recoveryCapabilityError(
            { driverKind: instance.driverKind, capabilities: instance.adapter.capabilities },
            { driverKind: target.driverKind, capabilities: target.adapter.capabilities });
        if (!refusal && checked.ok && target) {
          try {
            assertWithinBudget(cfg, DATA_DIR);
            store.switchTaskModel(bot.id, threadId, checked.selection, false, {
              ...hostedModels?.resetTask(current.modelSelection, checked.selection), rewound: true
            });
            store.appendMessage(threadId, { role: "bot", kind: "activity", tool: {
              name: `recovery: Automatic recovery: ${instance.displayName || instance.driverKind} ${e instanceof TurnAuthenticationRefusedError ? "is signed out" : "could not start"}. Trying ${target.displayName || target.driverKind} · ${checked.selection.model} once in this thread.`, ok: true
            } });
            await startTurn(bot.id, text, { ...opts, threadId, userMessage, editedMessageId: undefined,
              automaticRecoveryAttempted: true, automaticRecoveryIndex: nextIndex + 1 });
            // The backup now owns these callbacks; don't publish a failed
            // routine/peer result or release a queued receipt in between.
            directFollowupSettlers.delete(dispatchClaimId);
            directCoordinationSettlers.delete(dispatchClaimId);
            return;
          } catch (failure) {
            message += ` Backup could not start: ${failure instanceof Error ? failure.message : String(failure)}`;
          }
        } else if (refusal) message = `Automatic recovery unavailable: ${refusal} Original error: ${message}`;
      }
      const backupRefused = e instanceof EngineAccessLost ? limitBackupRefusedInThread(bot.id, threadId, speaker) : null;
      // #1533: Claude refused the person's own sign-in before the turn began
      const startExpired = e instanceof TurnAuthenticationRefusedError ? subscriptionExpiredCard(bot, instance, turnAccessByThread.get(threadId), e.message) : null;
      if (startExpired) {
        store.appendMessage(threadId, { role: "bot", kind: "access", access: startExpired });
        notifyAccess(deliverableNotification("turn-failed", bot, threadId, engineAccessNotice("no_access", startExpired.engine, startExpired), { avatarUrl: bot.avatarUrl }), startExpired);
      }
      if (backupRefused) message = backupRefused;
      else if (e instanceof EngineAccessLost) {
        // The owner key went away between admission and dispatch: the same
        // card and notice a refusal at admission gives.
        const engine = engineDisplayName(instance);
        const card = accessCardFor(bot, e.refusal, engine, e.detail);
        store.appendMessage(threadId, { role: "bot", kind: "access", access: card });
        message = engineAccessNotice(e.refusal.reason, engine, e.refusal);
        notifyAccess(deliverableNotification("turn-failed", bot, threadId, message, { avatarUrl: bot.avatarUrl }), card);
      }
      settleDirectFollowup(dispatchClaimId, { ok: false, text: message });
      // The wait already wrote its failure resolution; keep all dispatch
      // failure bookkeeping below without adding the same error twice.
      if (!(e instanceof EngineAccessLost) && !startExpired) store.appendMessage(threadId, {
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
      if (opts?.automationSource === undefined && !opts?.commsDepth && !opts?.cardContinuation) {
        notify(
          deliverableNotification("turn-failed", bot, threadId, redactSecretsInText(message), { avatarUrl: bot.avatarUrl }),
        );
        reportIncident({ kind: "could-not-start", bot, threadId, detail: message });
      }
      store.setTaskActivity(bot.id, threadId, "idle");
      directTurnBots.delete(threadId);
      retryDelegationsWaitingOn(bot.id);
      opts?.onDispatchError?.(message);
      // a dispatch failure never emits turn.completed, so the settle-driven
      // drain would strand anything queued behind this turn
      drainQueuedSends();
      drainComputerResumes();
      drainSecretResumes();
      drainTeamSetupResumes();
      drainDelegationWakes();

    } finally {
if (warmOnly) {
        try {
          clearDirectTurnDispatch(threadId, dispatchClaimId);
          await revokeInternalCapabilityGeneration(threadId, dispatchClaimId);
          releaseTurnResources(resourceOwner);
          // a real turn that started meanwhile owns these now (its own generation)
          const ownGeneration = (directTurnGenerationByThread.get(threadId) ?? dispatchClaimId) === dispatchClaimId;
          if (ownGeneration && runningTurnEngines.get(threadId) === instance) runningTurnEngines.delete(threadId);
          if (ownGeneration && directTurnBots.get(threadId) === bot) directTurnBots.delete(threadId);
          if (directTurnGenerationByThread.get(threadId) === dispatchClaimId) directTurnGenerationByThread.delete(threadId);
          if (directRequestOwners.get(threadId)?.generation === dispatchClaimId) directRequestOwners.delete(threadId);
          if (computerSelectionTurns.get(threadId)?.generation === dispatchClaimId) computerSelectionTurns.delete(threadId);
          handoffs.abandon(threadId, dispatchClaimId);
        } catch (error) {
          console.error(`[voice-call] warm skipped: ${error instanceof Error ? error.name : "error"}`);
          warmOk = false;
        }
        opts?.onWarmSettled?.(warmOk);
        drainQueuedSends();
      }

    }
  })();
  return userMessage;
};

  return startTurn;
}
