// #1388 wave 4 step 3: startTurn runtime (leaf phase modules re-exported).
// Never imports server/index.ts.
import { createHash } from "node:crypto";
import type { LocalVmTarget, Runtime } from "../container-computer.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import { createTurnState } from "./start-turn-state.ts";
import { createFinishStartTurn } from "./start-turn-finish.ts";
import { createStreamStartTurn } from "./start-turn-stream.ts";
import { createPrepareValidateStartTurn } from "./start-turn-prepare-validate.ts";
import { createPrepareAdmitStartTurn } from "./start-turn-prepare-admit.ts";
import { createPrepareClaimStartTurn } from "./start-turn-prepare-claim.ts";
import { createDispatchStartTurn } from "./start-turn-dispatch.ts";
import { createPromptStartTurn } from "./start-turn-prompt.ts";

export type { StartTurnHost };

export function createStartTurn(host: StartTurnHost) {
  const {
    AUTO_COMPUTER_RULES: _AUTO_COMPUTER_RULES,
    BUILT_IN_BROWSER_SYSTEM_PROMPT: _BUILT_IN_BROWSER_SYSTEM_PROMPT,
    BUILT_IN_DATA_SYSTEM_PROMPT: _BUILT_IN_DATA_SYSTEM_PROMPT,
    CALL_RECALL_BUDGET: _CALL_RECALL_BUDGET,
    CLAUDE_REUSE_VOLATILE_SECTIONS: _CLAUDE_REUSE_VOLATILE_SECTIONS,
    COMPACT_VOLATILE_SECTIONS: _COMPACT_VOLATILE_SECTIONS,
    CREDENTIAL_PROMPT,
    ComputerWaitParked,
    DEFAULT_REBUILD_BYTES,
    DESKTOP_BRIDGE_MCP_NAME,
    DirectTurnSetupCancelled,
    EngineAccessLost: _EngineAccessLost,
    HOSTED_WORKSPACE: _HOSTED_WORKSPACE,
    HOST_COMPUTER_RESOURCE,
    IDENTITY,
    LEARN_PROMPT,
    LOCAL_RECALL_BUDGET: _LOCAL_RECALL_BUDGET,
    LOCAL_RECENT_WORK_LINES: _LOCAL_RECENT_WORK_LINES,
    PlaceUnavailableError,
    REACTION_PROMPT: _REACTION_PROMPT,
    ROUTINE_EXECUTION_PROMPT: _ROUTINE_EXECUTION_PROMPT,
    ROUTINE_PROMPT,
    SESSION_SEARCH_SYSTEM_PROMPT,
    TEAM_MEMORY_PROMPT: _TEAM_MEMORY_PROMPT,
    THREADS_PROMPT,
    TurnAuthenticationRefusedError: _TurnAuthenticationRefusedError,
    TurnNotStartedError: _TurnNotStartedError,
    VOICE_FIRST_SENTENCE_SYSTEM: _VOICE_FIRST_SENTENCE_SYSTEM,
    WEBHOOK_PROMPT: _WEBHOOK_PROMPT,
    WIDGET_APPROVAL_PROMPT,
    WIDGET_PROMPT,
    WITHHELD_HOST_TOOLS_PROMPT: _WITHHELD_HOST_TOOLS_PROMPT,
    accountConnectorInput: _accountConnectorInput,
    activeInternalGenerationByThread,
    activeVpsThreads: _activeVpsThreads,
    agentBrowserFrame,
    agentsIntegration,
    aiClientThreadPerson: _aiClientThreadPerson,
    approvalLevelPrompt: _approvalLevelPrompt,
    approvalModeForTurn: _approvalModeForTurn,
    asPlaceFailure,
    attachCustomMcp,
    attachTeamBoat,
    auditFullAccessTurn: _auditFullAccessTurn,
    autoLocalVmAttachable,
    autoPayerKey: _autoPayerKey,
    autoRecallEnabled,
    autoRecallPrompt: _autoRecallPrompt,
    autoVmClaims,
    availableSkills,
    beginMemoryTurn,
    bindInternalCapabilityToProviderTurn: _bindInternalCapabilityToProviderTurn,
    bindTurnComputer,
    boat,
    boatNotConfigured,
    botCreationOffered,
    botProfilePrompt,
    botRecoveryBackups: _botRecoveryBackups,
    botUserName,
    botUserProfile: _botUserProfile,
    browserIntegration,
    browserIsThePlace: _browserIsThePlace,
    browserRuntime,
    buildRecoveryText,
    buildSystemPrompt: _buildSystemPrompt,
    buildTurnContext,
    builtInBrowserEnabled,
    bus: _bus,
    callLinesBlock,
    callLinesSince,
    callTurnEffort: _callTurnEffort,
    canWorkOnCloud,
    cfg,
    checkSoulDrift,
    checkedTaskModelSwitch: _checkedTaskModelSwitch,
    checkpoints,
    chiefOfStaffSystemPrompt,
    claimTurnResource,
    claudeAiConnectorsFor: _claudeAiConnectorsFor,
    claudeUserMcpEnabled: _claudeUserMcpEnabled,
    clearCancelledProviderHandshake: _clearCancelledProviderHandshake,
    clearDirectTurnDispatch,
    clearFailedAutoPin,
    clearTurnDigestState: _clearTurnDigestState,
    cloudEngine,
    cloudGuestOpened,
    cloudPlaceRefusal,
    cloudRoutineReadiness,
    compactConversation,
    compactPromptFor: _compactPromptFor,
    compactVolatileOrder: _compactVolatileOrder,
    computerPlaceRefusal,
    computerPrompt: _computerPrompt,
    computerSelectionTurns,
    computerSkippedNote: _computerSkippedNote,
    computerToolsRefusal,
    confinedWhy: _confinedWhy,
    containerComputerFrame,
    containerComputerMcp,
    containerComputerStatus,
    controlIntegration,
    coordinationSystemInstructions: _coordinationSystemInstructions,
    coordinator,
    customMcpPrompt: _customMcpPrompt,
    dataIntegration,
    deliverableNotification,
    desktopLocalModels: _desktopLocalModels,
    desktopModelPersonFor: _desktopModelPersonFor,
    devPodsPrompt: _devPodsPrompt,
    devPodsThreads: _devPodsThreads,
    directContext,
    directFollowupTurns: _directFollowupTurns,
    directRequestOwners,
    directTurnBots,
    directTurnClaimExists: _directTurnClaimExists,
    directTurnClaimIsCurrent,
    directTurnGenerationByThread,
    docsIndexPrompt: _docsIndexPrompt,
    drainComputerResumes,
    drainDelegationWakes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    effectiveBotOwner: _effectiveBotOwner,
    endMemoryTurn: _endMemoryTurn,
    engineConnectorsPromptFor: _engineConnectorsPromptFor,
    engineDisplayName: _engineDisplayName,
    engineHasNativeWebSearch,
    engineIsFresh,
    engineStartGate: _engineStartGate,
    engineTurnLevel: _engineTurnLevel,
    enginesRead: _enginesRead,
    ensureTaskWorkspace,
    ensureWorkspace,
    expandLearnTurnText,
    expandSetupTurnText,
    expandSkillCommandTurnText,
    failedTurnTool,
    finishUntilPrompt: _finishUntilPrompt,
    fitTurnImagesForModel: _fitTurnImagesForModel,
    forgetTurnCheckpoint,
    gatedLocalComputer,
    githubWithheldPrompt: _githubWithheldPrompt,
    grokCloudConnectorsForTurn: _grokCloudConnectorsForTurn,
    guardTurnDispatch: _guardTurnDispatch,
    handedStateUsable,
    handoffs,
    harnessCommandSource: _harnessCommandSource,
    harnessCommands: _harnessCommands,
    hasQueuedSteeredMessages: _hasQueuedSteeredMessages,
    holdBootEngineSlot: _holdBootEngineSlot,
    honouredPin,
    hooksEnabled,
    hooksIntegration,
    hostScreenTurns,
    idleEngines: _idleEngines,
    inheritedTeamComputer,
    installedPlaybookInstructions,
    interruptDirectThread,
    isExternalContextMarker,
    isLocalModelId: _isLocalModelId,
    isModelRefusal: _isModelRefusal,
    languageOfPerson: _languageOfPerson,
    latestCompaction,
    lightenColdPrompt: _lightenColdPrompt,
    limitFailover: _limitFailover,
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
    longCommandsPrompt: _longCommandsPrompt,
    managedPolicy,
    markDirectTurnDispatching,
    markWorkspaceUse: _markWorkspaceUse,
    mcpCallTimeoutMinutes: _mcpCallTimeoutMinutes,
    mcpServersAsPerson,
    measureContextBuckets: _measureContextBuckets,
    memoryPromptFor: _memoryPromptFor,
    mentionPrompt: _mentionPrompt,
    mentionedBots,
    messagesIntegration,
    messagesWanted,
    modelFallbackByPayer: _modelFallbackByPayer,
    modelFallbackByThread: _modelFallbackByThread,
    modelFallbackPayerKey: _modelFallbackPayerKey,
    modelPrompt: _modelPrompt,
    mountBotBoat,
    mountBotVps,
    mountHostComputer,
    mountPersonalMcp,
    mountPluginMcp,
    mountUserSandbox,
    myChromePromptFor: _myChromePromptFor,
    namedTeammates,
    nextInChain: _nextInChain,
    noteBotRead: _noteBotRead,
    noteCallBesideConversation: _noteCallBesideConversation,
    noteTurnQueued: _noteTurnQueued,
    notify,
    orgSpeakerPrincipal,
    orgTurnAccess: _orgTurnAccess,
    outstandingAssignmentsPrompt: _outstandingAssignmentsPrompt,
    ownerBotsReadOnly,
    ownerPaysForMember: _ownerPaysForMember,
    parseLocalPromptMode: _parseLocalPromptMode,
    peerContactPrompt: _peerContactPrompt,
    peerName: _peerName,
    peerReviewRequired: _peerReviewRequired,
    peerRosterSystemPrompt,
    pendingCancelledProviderHandshakes,
    personalFeatureOn,
    personalSkillInputs,
    personalSkills,
    pluginDirsFor: _pluginDirsFor,
    perspicaxTurnIntegration,
    phoneIntegration,
    pickFastSentenceModel: _pickFastSentenceModel,
    poolLocalVmTarget,
    prepareSemanticRecall,
    prewarmNamedTeammates,
    proactiveModeFor: _proactiveModeFor,
    proactivePrompt: _proactivePrompt,
    promptSectionPaths: _promptSectionPaths,
    promptWithReply,
    reachable: _reachable,
    reachablePeers,
    readCuaConnection,
    readyLocalVmForTurn,
    recallQuery,
    recentWorkFor: _recentWorkFor,
    recentWorkPrompt: _recentWorkPrompt,
    redactSecretsInText,
    refreshMcpOAuth,
    refreshStreamDigests: _refreshStreamDigests,
    registerComputerResume,
    releaseBootEngineSlot: _releaseBootEngineSlot,
    releaseLocalVmThread,
    releasePlain: _releasePlain,
    releaseTurnComputer,
    releaseTurnResources,
    rememberAutoRefusal: _rememberAutoRefusal,
    remoteComputerForTurn,
    renderSkillInstructions,
    renderUnseen,
    replaysNatively,
    reportIncident,
    resolveComputerPromptKind: _resolveComputerPromptKind,
    resolveEngineTurnEffort: _resolveEngineTurnEffort,
    retireProviderTurn: _retireProviderTurn,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    richOutputPrompt: _richOutputPrompt,
    roomHandoffProblem: _roomHandoffProblem,
    routines: _routines,
    rulesSystemPrompt: _rulesSystemPrompt,
    runAsBotEngine: _runAsBotEngine,
    runLifecycleEvent,
    runningTurnEngines: _runningTurnEngines,
    sameOwnerRosterMember,
    savedSteps,
    scopedSkillsPrompt: _scopedSkillsPrompt,
    screenPollers,
    sectionContextSystemPrompt,
    selectBundledSkills,
    selectReplay,
    semanticEmbeddingEndpoint,
    sessionStart,
    sessions: _sessions,
    settleDirectCoordination: _settleDirectCoordination,
    settleDirectFollowup,
    settlingResourceOwners: _settlingResourceOwners,
    setupModeActive,
    setupSystemPrompt: _setupSystemPrompt,
    shouldMountLocalComputer,
    skillAuthoringEnabled,
    skillCommandInline,
    skillDiscoveryAvailable: _skillDiscoveryAvailable,
    skillsLibraryEnabled,
    soloGoalSystemPrompt: _soloGoalSystemPrompt,
    soloGoals: _soloGoals,
    startScreenPoller,
    stopScreenPoller,
    store,
    streamDigestPrompt: _streamDigestPrompt,
    streamTurn: _streamTurn,
    subscriptionExpiredCard: _subscriptionExpiredCard,
    supportsWorkspaceFiles,
    surfaceOfComputerKind,
    surfacePrompt: _surfacePrompt,
    teamAvailabilityPart: _teamAvailabilityPart,
    teamComputerPrompt: _teamComputerPrompt,
    teamMemory: _teamMemory,
    threadBusy,
    toolDefinitionBytes: _toolDefinitionBytes,
    toolErrorCorrectiveRoundsFor: _toolErrorCorrectiveRoundsFor,
    turnAccessByThread: _turnAccessByThread,
    turnAnswers: _turnAnswers,
    turnCheckpoints,
    turnCommandEnvironment: _turnCommandEnvironment,
    turnComputerResources,
    turnConnectorsFor: _turnConnectorsFor,
    turnContextBuckets: _turnContextBuckets,
    turnNetworkProxy: _turnNetworkProxy,
    turnOrigin: _turnOrigin,
    turnPromptBytes: _turnPromptBytes,
    turnReachPrompt: _turnReachPrompt,
    turnResourceOwners,
    turnResources,
    turnTrace,
    typedCommandForTurn: _typedCommandForTurn,
    uniquePeerName: _uniquePeerName,
    unseenMessages,
    userProfileSystemPrompt: _userProfileSystemPrompt,
    usesCompactPrompt: _usesCompactPrompt,
    usesStablePrompt: _usesStablePrompt,
    vaultPrincipalForThread,
    voiceBriefText,
    voiceCalls,
    voiceLatency: _voiceLatency,
    voiceSessions,
    voiceTranscript,
    voiceUnseenBlock,
    vps,
    vpsThreadEnded,
    vpsThreadStarted,
    wants: _wants,
    watchdog,
    webhooks: _webhooks,
    withDesktopModelPerson: _withDesktopModelPerson,
    withRecalled: _withRecalled,
    withUnseenMessages,
    withWorkplaceNote: _withWorkplaceNote,
    withholdHostToolsFor,
    workspaceCwdPrompt: _workspaceCwdPrompt,
    workspaceLocationsPrompt: _workspaceLocationsPrompt,
  } = host;
  void _activeVpsThreads; void _enginesRead; void _bindInternalCapabilityToProviderTurn; void _directFollowupTurns; void _noteCallBesideConversation; void _retireProviderTurn; void _settleDirectCoordination; void _settlingResourceOwners; void _EngineAccessLost; void _TurnAuthenticationRefusedError; void _TurnNotStartedError; void _checkedTaskModelSwitch; void _clearTurnDigestState; void _endMemoryTurn; void _hasQueuedSteeredMessages; void _isModelRefusal; void _nextInChain; void _releasePlain; void _rememberAutoRefusal; void _subscriptionExpiredCard; void _turnAccessByThread;
  void _EngineAccessLost; void _TurnAuthenticationRefusedError; void _TurnNotStartedError; void _activeVpsThreads; void _bindInternalCapabilityToProviderTurn; void _bus; void _checkedTaskModelSwitch; void _clearTurnDigestState; void _directFollowupTurns; void _endMemoryTurn; void _enginesRead; void _hasQueuedSteeredMessages; void _isModelRefusal; void _localVmTargetForBot; void _nextInChain; void _noteCallBesideConversation; void _reachable; void _releaseBootEngineSlot; void _releasePlain; void _rememberAutoRefusal; void _retireProviderTurn; void _sessions; void _settleDirectCoordination; void _settlingResourceOwners; void _subscriptionExpiredCard; void _turnAccessByThread; void _turnOrigin; void _wants; void _webhooks;
  void _routines; void _turnAnswers; void _withWorkplaceNote;
  const { finishCatch, finishFinally } = createFinishStartTurn(host);
  const streamStartTurn = createStreamStartTurn(host);
  const prepareValidateStartTurn = createPrepareValidateStartTurn(host);
  const prepareAdmitStartTurn = createPrepareAdmitStartTurn(host);
  const prepareClaimStartTurn = createPrepareClaimStartTurn(host);
  const dispatchStartTurn = createDispatchStartTurn(host);
  const promptStartTurn = createPromptStartTurn(host);
  void _AUTO_COMPUTER_RULES; void _BUILT_IN_BROWSER_SYSTEM_PROMPT; void _BUILT_IN_DATA_SYSTEM_PROMPT; void _CALL_RECALL_BUDGET; void _CLAUDE_REUSE_VOLATILE_SECTIONS; void _COMPACT_VOLATILE_SECTIONS; void _HOSTED_WORKSPACE; void _LOCAL_RECALL_BUDGET; void _LOCAL_RECENT_WORK_LINES; void _REACTION_PROMPT; void _ROUTINE_EXECUTION_PROMPT; void _TEAM_MEMORY_PROMPT; void _WEBHOOK_PROMPT; void _WITHHELD_HOST_TOOLS_PROMPT; void _aiClientThreadPerson; void _approvalLevelPrompt; void _approvalModeForTurn; void _autoPayerKey; void _autoRecallPrompt; void _botUserProfile; void _buildSystemPrompt; void _compactPromptFor; void _compactVolatileOrder; void _computerPrompt; void _computerSkippedNote; void _coordinationSystemInstructions; void _customMcpPrompt; void _devPodsPrompt; void _devPodsThreads; void _docsIndexPrompt; void _effectiveBotOwner; void _engineConnectorsPromptFor; void _engineDisplayName; void _finishUntilPrompt; void _githubWithheldPrompt; void _idleEngines; void _isLocalModelId; void _lightenColdPrompt; void _limitFailover; void _longCommandsPrompt; void _markWorkspaceUse; void _measureContextBuckets; void _memoryPromptFor; void _mentionPrompt; void _modelFallbackByPayer; void _modelFallbackByThread; void _modelFallbackPayerKey; void _modelPrompt; void _myChromePromptFor; void _outstandingAssignmentsPrompt; void _ownerPaysForMember; void _parseLocalPromptMode; void _peerContactPrompt; void _peerName; void _peerReviewRequired; void _proactiveModeFor; void _proactivePrompt; void _promptSectionPaths; void _recentWorkFor; void _recentWorkPrompt; void _refreshStreamDigests; void _resolveComputerPromptKind; void _richOutputPrompt; void _roomHandoffProblem; void _rulesSystemPrompt; void _runningTurnEngines; void _scopedSkillsPrompt; void _setupSystemPrompt; void _skillDiscoveryAvailable; void _soloGoalSystemPrompt; void _soloGoals; void _streamDigestPrompt; void _streamTurn; void _surfacePrompt; void _teamAvailabilityPart; void _teamComputerPrompt; void _teamMemory; void _toolDefinitionBytes; void _turnConnectorsFor; void _turnContextBuckets; void _turnPromptBytes; void _turnReachPrompt; void _uniquePeerName; void _userProfileSystemPrompt; void _usesCompactPrompt; void _usesStablePrompt; void _workspaceCwdPrompt; void _workspaceLocationsPrompt;

  void _VOICE_FIRST_SENTENCE_SYSTEM; void _accountConnectorInput; void _auditFullAccessTurn; void _botRecoveryBackups; void _browserIsThePlace; void _callTurnEffort; void _claudeAiConnectorsFor; void _claudeUserMcpEnabled; void _clearCancelledProviderHandshake; void _confinedWhy; void _desktopLocalModels; void _desktopModelPersonFor; void _directTurnClaimExists; void _engineStartGate; void _engineTurnLevel; void _fitTurnImagesForModel; void _grokCloudConnectorsForTurn; void _guardTurnDispatch; void _harnessCommandSource; void _harnessCommands; void _holdBootEngineSlot; void _languageOfPerson; void _mcpCallTimeoutMinutes; void _noteBotRead; void _noteTurnQueued; void _orgTurnAccess; void _pluginDirsFor; void _pickFastSentenceModel; void _resolveEngineTurnEffort; void _runAsBotEngine; void _toolErrorCorrectiveRoundsFor; void _turnCommandEnvironment; void _turnNetworkProxy; void _typedCommandForTurn; void _voiceLatency; void _withDesktopModelPerson; void _withRecalled;
 void _bus; void _localVmTargetForBot; void _reachable; void _sessions; void _turnOrigin; void _wants; void _webhooks; void _releaseBootEngineSlot;

  const startTurn = async function startTurn(
    botId: string,
    text: string,
    opts?: any,
  ) {
    const state = createTurnState({ botId, text, opts, startTurn });
    {
      const validated = await prepareValidateStartTurn(state);
      if (validated.kind === "return") return validated.value;
      const admitted = await prepareAdmitStartTurn(state);
      if (admitted.kind === "return") return admitted.value;
      const claimed = await prepareClaimStartTurn(state);
      if (claimed.kind === "return") return claimed.value;
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
      state.activeMessages = store.activePath(state.threadId);
      const coordinationChildren = state.opts?.coordination?.resumed
        ? new Set(coordinator.children(state.opts.coordination.id).map((child: any) => child.id)) : undefined;
      for (const m of state.activeMessages) {
        if (!state.opts?.coordination || !m.roomRequest) continue;
        if ((m.roomRequest.phase === "request" && m.roomRequest.id === state.opts.coordination.id) ||
          (m.roomRequest.phase === "result" && coordinationChildren?.has(m.roomRequest.id))) skipTranscript.add(m.id);
      }
      const context = directContext(state.bot, state.threadId, state.activeMessages);
      state.contextOrder = context.map((m: any) => m.id);
      const replayable = context.filter((m: any) => !skipTranscript.has(m.id));
      state.record = latestCompaction(state.activeMessages, state.task);
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
      state.skillAuthoring = personalFeatureOn("state.skillAuthoring", skillAuthoringEnabled(cfg), vaultPrincipalForThread(state.threadId)) && state.peerToolsMounted;
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
        state.skillAuthoring ? expandLearnTurnText(setupText) : setupText,
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
      state.voiceBriefed = false;
      if (liveCall && state.voiceView) {
        state.plan = voiceSessions.plan(state.threadId, { callId: liveCall.callId, instanceId: state.instanceId, model: String(state.model ?? "") });
        if (state.plan.fresh) {
          // the idle process may hold the conversation's session: never reuse it
          try { state.instance.adapter.releaseWarmSession?.(state.threadId); } catch { /* already closed */ }
        }
        // the warm starts the call's process: the first spoken turn takes it as is
        if (state.warmOnly) voiceSessions.dispatched(state.threadId, []);
        const byId = new Map<string, any>(state.activeMessages.map((message: any) => [message.id, message]));
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
        state.voiceBriefed = state.plan.brief;
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

      state.persona = [
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
      state.githubWithheld = [];
      state.browser = null;
      const selectedSkills = selectBundledSkills(
        state.providerText,
        [
          ...(state.instance.adapter.capabilities.phoneMcp === true ? ["phoneMcp"] : []),
          ...(state.skillAuthoring ? ["state.skillAuthoring"] : []),
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
        state.githubWithheld = mounted.githubWithheld;
      }
      // Slice 5: the bot's Perspicax profiles, as the person who speaks.
      state.perspicaxPrompt = "";
      if (IDENTITY.kind === "perspicax" && state.instance.adapter.capabilities.customMcp === true && (store.bot(state.bot.id) ?? state.bot).perspicax?.profiles.length) {
        const perspicax = await perspicaxTurnIntegration({ bot: state.bot, threadId: state.threadId, generation: state.dispatchClaimId, speaker: state.speaker, taken: Object.keys(state.integrations.custom ?? {}), ...(state.warmOnly ? { quiet: true } : {}) });
        if (Object.keys(perspicax.custom).length) state.integrations.custom = { ...state.integrations.custom, ...perspicax.custom };
        state.perspicaxPrompt = perspicax.prompt;
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
      state.worksInWorkspace = supportsWorkspaceFiles(state.instance.driverKind);
      if (state.worksInWorkspace) {
        ensureWorkspace(state.bot.id);
        // memory sealed at rest opens back to plain in place for the engine's
        // file tools (started above, off the turn's path), until the turn ends
        // baseline for the journal's turn-boundary diff (see the bus hook)
        // A warm has no turn to journal. endMemoryTurn would close the previous one.
        if (!state.warmOnly && state.bot.memoryEnabled !== false) beginMemoryTurn(state.bot.id, state.threadId);
      }
      state.privateWorkspace = state.worksInWorkspace ? ensureTaskWorkspace(state.bot.id, state.threadId) : undefined;
      state.skillInstructions = renderSkillInstructions(selectedSkills, {
        includeRoot: state.worksInWorkspace
      });
      state.packagePlaybooks = installedPlaybookInstructions(state.providerText, state.bot.playbooks);
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
      state.teamComputer = remote.skipRemote ? undefined : inheritedComputer;
      const cloudBackend = state.teamComputer || state.opts?.runOn === "cloud" || state.bot.cloudBackend !== "vps" ? "box" : "vps";
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
       * way let go — and the state.prompt names the cause, where any other turn
       * fails. A stopped setup and a parked seat wait go on as for any turn. */
      const skipComputer = (error: unknown) => {
        if (!state.answer.incident || error instanceof DirectTurnSetupCancelled || error instanceof ComputerWaitParked) throw error;
        state.computerSkipped ??= error instanceof Error ? error.message : String(error);
        state.wants = "off";
        state.teamComputer = undefined;
        delete state.integrations.localComputer;
        releaseTurnComputer(state.resourceOwner);
      };
      // A place the organisation disallows, or a Cloud home never offers, is
      // refused before anything is prepared; Auto below simply skips them.
      const wantedKind = state.teamComputer ? "box" : state.wants === "local" ? "thisComputer" : state.wants === "vm" ? "localVm"
        : state.wants === "cloud" ? (cloudBackend === "vps" ? "vps" : "box") : undefined;
      const placeRefusal = wantedKind && computerPlaceRefusal(wantedKind);
      if (placeRefusal) skipComputer(Object.assign(new Error(placeRefusal.message), { status: 409, code: placeRefusal.code }));
      // Where an explicit place came from, so its failure names the one
      // control that changes it (and a failed Auto-recorded pin is cleared).
      // Auto and a team's shared computer are nobody's per-turn choice.
      const namedPlace = state.teamComputer || state.wants === undefined || state.wants === "off" ? undefined : state.wants;
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
      state.computerKind = null;
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
          if (await attachLocalVm(true)) state.computerKind = "vm";
        } else if (state.wants === "local") {
          state.integrations.localComputer = await mountHostComputer(
            state.resourceOwner, state.bot.id, mountsLocalComputer, surfaceLazyClaimRejection("this computer"),
            savedSteps.journals(directRequestOwners.get(state.threadId)),
          );
          state.computerKind = "local";
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
            state.computerKind = "vps";
          } else {
            vpsThreadEnded(state.bot.id, state.threadId);
            if (state.wants === "cloud") {
              throw new Error(mounted.problem ?? "the VPS computer could not be created or reached");
            }
            autoVpsProblem = mounted.problem ?? "the VPS computer could not be reached";
            autoVpsReachable = mounted.reachable;
          }
        }

        if (state.teamComputer) {
          const attached = await attachTeamBoat(state.teamComputer, state.bot.id, state.resourceOwner, canWorkOnCloud(cloudEngine(state.instance)));
          Object.assign(state.integrations, attached.mount);
          state.previewCapture = attached.capture;
          state.computerKind = "box";
        }
        // Cloud is strict when selected. A turn reaches the Boat only when
        // this conversation is on it (Works on, a pin, a cloud routine, or
        // select_computer): an Auto turn never reads the Boat account, so it
        // adds no Boat call, cannot be stopped by a Boat being deleted, and
        // never records a place nobody chose. Even then the Boat is created
        // or woken only by the bot's first computer call (mountBotBoat): a
        // chat that never touches the screen uses no plan hours.
        if (!state.teamComputer && cloudBackend === "box" && boat.boatConfigured(cfg) && state.wants === "cloud") {
          state.integrations.localComputer = mountBotBoat(state.bot, state.resourceOwner, {
            // The row a failed attach always wrote: the place's one line and
            // its one way on, read where the place came from (an
            // Auto-recorded pin is cleared, as dispatch clears it).
            source: state.placeSource,
            onClaimed: adoptClaimedCapture,
            onRejected: surfaceLazyClaimRejection("the cloud computer")
          });
          state.computerKind = "box";
        }
        if (state.wants === "cloud" && cloudBackend === "box" && !boat.boatConfigured(cfg)) {
          throw boatNotConfigured(state.bot, state.placeSource ?? "works-on");
        }
        if (state.wants === "cloud" && cloudBackend === "box" && state.computerKind !== "box") {
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
      if (state.wants === undefined && !state.integrations.localComputer && !computerPlaceRefusal("localVm") && await attachLocalVm(false)) state.computerKind = "vm";
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
          state.computerKind = "local";
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
      state.vpsUnavailableNote = "";
      if (
        state.wants === undefined &&
        cloudBackend === "vps" &&
        !state.integrations.localComputer &&
        autoVpsProblem &&
        !computerSelectionTurns.has(state.threadId)
      ) {
        const hint = vps.vpsUnavailableHint({ automationSource: state.opts?.automationSource, autoStartVps: state.bot.autoStartVps, reachable: autoVpsReachable });
        if (state.opts?.automationSource) skipComputer(new Error(`${autoVpsProblem}. ${hint}`));
        else state.vpsUnavailableNote = ` This bot's VPS computer is unavailable this turn (${autoVpsProblem}), so no computer is mounted. Work that needs no screen can go ahead. If the request needs the VPS desktop, do not claim to have used it: say it is unavailable${hint ? ` and what the person can do: ${hint}` : "."}`;
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
      state.sectionPeers = reachablePeers(store.bots, state.bot);
      if (state.agentsMounted) {
        // Only a direct human request can create separate self-owned jobs.
        // Coordinated children and self-opened jobs stay inside their scope;
        // a later real user message on the same task is a fresh request.
        state.origin = state.opts?.cardContinuation
          ? store.activePath(state.threadId).findLast((message: any) => message.role === "user" && message.kind === "text")
          : state.userMessage;
        const ownThreadCreation = state.boundedCoordination && !state.coordinated && Boolean(state.origin && !state.origin.peerAsk);
        state.integrations.agents = agentsIntegration(state.bot.id, state.threadId, state.commsDepth, state.skillAuthoring, state.dispatchClaimId, state.opts?.coordination?.id, state.boundedCoordination, ownThreadCreation, state.worksInWorkspace, !engineHasNativeWebSearch(state.instance.driverKind, withholdHostToolsFor(state.instance), state.model));
      }
      if (state.instance.adapter.capabilities.hooks === true && hooksEnabled()) {
        state.integrations.hooks = hooksIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
        void runLifecycleEvent(state.bot.id, state.threadId, "before_submit_prompt", {}).catch(() => {});
      }
      // @mentions in the user's message (the composer's tagging UI) become
      // an explicit coordination nudge. The agent still chooses the matching
      // peer tool, so the harness stays the single owner of turns/permissions.
      state.tagged = state.integrations.agents && !state.peerHop
        ? mentionedBots(
            state.providerText,
            state.sectionPeers,
          )
        : [];
      // A person's request that names a teammate: its engine starts now, in
      // the work thread coordinate_bots would use, so the delegation does not
      // wait for a cold start (perf round 3).
      if (!state.warmOnly && state.integrations.agents && state.boundedCoordination && !state.commsDepth && !state.opts?.coordination && !store.groupByThread(state.threadId)) {
        prewarmNamedTeammates(state.bot, state.threadId, namedTeammates(state.providerText, state.sectionPeers, state.tagged));
      }
      state.coordinationPrompt = state.bot.chiefOfStaff
        ? chiefOfStaffSystemPrompt(
            state.bot.id,
            store.bots,
            Boolean(state.integrations.agents) && !state.peerHop,
            state.boundedCoordination,
          )
        : state.integrations.agents && !state.peerHop && state.sectionPeers.length > 0
          // Ordinary bots could always CALL the peer tools; until now the
          // one generic sentence they got never named a teammate, so the
          // first move of any collaboration was a list_bots round trip the
          // model mostly did not think to make.
          ? peerRosterSystemPrompt(state.sectionPeers, state.boundedCoordination, botCreationOffered(state.bot, ownerBotsReadOnly(state.bot)), sameOwnerRosterMember(state.bot))
          : "";
      state.credentialPrompt = state.integrations.agents ? CREDENTIAL_PROMPT + (state.boundedCoordination || state.peerHop ? "" : THREADS_PROMPT) + WIDGET_PROMPT + WIDGET_APPROVAL_PROMPT : "";
      state.routinePrompt = state.integrations.agents ? ROUTINE_PROMPT : "";
      state.profilePrompt = state.integrations.agents ? botProfilePrompt(state.bot) : "";
      state.recallPrompt = state.integrations.agents && state.bot.memoryEnabled !== false ? SESSION_SEARCH_SYSTEM_PROMPT : "";
      state.learnPrompt = state.skillAuthoring ? LEARN_PROMPT : "";

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
      state.liveBot = store.bot(state.bot.id);
      state.setupMode =
        state.peerToolsMounted &&
        setupModeActive({
          soul: state.liveBot?.soul ?? state.bot.soul,
          description: state.liveBot?.description ?? state.bot.description,
          text: state.providerText
        });
      if (state.liveBot && state.instance.adapter.capabilities.dataMcp === true) {
        const data = dataIntegration(state.bot.id, { threadId: state.threadId, generation: state.dispatchClaimId });
        if (data) state.integrations.data = data;
      }
      // One place per turn. On Auto the branches above may have reached a
      // computer; then the built-in browser stays unmounted and web work
      // happens in that computer's own browser. Not on this computer, the
      // person's own screen (2026-10-28): the built-in browser stays beside
      // it, so a lookup never opens a window in front of them
      // (HOST_SCREEN_RULE in server/surface.ts).
      state.mountedComputer = surfaceOfComputerKind(state.computerKind);
      if (state.computerKind === "local") hostScreenTurns.set(state.threadId, { botId: state.bot.id, generation: state.dispatchClaimId });
      else hostScreenTurns.delete(state.threadId);
      if (
        state.liveBot &&
        state.plan.browser &&
        !(state.plan.computer === undefined && state.mountedComputer && state.mountedComputer !== "local") &&
        // On the person's computer, web pages open in their own browser
        // (sagax-desktop browse), on their network, not on this server.
        // Auto keeps the built-in browser: it is one of the places it picks.
        !(state.turnPlace.target === "user-desktop" && !state.turnAuto?.auto && state.integrations.custom?.[DESKTOP_BRIDGE_MCP_NAME]) &&
        builtInBrowserEnabled(cfg) &&
        state.liveBot.browser !== false &&
        state.instance.adapter.capabilities.browserMcp === true
      ) {
        const selectedProfile = state.liveBot.browserProfile;
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
      if (computerSelection) computerSelection.mounted = state.mountedComputer ?? (state.integrations.browser ? "browser" : undefined);
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
      await promptStartTurn(state);

      const dispatchedConfig = sessionConfig(state.liveBot?.soul ?? state.bot.soul);
      if (state.strictResume && !state.voiceView && !(state.opts?.cardContinuation && state.continuingRoutine) && dispatchedConfig !== state.plannedConfig) state.dispatchContext = decideContext(dispatchedConfig);
      await dispatchStartTurn(state);

      await streamStartTurn(state);
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
