// @ts-nocheck
// #1383: room-member launch, dispatch. Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import { ATTACHMENTS_DIR } from "../attachments/attachments.ts";
import { DATA_DIR } from "../config.ts";
import { claudeUserSkillsDir, claudeUserSkillsEnabled, forgetClaudeUserSkillsDir } from "../turn-settings.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";
import { roomSubagentModel } from "./group-member-turn-room-model.ts";
import { connectorPlanAt } from "../connectors/turn-plan.ts";
import { soloPiTurnAccess } from "../pi-own-model-servers-access.ts";

export function createGuardRoomMemberDispatch(host: GroupMemberTurnHost) {
  const {
    activeGroupSpeaker,
    groupSpeakers,
    retryDelegationsWaitingOn,
    store,
    watchdog,
  } = host;

  return function guardRoomMemberDispatch(ctx: GroupMemberTurnCtx) {
    const { isCancelled, group, bot, threadId } = ctx;
  if (
    isCancelled?.() ||
    store.group(group.id)?.busyBotId !== bot.id ||
    store.bot(bot.id)?.busy !== true
  ) {
    groupSpeakers.delete(threadId);
    const remaining = activeGroupSpeaker(group.id);
    store.patchGroup(group.id, { busyBotId: remaining?.botId ?? null, unread: true });
    if (store.bot(bot.id)?.busy) {
      store.setActivity(bot.id, "idle");
      retryDelegationsWaitingOn(bot.id);
    }
    watchdog.settle(threadId);
    return false;
  }
  };
}

