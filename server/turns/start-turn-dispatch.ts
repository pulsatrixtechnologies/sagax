// @ts-nocheck
// #1388 wave 4 step 3: startTurn dispatch (handoffs.dispatching through sendTurn).
// Never imports server/index.ts.
import { resolveClaudeSubagentModel } from "../../shared/claude-subagent-model.ts";
import { ATTACHMENTS_DIR } from "../attachments/attachments.ts";
import { DATA_DIR } from "../config.ts";
import { claudeUserSkillsDir, claudeUserSkillsEnabled, forgetClaudeUserSkillsDir } from "../turn-settings.ts";
import { deferConnectorsPatch } from "./defer-connectors-patch.ts";
import { keepHubRows } from "./turn-connectors.ts";
import { dispatchedConnectorPlan } from "../connectors/turn-plan.ts";
import type { StartTurnHost } from "./start-turn-types.ts";
import type { TurnState } from "./start-turn-state.ts";
import { warmCachePrime } from "./warm-cache-prime.ts";
import { stablePromptSections } from "../system-prompt.ts";
import { clockAtHandoff } from "./turn-clock.ts";
import { soloPiTurnAccess } from "../pi-own-model-servers-access.ts";

export function createDispatchStartTurn(host: StartTurnHost) {
  const {
    DirectTurnSetupCancelled,
    IDENTITY,
    VOICE_FIRST_SENTENCE_SYSTEM,
    approvalModeForTurn,
    liveApprovalMode,
    auditFullAccessTurn,
    botRecoveryBackups,
    browserIsThePlace,
    callTurnEffort,
    cfg,
    connectorPlanForTurn,
    claudeUserMcpEnabled,
    clearCancelledProviderHandshake,
    confinedWhy,
    desktopLocalModels,
    desktopModelPersonFor,
    directTurnClaimExists,
    directTurnClaimIsCurrent,
    engineStartGate,
    engineTurnLevel,
    fitTurnImagesForModel,
    guardTurnDispatch,
    handoffs,
    harnessCommandSource,
    harnessCommands,
    holdBootEngineSlot,
    languageOfPerson,
    managedPolicy,
    mcpCallTimeoutMinutes,
    messageFileRootsForThread,
    cloudGuestOpened,
    routineApprovalWaitMs,
    noteBotRead,
    noteTurnQueued,
    orgSpeakerPrincipal,
    orgTurnAccess,
    pluginDirsFor,
    pickFastSentenceModel,
    replaysNatively,
    resolveEngineTurnEffort,
    runAsBotEngine,
    savedSteps,
    store,
    toolErrorCorrectiveRoundsFor,
    turnCommandEnvironment,
    turnConnectorsFor,
    turnNetworkProxy,
    turnTrace,
    typedCommandForTurn,
    voiceLatency,
    withDesktopModelPerson,
    withRecalled,
    withholdHostToolsFor,
  } = host;

  return async function dispatchStartTurn(state: TurnState): Promise<void> {
    // Before sendTurn: an adapter may emit the whole turn before it resolves.
    if (!state.warmOnly) handoffs.dispatching(state.threadId, state.dispatchClaimId, state.dispatchContext.handoff);
    // Read receipts (server/messages/read-receipts.ts): the person's words this turn
    // carries are what the bot has now seen. A card continuation carries
    // none of its own: it sees the conversation it resumes.
    if (!state.warmOnly) {
      const carriedIds = [state.userMessage.id, ...(state.opts?.excludeMessageIds ?? [])];
      const textIds = new Set(state.activeMessages.filter((m: any) => m.kind === "text" && !m.roomRequest).map((m: any) => m.id));
      noteBotRead(state.bot.id, state.threadId, carriedIds.some((id) => textIds.has(id)) ? carriedIds : state.contextOrder.filter((id: any) => textIds.has(id)));
    }
    // Slice 4: this turn's credentials (an owner key is read now).
    // (solo mode takes no extra await: its dispatch timing is unchanged; a
    // solo pi turn carries the person's own model servers, #2983)
    const turnAccess = IDENTITY.kind === "perspicax" ? await orgTurnAccess(state.threadId, state.bot, state.instance, state.speaker, state.routineModel ?? state.bot.modelSelection.model) : soloPiTurnAccess(state.instance);
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
      session: state.voiceBriefed ? "new" : "resumed"
    } } : undefined);
    // A call turn (and the warm that prepares its process, so the two share
    // one spawn contract) runs at the engine's low effort: the person is
    // waiting for the first word (server/voice/voice-call-effort.ts).
    // A pre-warm off a call (server/threads/thread-prewarm.ts) takes the next
    // turn's own effort and flags, or the turn would relaunch it.
    const turnEffort = state.onCall
      ? callTurnEffort({ driverKind: state.instance.driverKind, levels: state.instance.adapter.capabilities.effortLevels, effort: state.effort })
      : resolveEngineTurnEffort(state.effort, state.instance.driverKind, state.instance.adapter.capabilities.effortLevels);
    // A routine run while the server boots waits for an engine start slot
    // (server/engines/engine-start-gate.ts): the runs that came due during a
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
    // #2038: Claude sub-agents follow the routine override, else the routine
    // model, else the bot's fast model on this engine (shared/claude-subagent-model.ts).
    const subagentModel = resolveClaudeSubagentModel({
      routineSubagentModel: state.routineSubagentModel,
      routineModel: state.routineModel,
      fast: state.bot.modelSelection?.fast,
      turnInstanceId: state.instance.instanceId,
    });
    // #1137: when the owner pays, the owner's computer serves its model.
    const deskPerson = desktopModelPersonFor(state.bot, state.instance, state.speaker, state.turnPlace.principal);
    state.dispatch = await guardTurnDispatch(withDesktopModelPerson(deskPerson, () => runAsBotEngine(state.bot.id, () => {
      if (IDENTITY.kind === "perspicax") desktopLocalModels.assertAvailable(deskPerson, state.model, state.instance.driverKind);
      const replayRequest = state.personLine && !state.opts?.unattended && !state.guestConfined
        ? { botId: state.bot.id, message: state.userMessage, turnText: state.text, placePicked: state.wants === "local" && state.placeSource !== "auto-pin" }
        : null;
      const resultRoots = state.worksInWorkspace || state.guestConfined || cloudGuestOpened(state.threadId)
        ? undefined
        : messageFileRootsForThread(state.bot.id, state.threadId);
      const toolResultFolder = Array.isArray(resultRoots) ? resultRoots.find((root: string) => root !== ATTACHMENTS_DIR) : undefined;
      return savedSteps.dispatch.sendTurn(state.instance, replayRequest, {
      threadId: state.threadId,
      botId: state.bot.id,
      principalId: orgSpeakerPrincipal(state.bot, state.speaker),
      ...(state.compactPrompt ? { compactPrompt: state.compactPrompt } : {}),
      ...(state.agentsKnownUse ? { agentsKnownUse: state.agentsKnownUse } : {}),
      // the per-turn latency line's queue stage (drivers/acp/turn-latency.ts)
      ...(!state.warmOnly && typeof state.userMessage.at === "number" ? { receivedAt: state.userMessage.at } : {}),
      ...(turnAccess ? { access: turnAccess } : {}),
      // on a live call the engine process stays warm from turn to turn.
      // A warm uses the same flag so the first spoken turn's contract matches.
      ...(state.onCall ? { keepWarm: true } : {}),
      ...(state.warmOnly ? { warmOnly: true, ...warmCachePrime(Boolean(state.onCall), state.opts?.primeCache === true), ...(state.opts?.warmSignal ? { warmSignal: state.opts.warmSignal } : {}) } : {}),
      startupRecovery: !state.warmOnly &&
        (state.opts?.automaticRecoveryIndex ?? 0) < botRecoveryBackups(state.liveBot ?? state.bot, cfg).length,
      text: state.warmOnly ? "" : (engineCommand ? engineCommand.engineText : withRecalled(state.recalled, state.dispatchContext.turnText)),
      // read again as the engine takes the turn (below), and by an engine
      // the server calls itself before each model call
      ...(state.turnClock && !state.warmOnly && !engineCommand ? { turnClock: state.turnClock } : {}),
      ...(engineCommand ? { harnessCommand: { name: engineCommand.command.name, args: engineCommand.args, ...(engineCommand.command.path ? { path: engineCommand.command.path } : {}) } } : {}),
      ...(state.recalled && !state.warmOnly && !engineCommand ? { recalled: state.recalled } : {}),
      images: modelImages,
      approvalMode: engineTurnLevel(state.bot, state.threadId, auditFullAccessTurn(state.bot, state.threadId, approvalModeForTurn(state.bot, state.commsDepth > 0, state.threadId))),
      approvalModeNow: () => liveApprovalMode(state.bot, state.threadId, state.commsDepth > 0),
      toolScope: state.toolScope,
      ...(state.guestConfined ? { guestConfined: true, confinedWhy: confinedWhy(state.threadId) } : {}),
      model: state.model,
      ...(subagentModel ? { subagentModel } : {}),
      ...(state.routineEffort ? { subagentEffort: turnEffort } : {}),
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
      system: state.compactPrompt ? state.prompt.stable + state.prompt.volatile : state.prompt.text,
      systemStable: state.prompt.stable,
      systemVolatile: state.prompt.volatile,
      systemVolatileSections: state.prompt.volatileSections,
      ...(() => { const sections = stablePromptSections(state.prompt); return sections ? { systemStableSections: sections } : {}; })(),
      // the mentions half describes this turn: identical consecutive tags
      // must still deliver their note (SendTurnInput.mentionTurn)
      // and so does an interrupted call turn's marker
      mentionTurn: state.tagged.length > 0 || Boolean(state.userMessage.voiceCall?.interrupted),
      integrations: state.integrations,
      ...(withholdHostToolsFor(state.instance) ? { withholdHostTools: true } : {}),
      ...turnCommandEnvironment(state.instance, state.bot.id, state.threadId),
      toolErrorCorrectiveRounds: toolErrorCorrectiveRoundsFor(cfg, process.env, { botEnabled: state.bot.loopGuard }),
      // Auto may leave their computer mid-turn: the engine's own traffic
      // goes through it only when the Workspace is fixed there.
      ...(() => { const networkProxy = state.turnAuto?.auto ? undefined : turnNetworkProxy(state.threadId, state.bot.id, state.turnPlace); return networkProxy ? { networkProxy } : {}; })(),
      ...(state.integrations.browser && browserIsThePlace(state.plan) ? { preloadBrowserTools: true } : {}),
      mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp(),
      ...(() => {
        const userSkillsDir = claudeUserSkillsEnabled(cfg) ? claudeUserSkillsDir(DATA_DIR) : null;
        if (!claudeUserSkillsEnabled(cfg)) forgetClaudeUserSkillsDir(DATA_DIR);
        return userSkillsDir ? { userSkillsDir } : {};
      })(),
      // the plan of turn setup, for the access this dispatch materialized
      ...(() => {
        const plan = dispatchedConnectorPlan(state.threadId, state.connectorPlan ?? connectorPlanForTurn(state.bot, state.instance, state.speaker, state.threadId), turnAccess?.via);
        return { claudeAiConnectors: plan.claudeAi, grokCloudConnectors: plan.grokCloud };
      })(),
      ...pluginDirsFor(state.bot, state.instance, orgSpeakerPrincipal(state.bot, state.speaker)),
      mcpCallTimeoutMs: mcpCallTimeoutMinutes(cfg) * 60_000,
      ...(() => { const approvalWaitMs = routineApprovalWaitMs?.(state.threadId); return approvalWaitMs ? { approvalWaitMs } : {}; })(),
      cwd: state.cwd,
      ...(toolResultFolder ? { toolResultFolder } : {}),
    // The clock note says the time the engine takes the turn, after every
    // wait above (workspace, engine slot, a replay that fell back), not the
    // time the person's message arrived (server/turns/turn-clock.ts).
    }, (input: any) => state.instance.adapter.sendTurn(clockAtHandoff(input, new Date())));
    })), () => !directTurnClaimExists(state.bot.id, state.dispatchClaimId, state.threadId), async () => {
      await state.instance.adapter.interruptTurn(state.threadId).catch(() => {});
    });
    // Adapter accepted the turn (process reused or spawned).
    if (!state.warmOnly) turnTrace(state.threadId, "dispatched");
    // Dev panel Connectors card: after dispatched so the fsync'd bots save
    // stays off accept→send and off send→dispatched (#1950 leftover on #1971).
    if (!state.warmOnly) {
      const botId = state.bot.id;
      const threadId = state.threadId;
      const connectorsBot = state.liveBot ?? state.bot;
      const instance = state.instance;
      const speaker = state.speaker;
      const integrations = state.integrations;
      const principal = state.turnPlace.principal;
      const customMcp = state.instance.adapter.capabilities.customMcp === true;
      const connectorPlan = state.connectorPlan;
      deferConnectorsPatch(() => {
        store.patchTask(botId, threadId, {
          // #3357: the conversation's call_connector counters carry over
          connectors: keepHubRows(store.taskByThread(botId, threadId)?.connectors, turnConnectorsFor(connectorsBot, instance, speaker, integrations, principal, customMcp, threadId, connectorPlan)),
        });
        turnTrace(threadId, "connectors-patched");
      });
    }
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
              maxTokens: 1,
              // #3519: the account this turn signs in with
              ...(turnAccess ? { access: turnAccess } : {})
            }).catch(() => undefined);
          }
        }
      }
      return;
    }

  };
}
