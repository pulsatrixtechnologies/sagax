// @ts-nocheck
// #1388 wave 4 step 3: startTurn prompt build (sections through state.prompt).
// Never imports server/index.ts.
import { hideServerPathsInSections } from "../server-path-prompt.ts";
import { turnTracePayloadHash } from "./turn-trace.ts";
import { onDemandPromptParts, promptReferencesAvailable } from "../context/prompt-references.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";

export function createPromptStartTurn(host: StartTurnHost) {
  const {
    AUTO_COMPUTER_RULES,
    BUILT_IN_BROWSER_SYSTEM_PROMPT,
    BUILT_IN_DATA_SYSTEM_PROMPT,
    CALL_RECALL_BUDGET,
    CLAUDE_REUSE_VOLATILE_SECTIONS,
    COMPACT_VOLATILE_SECTIONS,
    DirectTurnSetupCancelled,
    HOSTED_WORKSPACE,
    LOCAL_RECALL_BUDGET,
    LOCAL_RECENT_WORK_LINES,
    REACTION_PROMPT,
    ROUTINE_EXECUTION_PROMPT,
    TEAM_MEMORY_PROMPT,
    WEBHOOK_PROMPT,
    WITHHELD_HOST_TOOLS_PROMPT,
    aiClientThreadPerson,
    approvalLevelPrompt,
    approvalModeForTurn,
    autoPayerKey,
    autoRecallPrompt,
    botUserName,
    botUserProfile,
    buildSystemPrompt,
    cfg,
    compactPromptFor,
    compactVolatileOrder,
    computerPrompt,
    computerSelectionTurns,
    computerSkippedNote,
    coordinationSystemInstructions,
    coordinator,
    customMcpPrompt,
    devPodsPrompt,
    devPodsThreads,
    docsIndexPrompt,
    effectiveBotOwner,
    engineConnectorsPromptFor,
    engineDisplayName,
    finishUntilPrompt,
    githubWithheldPrompt,
    idleEngines,
    isLocalModelId,
    lightenColdPrompt,
    limitFailover,
    localVmMode,
    longCommandsPrompt,
    markWorkspaceUse,
    measureContextBuckets,
    memoryPromptFor,
    mentionPrompt,
    modelFallbackByPayer,
    modelFallbackByThread,
    modelFallbackPayerKey,
    modelPrompt,
    myChromePromptFor,
    orgSpeakerPrincipal,
    outstandingAssignmentsPrompt,
    ownerPaysForMember,
    parseLocalPromptMode,
    peerContactPrompt,
    peerName,
    peerReviewRequired,
    proactiveModeFor,
    proactivePrompt,
    promptSectionPaths,
    recentWorkFor,
    recentWorkPrompt,
    redactSecretsInText,
    refreshStreamDigests,
    resolveComputerPromptKind,
    richOutputPrompt,
    roomHandoffProblem,
    rulesSystemPrompt,
    runningTurnEngines,
    scopedSkillsPrompt,
    sectionContextSystemPrompt,
    setupSystemPrompt,
    skillDiscoveryAvailable,
    soloGoalSystemPrompt,
    soloGoals,
    store,
    streamDigestPrompt,
    streamTurn,
    surfacePrompt,
    teamAvailabilityPart,
    teamComputerPrompt,
    teamMemory,
    toolDefinitionBytes,
    turnConnectorsFor,
    turnContextBuckets,
    turnPromptBytes,
    turnReachPrompt,
    turnTrace,
    uniquePeerName,
    userProfileSystemPrompt,
    usesCompactPrompt,
    usesStablePrompt,
    withholdHostToolsFor,
    workspaceCwdPrompt,
    workspaceLocationsPrompt,
    sandboxFolderFor,
    serverPathView,
    renderSkillInstructions,
  } = host;

  return async function promptStartTurn(state: TurnState): Promise<void> {
    state.computerPromptKind = resolveComputerPromptKind({
      kind: state.computerKind,
      vmPrivate: localVmMode(cfg) === "per-bot"
    });
    if (!state.warmOnly) turnTrace(state.threadId, "prompt-start");
    state.coordinationNode = state.opts?.coordination ? coordinator.node(state.opts.coordination.id) : undefined;
    if (state.opts?.coordination && (!state.coordinationNode || state.coordinationNode.status !== "running" || roomHandoffProblem(state.coordinationNode,
      state.coordinationNode.parentId ? coordinator.node(state.coordinationNode.parentId) : undefined))) {
      throw new DirectTurnSetupCancelled("Coordination access changed before dispatch");
    }
    // Single stream (thread mode off): a person's turn in a stream segment
    // carries the digest of their earlier topics (server/streams/single-stream.ts),
    // never on a call (a phone turn stays short), and those topics leave
    // the recent-work brief so nothing is said twice.
    state.streamPart = !state.onCall && streamTurn(state.bot, state.threadId, { person: state.commsDepth === 0 && !state.coordinationNode && !state.opts?.automationSource && !state.opts?.unattended && !state.warmOnly && !state.userMessage.peerAsk })
      ? streamDigestPrompt(state.bot, state.threadId) : null;
    if (state.streamPart?.text) refreshStreamDigests(state.bot.id, state.threadId);
    // Stable prefix on every engine. Compact tool list on Claude Code only,
    // local or cloud: Grok, Codex and Pi discover tools from the full list.
    const promptMode = {
      bot: parseLocalPromptMode((state.liveBot ?? state.bot).localPrompt),
      engine: parseLocalPromptMode(process.env.SAGAX_LOCAL_PROMPT)
    };
    state.stablePrompt = usesStablePrompt(promptMode);
    state.compactPrompt = usesCompactPrompt({ ...promptMode, driverKind: state.instance.driverKind, model: state.model })
      ? compactPromptFor(state.liveBot ?? state.bot, typeof state.turnPrincipal === "string" && state.turnPrincipal ? state.turnPrincipal : effectiveBotOwner(state.bot))
      : undefined;
    const promptApprovalLevel = approvalModeForTurn(state.bot, state.commsDepth > 0, state.threadId);
    // Cold / automation turns (routines, webhooks, proactive): tighter
    // per-section budgets, lazy skill index, short rich-output (V1/R3).
    state.coldPrompt = state.opts?.automationSource !== undefined;
    // 2026-11-02 (production): an engine without file tools on the Sagax
    // server is never given a path of it (server/server-path-prompt.ts)
    const serverFiles = !withholdHostToolsFor(state.instance);
    const environmentFolder = serverFiles ? null : sandboxFolderFor?.(state.bot.id) ?? null;
    state.promptParts = [
      { id: "finish-until", label: "Do not finish until", text: finishUntilPrompt((state.liveBot ?? state.bot).finishUntil) },
      // #1372: a 1:1 goal's instruction, while it works; never the person's message
      { id: "goal", label: "Goal", text: soloGoalSystemPrompt(soloGoals.get(state.threadId)) },
      { id: "user-profile", label: "About the user", text: userProfileSystemPrompt(botUserProfile(state.bot)) },
      { id: "ai-client", label: "AI client", text: aiClientThreadPerson(state.bot, state.threadId, state.commsDepth, state.userMessage) },
      { id: "model", label: "Model", text: state.onCall ? "" : modelPrompt({ engine: engineDisplayName(state.instance), model: String(state.model ?? ""), actual: modelFallbackByThread.get(state.threadId)?.requested === state.model ? modelFallbackByThread.get(state.threadId)?.actual : modelFallbackByPayer.get(modelFallbackPayerKey(state.threadId, state.instance.instanceId, String(state.model ?? ""))) }) },
      // first after the soul: the block names agent tools, so it only goes
      // to a turn whose engine actually mounted them (setupMode is already
      // false when they are not — see agentsMounted above)
      { id: "setup", label: "Setup", text: setupSystemPrompt(state.setupMode, { skills: state.skillAuthoring, cwd: state.liveBot?.cwd ?? state.bot.cwd }) },
      { id: "files", label: "File locations", text: state.worksInWorkspace ? workspaceLocationsPrompt(state.bot.id, state.cwd, state.liveBot?.cwd ?? state.bot.cwd, { attachFile: Boolean(state.integrations.agents) && !HOSTED_WORKSPACE, confidential: store.isConfidentialThread(state.threadId), relativePaths: state.instance.driverKind === "claudeAgent", ...(state.stablePrompt ? { cwdElsewhere: true } : {}), serverFiles, environmentFolder }) : "" },
      // The conversation's own folder, on its own line, so the rest of the
      // file locations is the same bytes in every conversation of this bot.
      { id: "files-cwd", label: "Current working folder", text: state.stablePrompt && state.worksInWorkspace && serverFiles ? workspaceCwdPrompt(state.cwd) : "" },
      { id: "shell", label: "Long-running commands", text: state.worksInWorkspace ? longCommandsPrompt(state.computerPromptKind) : "" },
      { id: "computer", label: "Computer", text: computerPrompt(state.computerPromptKind) },
      { id: "team-computer", label: "Team computer", text: teamComputerPrompt(state.teamComputer) },
      // Auto's standing rules, volatile: a reused session gets them once;
      // each message carries only where it starts (withWorkplaceNote)
      { id: "workplace", label: "Workspace", text: state.turnAuto?.auto ? `\n${AUTO_COMPUTER_RULES}` : "" },
      { id: "plan", label: "Surface", text: surfacePrompt({ computer: state.mountedComputer, browser: Boolean(state.integrations.browser) }, { pinned: state.plan.pinned, note: state.plan.note + state.vpsUnavailableNote + (state.computerSkipped && state.plan.computer !== "off" ? computerSkippedNote(redactSecretsInText(state.computerSkipped)) : ""), canSelect: computerSelectionTurns.has(state.threadId) || (state.warmOnly && state.maySelectComputer), cloudHome: false }) },
      { id: "cloud-home", label: "OMB Cloud", text: "" },
      // gated on the integration, not the key: the hint only goes to a
      // bot whose driver actually mounted the tools
      { id: "mcp", label: "MCP servers", text: customMcpPrompt(Object.keys(state.integrations.custom ?? {})) + githubWithheldPrompt(state.githubWithheld) },
      { id: "perspicax", label: "Perspicax", text: state.perspicaxPrompt },
      // run_with_engine is shown to a person's own direct turn only (not one hop away)
      { id: "claude-ai", label: "Claude connectors", text: engineConnectorsPromptFor(state.liveBot ?? state.bot, state.instance, state.speaker, { level: promptApprovalLevel, relay: Boolean(state.integrations.agents) && state.commsDepth === 0 }) },
      // the level this turn really runs at (approvalModeForTurn), so Full never asks for a typed GO
      { id: "approval-level", label: "Approval level", text: approvalLevelPrompt(promptApprovalLevel) },
      // #1819: effective ask-before-contact (Full skips the Sagax peer card)
      { id: "peer-contact", label: "Peer contact", text: peerContactPrompt({
        canContact: Boolean(state.coordinationPrompt),
        asksBeforeContact: peerReviewRequired(state.liveBot ?? state.bot, state.threadId)
      }) },
      // 2026-10-30: the bot knows it is proactive, and how (server/proactive/proactive-wake.ts)
      { id: "proactive", label: "Proactive", text: proactivePrompt(proactiveModeFor(state.liveBot ?? state.bot)) },
      // what this turn reaches, in one line: "what connectors do you have" needs no tool call (server/turns/turn-reach.ts)
      { id: "reach", label: "Reach", text: turnReachPrompt(state.liveBot ?? state.bot, state.instance, state.speaker, state.threadId, state.integrations, Boolean(state.mountedComputer)) },
      { id: "browser", label: "Browser", text: state.integrations.browser ? BUILT_IN_BROWSER_SYSTEM_PROMPT + myChromePromptFor(state.bot, state.threadId) : "" },
      { id: "data", label: "Data", text: state.integrations.data ? BUILT_IN_DATA_SYSTEM_PROMPT : "" },
      { id: "coordination", label: "Team", text: state.coordinationPrompt ? ` ${state.coordinationPrompt}` : "" },
      { id: "assignment", label: "Teammate task", text: state.coordinationNode?.parentId || (state.warmOnly && state.opts?.warmCoordination === true) ? `\n${coordinationSystemInstructions()}` : "" },
      { id: "outstanding", label: "Outstanding teammate work", text: outstandingAssignmentsPrompt(state.threadId) },
      { id: "credential", label: "Credentials", text: state.credentialPrompt },
      // its own paragraph, so a smaller model reads it as a rule of its
      // own; never on a call (the tools are not shown there either)
      { id: "reactions", label: "Reactions", text: state.integrations.agents && !state.onCall ? REACTION_PROMPT : "" },
      { id: "recall", label: "Recall", text: state.recallPrompt },
      { id: "routine", label: "Routines", text: state.routinePrompt },
      { id: "routine-execution", label: "Routine execution", text: state.opts?.automationSource === "schedule" || state.opts?.automationSource === "manual" ? ROUTINE_EXECUTION_PROMPT : "" },
      { id: "profile", label: "Profile changes", text: state.profilePrompt },
      { id: "learn", label: "Skill authoring", text: state.learnPrompt },
      { id: "rich-output", label: "Rich output", text: richOutputPrompt((state.liveBot ?? state.bot).emailDrafts !== false) },
      { id: "dev-pods", label: "Coding view", text: devPodsPrompt(devPodsThreads.isOn(state.threadId)) },
      { id: "section-context", label: "Section context", text: sectionContextSystemPrompt(state.bot.section) },
      { id: "team-memory", label: "Team memory", text: teamMemory.systemPrompt(state.bot.section) + (state.integrations.agents ? TEAM_MEMORY_PROMPT : "") },
      // who on the team roster is busy right now; volatile, so a teammate
      // starting or finishing work never changes the stable half
      teamAvailabilityPart(state.coordinationPrompt ? state.sectionPeers : []),
      // what the bot said lately in its other conversations, so a task
      // never redoes — or forgets — what another one already did
      // not on a call: a phone turn stays short (docs/voice-mode-xai.md, "Latency")
      { id: "recent", label: "Recent work", text: state.onCall ? "" : recentWorkPrompt(recentWorkFor(state.bot, state.threadId, { userName: botUserName(state.bot) }).filter((line: any) => !state.streamPart?.threadIds.has(line.threadId)).slice(0, state.compactPrompt ? LOCAL_RECENT_WORK_LINES : undefined)) },
      { id: "stream", label: "Earlier topics", text: state.streamPart?.text ?? "" },
      // RULES.md: listed here, placed right after the soul by buildSystemPrompt
      { id: "rules", label: "Rules (RULES.md)", text: rulesSystemPrompt(state.bot.id, { writes: Boolean(state.integrations.agents) }) },
      { id: "memory", label: "Memory", text: memoryPromptFor(state.bot, { managedWrites: Boolean(state.integrations.agents), fileTools: state.worksInWorkspace, withholdHostTools: withholdHostToolsFor(state.instance) }) },
      { id: "host-tools", label: "Host tools", text: withholdHostToolsFor(state.instance) ? WITHHELD_HOST_TOOLS_PROMPT : "" },
      // docs/: an index only, never the documents (server/workspace/workspace-files.ts)
      { id: "docs", label: "Documents index", text: docsIndexPrompt(state.bot.id, { tools: state.integrations.agents ? "agents" : state.worksInWorkspace && serverFiles ? "files" : "none" }) },
      // liveBot was captured before awaited setup work; an assignment PUT
      // in that window must still reach this turn's prompt.
      { id: "skills", label: "Skills index", text: scopedSkillsPrompt(state.bot, state.instance, orgSpeakerPrincipal(state.bot, state.speaker), { managedTools: skillDiscoveryAvailable(Boolean(state.integrations.agents), state.toolScope), fileAccess: Boolean(state.privateWorkspace), syncNative: true, nativeWorkspace: state.privateWorkspace, indexOnly: state.coldPrompt })?.text ?? "" },
      { id: "skill-instructions", label: "Skill instructions", text: state.coldPrompt ? "" : serverFiles ? state.skillInstructions : renderSkillInstructions(state.selectedSkills, { includeRoot: false }) },
      { id: "playbooks", label: "Playbooks", text: state.coldPrompt ? "" : state.packagePlaybooks },
      { id: "webhook", label: "Webhook provenance", text: state.opts?.automationSource === "webhook" ? WEBHOOK_PROMPT : "" },
      { id: "mentions", label: "Mentions", text: state.boundedCoordination && state.tagged.length ? `The user named these existing teammates: ${state.tagged.map((b: any) => uniquePeerName(b, state.sectionPeers) ? peerName(b.name) : `${peerName(b.name)} (${b.id})`).join(", ")}. Use coordinate_bots when their contribution is needed (a unique name works as its bot_ids entry), with relay=true when the user only wants one teammate's own answer passed back; do not substitute native helper agents for these bots.` : mentionPrompt(state.tagged) },
      // a voice call: the phone-call instruction (server/voice/voice-call-prompt.ts)
      { id: "voice-call", label: "Phone call", text: state.voiceCallText },
    ];
    if (!serverFiles) {
      const hidden = hideServerPathsInSections(state.promptParts, serverPathView(state.bot.id));
      if (hidden.leaked.length) console.warn(`[prompt] server paths hidden for ${state.bot.id} (no server file tools): ${hidden.leaked.join(", ")}`);
      state.promptParts = hidden.sections;
    }
    if (!state.warmOnly) turnTrace(state.threadId, "prompt-sections");
    state.promptParts = onDemandPromptParts(state.promptParts, promptReferencesAvailable(Boolean(state.integrations.agents), state.toolScope));
    state.builtPrompt = buildSystemPrompt(state.persona, state.liveBot?.soul ?? state.bot.soul ?? "", state.coldPrompt ? lightenColdPrompt(state.promptParts) : state.promptParts, state.stablePrompt || state.instance.driverKind === "claudeAgent"
      ? new Set([
        ...(state.instance.driverKind === "claudeAgent" ? CLAUDE_REUSE_VOLATILE_SECTIONS : []),
        ...(state.stablePrompt ? COMPACT_VOLATILE_SECTIONS : []),
      ])
      : undefined);
    state.prompt = state.stablePrompt ? compactVolatileOrder(state.builtPrompt) : state.builtPrompt;
    turnPromptBytes.set(state.threadId, { stable: Buffer.byteLength(state.prompt.stable), volatile: Buffer.byteLength(state.prompt.volatile) });
    const catalogBytes = toolDefinitionBytes(state.integrations.agents?.env);
    const buckets = measureContextBuckets({
      sections: state.prompt.sections,
      promptBytes: Buffer.byteLength(state.prompt.stable) + Buffer.byteLength(state.prompt.volatile),
      messages: state.transcript.length,
      messageBytes: state.transcript.reduce((sum: any, entry: any) => sum + Buffer.byteLength(entry.text ?? ""), 0),
      toolsBytes: catalogBytes.tools,
      agentsBytes: catalogBytes.agents
    });
    if (buckets) turnContextBuckets.set(state.threadId, buckets);
    else turnContextBuckets.delete(state.threadId);
    // the dev panel's Connectors card: what this turn really reached
    if (!state.warmOnly) store.patchTask(state.bot.id, state.threadId, { connectors: turnConnectorsFor(state.liveBot ?? state.bot, state.instance, state.speaker, state.integrations, state.turnPlace.principal, state.instance.adapter.capabilities.customMcp === true) });
    if (!state.warmOnly) turnTrace(state.threadId, "connectors-patched");
    if (!state.warmOnly) turnTrace(state.threadId, "state.prompt-built");
    // the Files list's "last used": what this turn's prompt carried
    markWorkspaceUse(state.bot.id, promptSectionPaths(state.prompt.sections));
    // Automatic recall rides in front of THIS turn's message, never in the
    // system prompt: the volatile half is re-sent whole whenever any part of
    // it changes, and recall changes nearly every turn.
    state.recalled = autoRecallPrompt(state.bot, state.threadId, state.resolvedImages.text, {
      // a routine run starts fresh by design, and a webhook is untrusted:
      // neither pulls earlier conversations in. A call turn takes a
      // couple of notes, never other conversations: what the engine
      // reads before it can answer is the pause the person hears.
      conversations: state.commsDepth === 0 && !state.coordinationNode && !state.opts?.automationSource && !state.opts?.unattended && !state.onCall,
      userName: botUserName(state.bot),
      ...(state.onCall ? { budget: CALL_RECALL_BUDGET } : state.compactPrompt ? { budget: LOCAL_RECALL_BUDGET } : {})
    });
    if (!state.warmOnly) turnTrace(state.threadId, "recall");
    if (!state.warmOnly && process.env.SAGAX_TURN_TRACE === "1") {
      turnTracePayloadHash(state.threadId, {
        system: `${state.prompt.stable}${state.prompt.volatile}`,
        systemStable: state.prompt.stable,
        systemVolatile: state.prompt.volatile,
        transcript: state.transcript,
        text: state.recalled ? `${state.recalled}\n\n${state.dispatchContext.turnText}` : state.dispatchContext.turnText,
        integrations: state.integrations,
        model: String(state.model ?? ""),
        effort: state.effort ?? null,
        resumeCursor: typeof state.dispatchContext.resumeCursor === "string" ? state.dispatchContext.resumeCursor : "",
        sessionReset: state.dispatchContext.sessionReset === true,
      });
    }
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
  };
}