export function createBeginRoomMemberOutcome(host: GroupMemberTurnHost) {
  const {
    IDENTITY,
    EngineAccessLost,
    RoomTurnDeadline,
    accessCardFor,
    auditFullAccessTurn,
    autoRecallPrompt,
    bindInternalCapabilityToProviderTurn,
    browserIsThePlace,
    bus,
    cfg,
    connectorPlanForTurn,
    claudeUserMcpEnabled,
    clearCancelledProviderHandshake,
    confinedWhy,
    deliverableNotification,
    desktopLocalModels,
    desktopModelPersonFor,
    effectiveRoomTurnTimeoutMinutes,
    engineAccessNotice,
    engineDisplayName,
    engineTurnLevel,
    extractTurnImages,
    failedTurnTool,
    fitTurnImagesForModel,
    groupEngineCommandRoute,
    guardTurnDispatch,
    harnessCommandSource,
    harnessCommands,
    idleEngines,
    languageOfPerson,
    managedPolicy,
    markCancelledProviderHandshake,
    markWorkspaceUse,
    mcpCallTimeoutMinutes,
    memberTurnSelection,
    noteBotRead,
    notifyAccess,
    orgSpeakerPrincipal,
    orgTurnAccess,
    pluginDirsFor,
    promptSectionPaths,
    randomUUID,
    retireProviderTurn,
    roomRoutineSpeaker,
    roomStallCompletions,
    roomTurnApprovalMode,
    roomTurnEnd,
    roomTurnLevels,
    roomTurnTimeoutMessage,
    roomTurnTimeoutMinutes,
    runningTurnEngines,
    shouldIgnoreProviderEvent,
    stoppedTurnText,
    store,
    toolErrorCorrectiveRoundsFor,
    turnCommandEnvironment,
    turnNetworkProxy,
    turnPromptBytes,
    typedCommandForTurn,
    unavailableCommandError,
    watchdog,
    withDesktopModelPerson,
    withRecalled,
    withholdHostToolsFor,
    cloudGuestOpened,
    supportsWorkspaceFiles,
    messageFileRootsForThread,
    runAsBotEngine,
    roomMemberContexts,
    broadcast,
    publicGroupState,
  } = host;

  return function beginRoomMemberOutcome(ctx: GroupMemberTurnCtx) {
    const {
      threadId, bot, group, groupId, readyBot, readyGroup, instance, orchestration, isCancelled,
      cardContinuation, hop, operation, latestUser, resolvedLatestImages, roomConsumedId, roomSystem,
      text, cwd, turnImages, roomPlace, roomPlan, integrations, roomToolScope, roomGuestConfined,
      roomPrincipal, roomSpeakerId, roomTurnSelection, internalGeneration, onProviderHandshakeStarted,
      onProviderHandshakeSettled, onDispatchError, userName, roomCompactPrompt, roomAgentsKnownUse,
      roomConnectorPlan,
    } = ctx;
  const worksInWorkspace = supportsWorkspaceFiles(instance.driverKind);
  ctx.replyText = "";
  // Every assistant message of this turn, in order: the room hears the last
  // one (room-reply.ts), the rest are working notes.
  ctx.turnTexts = [];
  ctx.turnCompletedOk = false;
  ctx.providerTurnId = undefined;
  let abandoned = false;
  const retirementOwner = `room-abandoned:${randomUUID()}`;
  const abandonProviderTurn = () => {
    if (abandoned) return;
    abandoned = true;
    watchdog.settle(threadId);
    if (ctx.providerTurnId) retireProviderTurn(ctx.providerTurnId);
    else markCancelledProviderHandshake(threadId, retirementOwner);
  };
  const liveGroup = store.group(groupId) ?? group;
  const timeoutMinutes = effectiveRoomTurnTimeoutMinutes(
    roomTurnTimeoutMinutes(cfg),
    liveGroup.dm
      ? liveGroup.turnTimeoutMinutes
      : store.groupTaskByThread(liveGroup.id, threadId)?.turnTimeoutMinutes,
  );
  return new Promise((resolve) => {
    let done = false;
    let unsub = () => {};
    let unregisterStall = () => {};
    const deadline = new RoomTurnDeadline(timeoutMinutes, () => {
      if (orchestration) orchestration.result.stopReason = stoppedTurnText(threadId, ctx.providerTurnId, roomTurnTimeoutMessage(bot.name, timeoutMinutes));
      abandonProviderTurn();
      void instance.adapter.interruptTurn(threadId).catch(() => {});
      store.appendMessage(threadId, {
        role: "bot",
        kind: "activity",
        from: { botId: bot.id, name: bot.name, color: bot.color },
        tool: { name: roomTurnTimeoutMessage(bot.name, timeoutMinutes), ok: false }
      });
      finish("timed_out");
    });
    let releaseTurnLevel = () => {};
    const finish = (value: GroupMemberTurnOutcome) => {
      if (done) return;
      done = true;
      releaseTurnLevel();
      deadline.stop();
      unsub();
      unregisterStall();
      resolve(value);
    };
    unsub = bus.subscribe((e: RuntimeEvent) => {
      if (shouldIgnoreProviderEvent(e)) return;
      if (e.threadId !== threadId) return;
      if (ctx.providerTurnId && e.turnId && e.turnId !== ctx.providerTurnId) return;
      if (e.type === "item.completed" && e.itemType === "assistant_text") {
        ctx.replyText += `\n${e.text}`;
        ctx.turnTexts.push(e.text);
      } else if (e.type === "turn.completed") {
        ctx.turnCompletedOk = e.ok;
        const end = roomTurnEnd(e, Boolean(orchestration), ctx.roomClaimFailure);
        // An assignment's requester hears the runtime's cause, not "error".
        if (orchestration && end.stopReason !== undefined) {
          orchestration.result.stopReason = ctx.roomClaimFailure ? end.stopReason : stoppedTurnText(threadId, e.turnId, undefined, end.stopReason);
        }
        finish(end.outcome);
      }
      // Waiting on a person is not turn work: hold the ceiling while an
      // approval or question card is open, so deciding slowly does not
      // stop the turn underneath the card. Everything else keeps burning it.
      else if (e.type === "request.opened") deadline.setWaitingOnHuman(true);
      else if (e.type === "request.resolved") deadline.setWaitingOnHuman(false);
    });
    deadline.start();
    // Swap the setup latch for the real completion handler. The swap is
    // synchronous with the dispatch below, so no stall can fall between
    // them. A stall latched during setup completes the turn here without a
    // provider turn: the stopped message is already on the thread, and the
    // watchdog's bounded cleanup owns releasing the claim.
    ctx.unregisterSetupStall();
    if (ctx.setupStallCause !== undefined) {
      if (orchestration) orchestration.result.stopReason = stoppedTurnText(threadId, undefined, ctx.setupStallCause);
      // No provider turn was launched, so there is no ambiguous event
      // window to quarantine: marking a cancelled handshake here would
      // strand the next turn behind its TTL for no benefit. The readiness
      // stop path above skips the mark for the same reason.
      finish("stalled");
      return;
    }
    unregisterStall = roomStallCompletions.register(threadId, (cause) => {
      if (orchestration) orchestration.result.stopReason = stoppedTurnText(threadId, ctx.providerTurnId, cause);
      abandonProviderTurn();
      finish("stalled");
    });
    onProviderHandshakeStarted?.();
    ctx.providerDispatched = true;
    host.clearHeldReplay(group.id, bot.id, ctx.heldReplayIds ?? []);
    if (roomConsumedId) noteBotRead(readyBot.id, threadId, [roomConsumedId]);
    turnPromptBytes.set(threadId, { stable: Buffer.byteLength(roomSystem.stable), volatile: Buffer.byteLength(roomSystem.volatile) });
    markWorkspaceUse(bot.id, promptSectionPaths(roomSystem.sections));
    runningTurnEngines.set(threadId, instance);
    idleEngines.noteBusy(threadId);
    // notes only in a room: a private chat reaches a room through the
    // explicit, disclosed session_search, never automatically
    const roomRecalled = cardContinuation ? "" : autoRecallPrompt(bot, threadId, resolvedLatestImages.text, { conversations: false, userName, audience: { kind: "room", id: readyGroup.id } });
    const roomSpeaker: TurnSpeaker = roomSpeakerId ? { origin: "person", principalId: roomSpeakerId, groupId } : roomRoutineSpeaker(threadId) ?? { origin: "operator" };
    // The person's engine command for this member (shared/harness-commands.ts
    // groupCommandTarget): it reaches the engine verbatim, like in a 1:1.
    const roomCommandRoute = hop === 0 && !cardContinuation && !orchestration && latestUser?.text
      ? groupEngineCommandRoute(readyGroup, latestUser.text, readyGroup.memberIds.map((id) => store.bot(id)).filter((member): member is BotRecord => Boolean(member && !member.hidden)), latestUser.channelMode, operation?.queuedQueueIds?.length ?? 0)
      : null;
    const roomCommandFor = async (roomTurnAccess: TurnAccess | undefined): Promise<CommandResolution> => {
      if (roomCommandRoute?.botId !== readyBot.id) return { kind: "none" };
      const typed = await typedCommandForTurn(extractTurnImages(roomCommandRoute.commandText).text, harnessCommandSource(readyBot, threadId, {
        scope: {
          botId: readyBot.id,
          ...(cwd ? { cwd } : {}),
          ...(withholdHostToolsFor(instance) ? { withholdHostTools: true } : {}),
          mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp()
        },
        speaker: roomSpeaker,
        ...(roomTurnAccess ? { access: roomTurnAccess } : {}),
        group: readyGroup
      }), harnessCommands);
      if (typed.kind === "unavailable") throw new Error(unavailableCommandError(typed).error);
      return typed;
    };
    // The permission requests this turn raises are judged at the level it
    // was sent with, a Primary Bot's delegated level included (request.opened).
    const turnApprovalMode = roomTurnApprovalMode(readyBot, threadId, orchestration);
    if (!done) releaseTurnLevel = roomTurnLevels.dispatched(threadId, readyBot.id, turnApprovalMode);
    // A bot whose context in this room is nearly full (or that the person
    // asked to compact) starts this turn on a fresh provider session; the
    // room's recent transcript is what every room turn carries anyway.
    const roomReset = roomMemberContexts.takeReset(threadId, readyBot.id, cfg.context);
    if (roomReset) {
      store.appendMessage(threadId, {
        role: "bot", kind: "activity", from: { botId: readyBot.id, name: readyBot.name, color: readyBot.color },
        tool: { name: roomReset.reason === "requested"
          ? `compacted ${readyBot.name}'s context (${roomReset.percent}% full): fresh session with the room's recent messages`
          : `${readyBot.name}'s context was ${roomReset.percent}% full: compacted to a fresh session with the room's recent messages`, ok: true },
      });
      broadcast({ kind: "group", group: publicGroupState(store.group(groupId) ?? group) });
    }
    
      // --- launch + stream (sendTurn / guardTurnDispatch / .then) ---
const sendRoomTurn = async (roomTurnAccess: TurnAccess | undefined) => {
      const roomCommand = await roomCommandFor(roomTurnAccess);
      const engineCommand = roomCommand.kind === "engine" ? roomCommand : null;
      const resultRoots = worksInWorkspace || roomGuestConfined || cloudGuestOpened(threadId)
        ? undefined
        : messageFileRootsForThread(readyBot.id, threadId);
      const toolResultFolder = Array.isArray(resultRoots) ? resultRoots.find((root: string) => root !== ATTACHMENTS_DIR) : undefined;
      return instance.adapter.sendTurn({
        ...(roomReset ? { sessionReset: true } : {}),
        threadId,
        botId: readyBot.id,
        principalId: orgSpeakerPrincipal(readyBot, roomSpeaker),
        ...(roomCompactPrompt ? { compactPrompt: roomCompactPrompt } : {}),
        ...(roomAgentsKnownUse ? { agentsKnownUse: roomAgentsKnownUse } : {}),
        ...(roomTurnAccess ? { access: roomTurnAccess } : {}),
        text: engineCommand ? engineCommand.engineText : withRecalled(roomRecalled, text),
        ...(roomRecalled && !engineCommand ? { recalled: roomRecalled } : {}),
        ...(engineCommand ? { harnessCommand: { name: engineCommand.command.name, args: engineCommand.args, ...(engineCommand.command.path ? { path: engineCommand.command.path } : {}) } } : {}),
        images: await fitTurnImagesForModel(turnImages, { language: languageOfPerson(roomSpeakerId) }),
        approvalMode: engineTurnLevel(readyBot, threadId, auditFullAccessTurn(readyBot, threadId, turnApprovalMode)),
        toolScope: roomToolScope,
        ...(roomGuestConfined ? { guestConfined: true, confinedWhy: confinedWhy(threadId) } : {}),
        system: roomSystem.text,
        systemStable: roomSystem.stable,
        systemVolatile: roomSystem.volatile,
        systemVolatileSections: roomSystem.volatileSections,
        cwd,
        ...(toolResultFolder ? { toolResultFolder } : {}),
        integrations,
        ...(withholdHostToolsFor(instance) ? { withholdHostTools: true } : {}),
        ...turnCommandEnvironment(instance, readyBot.id, threadId),
        toolErrorCorrectiveRounds: toolErrorCorrectiveRoundsFor(cfg, process.env, { botEnabled: readyBot.loopGuard }),
        ...(() => { const networkProxy = turnNetworkProxy(threadId, readyBot.id, roomPlace); return networkProxy ? { networkProxy } : {}; })(),
        ...(integrations.browser && browserIsThePlace(roomPlan) ? { preloadBrowserTools: true } : {}),
        mcpFromUserConfig: claudeUserMcpEnabled(cfg, IDENTITY.kind === "perspicax") && !managedPolicy.restrictsMcp(),
        ...(() => {
          const userSkillsDir = claudeUserSkillsEnabled(cfg) ? claudeUserSkillsDir(DATA_DIR) : null;
          if (!claudeUserSkillsEnabled(cfg)) forgetClaudeUserSkillsDir(DATA_DIR);
          return userSkillsDir ? { userSkillsDir } : {};
        })(),
        // the plan of the room turn's setup, for the access this dispatch materialized
        ...(() => {
          const plan = connectorPlanAt(roomConnectorPlan ?? connectorPlanForTurn(readyBot, instance, roomSpeaker, threadId), roomTurnAccess?.via);
          return { claudeAiConnectors: plan.claudeAi, grokCloudConnectors: plan.grokCloud };
        })(),
        ...pluginDirsFor(readyBot, instance, roomPrincipal ?? undefined),
        mcpCallTimeoutMs: mcpCallTimeoutMinutes(cfg) * 60_000,
        ...(instance.instanceId === roomTurnSelection(readyBot).instanceId
          ? memberTurnSelection(roomTurnSelection(readyBot))
          : { model: instance.models.default }),
        // #2038: Claude sub-agents run on the bot's fast model (same engine).
        ...roomSubagentModel(readyBot, instance.instanceId)
      });
    };
    // #1137: when the owner pays, the owner's computer serves its model.
    const roomDeskPerson = desktopModelPersonFor(readyBot, instance, roomSpeaker, roomPlace.principal);
    guardTurnDispatch(withDesktopModelPerson(roomDeskPerson, () => runAsBotEngine(readyBot.id, () => Promise.resolve().then(() => {
      const selectedModel = instance.instanceId === roomTurnSelection(readyBot).instanceId ? roomTurnSelection(readyBot).model : instance.models.default;
      if (IDENTITY.kind === "perspicax") desktopLocalModels.assertAvailable(roomDeskPerson, selectedModel, instance.driverKind);
      return IDENTITY.kind === "perspicax" ? orgTurnAccess(threadId, readyBot, instance, roomSpeaker, selectedModel).then(sendRoomTurn) : sendRoomTurn(soloPiTurnAccess(instance));
    }))), () => abandoned || Boolean(isCancelled?.()), async () => {
        // Stop may have landed while the adapter was authenticating, before
        // it had an active process for the first interrupt to reach. Now that
        // sendTurn completed setup, revoke again and interrupt the real turn.
        await instance.adapter.interruptTurn(threadId).catch(() => {});
      })
      .then((dispatch) => {
        ctx.providerTurnId = dispatch.value.turnId;
        bindInternalCapabilityToProviderTurn(threadId, internalGeneration, dispatch.value.turnId);
        orchestration?.onTurnStarted?.(dispatch.value.turnId);
        if (abandoned) {
          retireProviderTurn(dispatch.value.turnId);
          clearCancelledProviderHandshake(threadId, retirementOwner);
        }
        if (dispatch.cancelled) {
          retireProviderTurn(dispatch.value.turnId);
          onProviderHandshakeSettled?.();
          finish("cancelled");
          return;
        }
        onProviderHandshakeSettled?.();
      })
      .catch((err) => {
        onProviderHandshakeSettled?.();
        clearCancelledProviderHandshake(threadId, retirementOwner);
        if (abandoned) return;
        let message = err instanceof Error ? err.message : "turn failed";
        if (err instanceof EngineAccessLost) {
          const engine = engineDisplayName(instance);
          const card = accessCardFor(bot, err.refusal, engine, err.detail);
          store.appendMessage(threadId, { role: "bot", kind: "access", from: { botId: bot.id, name: bot.name, color: bot.color }, access: card });
          message = engineAccessNotice(err.refusal.reason, engine, err.refusal);
          notifyAccess(deliverableNotification("turn-failed", bot, threadId, message, { avatarUrl: bot.avatarUrl }), card);
        } else store.appendMessage(threadId, {
          role: "bot",
          kind: "activity",
          from: { botId: bot.id, name: bot.name, color: bot.color },
          tool: failedTurnTool(message)
        });
        onDispatchError?.(message);
        watchdog.settle(threadId);
        finish("dispatch_failed");
      });
  });
  };
}
