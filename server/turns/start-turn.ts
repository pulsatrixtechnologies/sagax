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

export type { StartTurnHost };

export function createStartTurn(host: StartTurnHost) {
  const {
    AUTO_COMPUTER_RULES,
    BUILT_IN_BROWSER_SYSTEM_PROMPT,
    BUILT_IN_DATA_SYSTEM_PROMPT,
    CALL_RECALL_BUDGET,
    CLAUDE_REUSE_VOLATILE_SECTIONS,
    COMPACT_VOLATILE_SECTIONS,
    CREDENTIAL_PROMPT,
    ComputerWaitParked,
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
    TEAM_MEMORY_PROMPT,
    THREADS_PROMPT,
    TurnAuthenticationRefusedError: _TurnAuthenticationRefusedError,
    TurnNotStartedError: _TurnNotStartedError,
    VOICE_FIRST_SENTENCE_SYSTEM,
    WEBHOOK_PROMPT,
    WIDGET_APPROVAL_PROMPT,
    WIDGET_PROMPT,
    WITHHELD_HOST_TOOLS_PROMPT,
    accountConnectorInput,
    activeInternalGenerationByThread,
    activeVpsThreads: _activeVpsThreads,
    agentBrowserFrame,
    agentsIntegration,
    aiClientThreadPerson,
    approvalLevelPrompt,
    approvalModeForTurn,
    asPlaceFailure,
    attachCustomMcp,
    attachTeamBoat,
    auditFullAccessTurn,
    autoLocalVmAttachable,
    autoPayerKey,
    autoRecallEnabled,
    autoRecallPrompt,
    autoVmClaims,
    availableSkills,
    beginMemoryTurn,
    bindInternalCapabilityToProviderTurn: _bindInternalCapabilityToProviderTurn,
    bindTurnComputer,
    boat,
    boatNotConfigured,
    botCreationOffered,
    botProfilePrompt,
    botRecoveryBackups,
    botUserName,
    botUserProfile,
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
    clearTurnDigestState: _clearTurnDigestState,
    cloudEngine,
    cloudGuestOpened,
    cloudPlaceRefusal,
    cloudRoutineReadiness,
    compactConversation,
    compactPromptFor,
    compactVolatileOrder,
    computerPlaceRefusal,
    computerPrompt,
    computerSelectionTurns,
    computerSkippedNote,
    computerToolsRefusal,
    confinedWhy,
    containerComputerFrame,
    containerComputerMcp,
    containerComputerStatus,
    controlIntegration,
    coordinationSystemInstructions,
    coordinator,
    customMcpPrompt,
    dataIntegration,
    deliverableNotification,
    desktopLocalModels,
    desktopModelPersonFor,
    devPodsPrompt,
    devPodsThreads,
    directContext,
    directFollowupTurns: _directFollowupTurns,
    directRequestOwners,
    directTurnBots,
    directTurnClaimExists,
    directTurnClaimIsCurrent,
    directTurnGenerationByThread,
    docsIndexPrompt,
    drainComputerResumes,
    drainDelegationWakes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    effectiveBotOwner,
    endMemoryTurn: _endMemoryTurn,
    engineConnectorsPromptFor,
    engineDisplayName,
    engineHasNativeWebSearch,
    engineIsFresh,
    engineStartGate,
    engineTurnLevel,
    enginesRead: _enginesRead,
    ensureTaskWorkspace,
    ensureWorkspace,
    expandLearnTurnText,
    expandSetupTurnText,
    expandSkillCommandTurnText,
    failedTurnTool,
    finishUntilPrompt,
    fitTurnImagesForModel,
    forgetTurnCheckpoint,
    gatedLocalComputer,
    githubWithheldPrompt,
    grokCloudConnectorsForTurn,
    guardTurnDispatch,
    handedStateUsable,
    handoffs,
    harnessCommandSource,
    harnessCommands,
    hasQueuedSteeredMessages: _hasQueuedSteeredMessages,
    holdBootEngineSlot,
    honouredPin,
    hooksEnabled,
    hooksIntegration,
    hostScreenTurns,
    idleEngines,
    inheritedTeamComputer,
    installedPlaybookInstructions,
    interruptDirectThread,
    isExternalContextMarker,
    isLocalModelId,
    isModelRefusal: _isModelRefusal,
    languageOfPerson,
    latestCompaction,
    lightenColdPrompt,
    limitFailover,
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
    mountBotBoat,
    mountBotVps,
    mountHostComputer,
    mountPersonalMcp,
    mountPluginMcp,
    mountUserSandbox,
    myChromePromptFor,
    namedTeammates,
    nextInChain: _nextInChain,
    noteBotRead,
    noteCallBesideConversation: _noteCallBesideConversation,
    noteTurnQueued,
    notify,
    orgSpeakerPrincipal,
    orgTurnAccess,
    outstandingAssignmentsPrompt,
    ownerBotsReadOnly,
    ownerPaysForMember,
    parseLocalPromptMode,
    peerContactPrompt,
    peerName,
    peerReviewRequired,
    peerRosterSystemPrompt,
    pendingCancelledProviderHandshakes,
    personalFeatureOn,
    personalSkillInputs,
    personalSkills,
    pluginDirsFor,
    perspicaxTurnIntegration,
    phoneIntegration,
    pickFastSentenceModel,
    poolLocalVmTarget,
    prepareSemanticRecall,
    prewarmNamedTeammates,
    proactiveModeFor,
    proactivePrompt,
    promptSectionPaths,
    promptWithReply,
    reachable: _reachable,
    reachablePeers,
    readCuaConnection,
    readyLocalVmForTurn,
    recallQuery,
    recentWorkFor,
    recentWorkPrompt,
    redactSecretsInText,
    refreshMcpOAuth,
    refreshStreamDigests,
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
    resolveComputerPromptKind,
    resolveEngineTurnEffort,
    retireProviderTurn: _retireProviderTurn,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    richOutputPrompt,
    roomHandoffProblem,
    routines: _routines,
    rulesSystemPrompt,
    runAsBotEngine,
    runLifecycleEvent,
    runningTurnEngines,
    sameOwnerRosterMember,
    savedSteps,
    scopedSkillsPrompt,
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
    setupSystemPrompt,
    shouldMountLocalComputer,
    skillAuthoringEnabled,
    skillCommandInline,
    skillDiscoveryAvailable,
    skillsLibraryEnabled,
    soloGoalSystemPrompt,
    soloGoals,
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
    toolDefinitionBytes,
    toolErrorCorrectiveRoundsFor,
    turnAccessByThread: _turnAccessByThread,
    turnAnswers: _turnAnswers,
    turnCheckpoints,
    turnCommandEnvironment,
    turnComputerResources,
    turnConnectorsFor,
    turnContextBuckets,
    turnNetworkProxy,
    turnOrigin: _turnOrigin,
    turnPromptBytes,
    turnReachPrompt,
    turnResourceOwners,
    turnResources,
    turnTrace,
    typedCommandForTurn,
    uniquePeerName,
    unseenMessages,
    userProfileSystemPrompt,
    usesCompactPrompt,
    usesStablePrompt,
    vaultPrincipalForThread,
    voiceBriefText,
    voiceCalls,
    voiceLatency,
    voiceSessions,
    voiceTranscript,
    voiceUnseenBlock,
    vps,
    vpsThreadEnded,
    vpsThreadStarted,
    wants: _wants,
    watchdog,
    webhooks: _webhooks,
    withDesktopModelPerson,
    withRecalled,
    withUnseenMessages,
    withWorkplaceNote: _withWorkplaceNote,
    withholdHostToolsFor,
    workspaceCwdPrompt,
    workspaceLocationsPrompt,
  } = host;
  void _activeVpsThreads; void _enginesRead; void _bindInternalCapabilityToProviderTurn; void _directFollowupTurns; void _noteCallBesideConversation; void _retireProviderTurn; void _settleDirectCoordination; void _settlingResourceOwners; void _EngineAccessLost; void _TurnAuthenticationRefusedError; void _TurnNotStartedError; void _checkedTaskModelSwitch; void _clearTurnDigestState; void _endMemoryTurn; void _hasQueuedSteeredMessages; void _isModelRefusal; void _nextInChain; void _releasePlain; void _rememberAutoRefusal; void _subscriptionExpiredCard; void _turnAccessByThread;
  void _EngineAccessLost; void _TurnAuthenticationRefusedError; void _TurnNotStartedError; void _activeVpsThreads; void _bindInternalCapabilityToProviderTurn; void _bus; void _checkedTaskModelSwitch; void _clearTurnDigestState; void _directFollowupTurns; void _endMemoryTurn; void _enginesRead; void _hasQueuedSteeredMessages; void _isModelRefusal; void _localVmTargetForBot; void _nextInChain; void _noteCallBesideConversation; void _reachable; void _releaseBootEngineSlot; void _releasePlain; void _rememberAutoRefusal; void _retireProviderTurn; void _sessions; void _settleDirectCoordination; void _settlingResourceOwners; void _subscriptionExpiredCard; void _turnAccessByThread; void _turnOrigin; void _wants; void _webhooks;
  void _routines; void _turnAnswers; void _withWorkplaceNote;
  const { finishCatch, finishFinally } = createFinishStartTurn(host);
  const streamStartTurn = createStreamStartTurn(host);
  const prepareValidateStartTurn = createPrepareValidateStartTurn(host);
  const prepareAdmitStartTurn = createPrepareAdmitStartTurn(host);
  const prepareClaimStartTurn = createPrepareClaimStartTurn(host); void _bus; void _localVmTargetForBot; void _reachable; void _sessions; void _turnOrigin; void _wants; void _webhooks; void _releaseBootEngineSlot;

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
