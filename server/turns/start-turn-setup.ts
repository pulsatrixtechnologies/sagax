// @ts-nocheck
// #1388 wave 4 step 3: startTurn setup (context, voice, integrations start).
// Never imports server/index.ts.
import { createHash } from "node:crypto";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createSetupStartTurn(host: StartTurnHost) {
  const {
    DEFAULT_REBUILD_BYTES,
    DirectTurnSetupCancelled,
    IDENTITY,
    attachCustomMcp,
    availableSkills,
    botUserName,
    buildRecoveryText,
    buildTurnContext,
    callLinesBlock,
    callLinesSince,
    cfg,
    checkSoulDrift,
    clearDirectTurnDispatch,
    cloudRoutineReadiness,
    compactConversation,
    coordinator,
    directContext,
    directTurnBots,
    directTurnClaimIsCurrent,
    drainComputerResumes,
    drainDelegationWakes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    engineIsFresh,
    expandLearnTurnText,
    expandSetupTurnText,
    expandSkillCommandTurnText,
    handedStateUsable,
    handoffs,
    isExternalContextMarker,
    latestCompaction,
    localPrincipalId,
    mcpServersAsPerson,
    messagesIntegration,
    messagesWanted,
    orgSpeakerPrincipal,
    personalFeatureOn,
    personalSkillInputs,
    personalSkills,
    perspicaxTurnIntegration,
    perspicaxTurnPrepare,
    phoneIntegration,
    promptWithReply,
    refreshMcpOAuth,
    releaseTurnResources,
    renderUnseen,
    replaysNatively,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    sectionContextSystemPrompt,
    selectBundledSkills,
    selectReplay,
    sessionStart,
    settleDirectFollowup,
    skillAuthoringEnabled,
    skillCommandInline,
    skillsLibraryEnabled,
    store,
    supportsWorkspaceFiles,
    turnTrace,
    unseenMessages,
    vaultPrincipalForThread,
    voiceBriefText,
    voiceCalls,
    voiceSessions,
    voiceTranscript,
    voiceUnseenBlock,
    watchdog,
    withUnseenMessages,
  } = host;

  return async function setupStartTurn(state: TurnState): Promise<{ kind: "return" } | undefined> {

    if (state.warmOnly && state.opts?.warmSignal?.aborted) {
      state.instance.adapter.releaseWarmSession?.(state.threadId);
      return { kind: "return" };
    }
    if (state.enginesRead) {
      await state.enginesRead;
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) throw new DirectTurnSetupCancelled("turn stopped while the engines were read");
    }
    // Perspicax token exchange, session open/verify and tools/list do not
    // need custom mount names. Start them beside
    // compaction, context selection and prompt build; await before mounts.
    const perspicaxPrepared = IDENTITY.kind === "perspicax" && state.instance.adapter.capabilities.customMcp === true
      ? perspicaxTurnPrepare({ bot: state.bot, threadId: state.threadId, generation: state.dispatchClaimId, speaker: state.speaker, ...(state.warmOnly ? { quiet: true } : {}) })
      : null;
    // Let an in-flight early prepare finish so revoke/endGeneration can see
    // what it opened (a cancelled turn must still release those entries).
    const settlePerspicaxPrepare = async () => {
      if (perspicaxPrepared) await perspicaxPrepared.catch(() => {});
    };
    // A call warm must not compact or rewrite the resume cursor. The first
    // spoken turn decides that, and a reset discards this process.
    if (!state.warmOnly) {
    // Readiness can wait on the network. Admit the task first so its busy
    // state, Stop action and watchdog own that wait just like VM setup.
    if (state.opts?.runOn === "cloud") {
      const readiness = await cloudRoutineReadiness(state.botId, state.threadId);
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
        await settlePerspicaxPrepare();
        throw new DirectTurnSetupCancelled("turn stopped during cloud readiness");
      }
      if (!readiness.ready) throw new Error(readiness.reason ?? "The cloud computer is not ready");
    }
    // A call turn starts its own short session: the conversation's fold
    // waits for its next written turn, off the person's silence.
    if (!state.voiceCallTurn) await compactConversation({ bot: state.bot, threadId: state.threadId, generation: state.dispatchClaimId, instance: state.instance, model: state.model,
      excludedIds: new Set([state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])]), manual: state.opts?.compactOnly === true });
    turnTrace(state.threadId, "compacted");
    if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
      await settlePerspicaxPrepare();
      throw new DirectTurnSetupCancelled("turn stopped during context setup");
    }
    if (state.opts?.compactOnly) {
      await settlePerspicaxPrepare();
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
      return { kind: "return" };
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
    if (!state.warmOnly) turnTrace(state.threadId, "context-selected");
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
    state.sessionConfig = (soul: string | undefined) =>
      createHash("sha256").update(JSON.stringify([...persistentConfig, soul])).digest("hex").slice(0, 16);
    state.plannedConfig = state.sessionConfig(state.bot.soul);
    // Agent-tool gate shared by skill authoring, the /setup turn-text rewrite,
    // the setup prompt block, and the peer-comms integration below: a driver
    // that never mounts agent tools (or a turn already at the comms-depth cap)
    // must not be steered into — or told about — tools it cannot call.
    state.skillAuthoring = personalFeatureOn("skillAuthoring", skillAuthoringEnabled(cfg), vaultPrincipalForThread(state.threadId)) && state.peerToolsMounted;
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
    state.decideContext = (config: string) => {
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
      // up in (server/context/delta-context.ts). buildTurnContext prepends a replay only
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
    state.dispatchContext = state.decideContext(state.plannedConfig);
    // A call turn (server/voice/voice-turn.ts) runs in the call's own session,
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
      turnTrace(state.threadId, "soul-drift");
    }
    if (!state.warmOnly && state.dispatchContext.handoff) handoffs.begin(state.threadId, state.dispatchClaimId, state.dispatchContext.handoff);

    state.integrations = {};
    state.githubWithheld = [];
    state.browser = null;
    state.selectedSkills = selectBundledSkills(
      state.providerText,
      [
        ...(state.instance.adapter.capabilities.phoneMcp === true ? ["phoneMcp"] : []),
        ...(state.skillAuthoring ? ["skillAuthoring"] : []),
      ],
      availableSkills(),
    );
    if (!state.warmOnly) turnTrace(state.threadId, "skills-selected");
    if (state.selectedSkills.some((skill: any) => skill.manifest.requiredCapabilities.includes("phoneMcp"))) {
      state.integrations.phone = phoneIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
    }
    if (messagesWanted()) state.integrations.messages = messagesIntegration(state.bot.id, state.threadId, state.dispatchClaimId);
    // user-configured MCP servers (config.json mcpServers): only to a
    // driver that can mount them. Their tools are
    // never pre-allowed, so every call rides the normal permission flow.
    if (state.instance.adapter.capabilities.customMcp === true) {
      await refreshMcpOAuth(state.bot);
      if (!state.warmOnly) turnTrace(state.threadId, "oauth-refreshed");
      const mounted = mcpServersAsPerson(state.bot, orgSpeakerPrincipal(state.bot, state.speaker), state.threadId);
      attachCustomMcp(state.integrations, mounted.servers, cfg);
      state.githubWithheld = mounted.githubWithheld;
      if (!state.warmOnly) turnTrace(state.threadId, "mcp-mounted");
    }
    // The account's main Perspicax connection, as the person who speaks.
    // The fixed reserved mount is added after custom mounts; the early
    // prepare/handshake started above is awaited here (#1955).
    state.perspicaxPrompt = "";
    if (perspicaxPrepared || (IDENTITY.kind === "perspicax" && state.instance.adapter.capabilities.customMcp === true)) {
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
        await settlePerspicaxPrepare();
        throw new DirectTurnSetupCancelled("turn stopped during Perspicax setup");
      }
      const perspicax = await perspicaxTurnIntegration({
        bot: state.bot,
        threadId: state.threadId,
        generation: state.dispatchClaimId,
        speaker: state.speaker,
        taken: Object.keys(state.integrations.custom ?? {}),
        ...(state.warmOnly ? { quiet: true } : {}),
        ...(perspicaxPrepared ? { prepared: perspicaxPrepared } : {}),
      });
      if (!directTurnClaimIsCurrent(state.bot.id, state.dispatchClaimId, state.threadId)) {
        throw new DirectTurnSetupCancelled("turn stopped during Perspicax setup");
      }
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
  };
}
