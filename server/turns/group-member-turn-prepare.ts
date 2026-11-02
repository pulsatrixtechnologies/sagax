// @ts-nocheck
// #1388 wave 4 step 3: runGroupMemberTurn phase. Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx, GroupPrepareResult } from "./group-member-turn-ctx.ts";

export function createPrepareGroupMemberTurn(host: GroupMemberTurnHost) {
  const {
    BOTMAIL_ENGINE_REFUSAL,
    MACHINE_OFFLINE_NOTE,
    accessCardFor,
    autoPickForTurn,
    enqueueOfflineTurn,
    beginInternalCapabilityGeneration,
    botmailConfined,
    cfg,
    cloudGuestDriven,
    cloudGuestDrivenHandoff,
    deliverableNotification,
    effectiveBotOwner,
    engineAccessNotice,
    engineDisplayName,
    failedTurnTool,
    groupSpeakers,
    guestDrivenTurns,
    guestEngineRefusal,
    localPrincipalId,
    localVmTargetForBot,
    modelSwitchRefusal,
    namesEngine,
    notifyAccess,
    orgEngineRefusal,
    ownerModelOfflineRefusal,
    policyModelRefusal,
    providerInstancesChanging,
    queuedWorkerTurns,
    registeredWorkers,
    registry,
    replaceQueuedWorkerTurns,
    revokeEarlierTurnCapabilities,
    roomRoutineSpeaker,
    roomTurnApprovalMode,
    roomTurnRuns,
    sandboxPrincipalForTurn,
    speakerTurnSelection,
    store,
    turnModelSwitches,
    turnResourceOwners,
    turnRoutineLineage,
    turnRoutinePayers,
    turnRoutineTriggers,
    turnRunFor,
    turnSpeakerPrincipals,
    turnSpeakers,
    warmPayerAccountModels,
    workspaceMaintenance,
    destinationForBot,
  } = host;

  return async function prepareGroupMemberTurn(ctx: GroupMemberTurnCtx): Promise<GroupPrepareResult> {
    const groupId = ctx.groupId;
    const threadId = ctx.threadId;
    const botId = ctx.botId;
    const spoken = ctx.spoken;
    const cardContinuation = ctx.cardContinuation;
    const onDispatchError = ctx.onDispatchError;
    const isCancelled = ctx.isCancelled;
    const orchestration = ctx.orchestration;
    const operation = ctx.operation;
    const heldTurnId = ctx.heldTurnId;
  let card: any;
  let message: any;
  let next: any;
  let owner: any;
  let engine: any;

  if (workspaceMaintenance.active) {
    onDispatchError?.("A workspace backup or restore is in progress.");
    return { kind: "return", value: false };
  }
  if (isCancelled?.()) return { kind: "return", value: false };
  const group = store.group(groupId);
  const bot = store.bot(botId);
  const ownsThread = group?.dm
    ? group.threadId === threadId
    : Boolean(group && store.groupTaskByThread(group.id, threadId));
  if (!group || !bot || !ownsThread) return { kind: "return", value: false };
  const destination = destinationForBot({ host: bot.host, workers: registeredWorkers });
  if (destination.kind !== "fleet") {
    const host = bot.host;
    const deviceId = destination.kind === "worker" ? destination.deviceId : host?.kind === "machine" ? host.deviceId : null;
    const deviceUserId = host?.kind === "machine" ? host.userId : "";
    const heldMessageId = heldTurnId ?? orchestration?.roomHandoffId ?? operation?.goalRun?.cardMessageId;
    if (deviceId && deviceUserId && heldMessageId) {
      const heldMessage = store.messagesFor(threadId).find((item) => item.id === heldMessageId);
      next = enqueueOfflineTurn({
        queued: queuedWorkerTurns,
        messageId: heldMessageId,
        deviceId,
        userId: deviceUserId,
        authorId: heldMessage?.sender?.id ?? localPrincipalId(),
        botId: bot.id
      });
      if (next !== queuedWorkerTurns) {
        replaceQueuedWorkerTurns(next);
        if (destination.kind === "queued") {
          store.appendMessage(threadId, {
            role: "bot",
            kind: "activity",
            tool: { name: MACHINE_OFFLINE_NOTE, ok: false }
          });
        }
      }
    }
    if (orchestration) {
      orchestration.result.outcome = "held";
      orchestration.result.replyText = "";
      orchestration.result.stopReason = null;
    }
    spoken.add(botId);
    return { kind: "return", value: true };
  }
  if (bot.approvalGrant) {
    onDispatchError?.(`${bot.name}'s approval level is still being confirmed — skipped this round`);
    return { kind: "return", value: true };
  }
  revokeEarlierTurnCapabilities(threadId);
  spoken.add(botId);
  // Must be the SAME resolver the readiness re-check uses below, or a Primary Bot's
  // delegated Full elevation makes the two disagree by construction: every
  // such room turn then reads as "settings changed", retries once, and
  // settles as busy without ever dispatching.
  const preparedApprovalMode = roomTurnApprovalMode(bot, threadId, orchestration);
  const preparedSelection = { ...bot.modelSelection };
  // Auto (docs/plans/2026-10-08-auto-model.md): a goal run's step or a room
  // hand-off is work handed out (worker pick on its text); an ordinary
  // round runs on the orchestration model. The bot keeps its base model.
  const roomAutoSpeakerId = store.activePath(threadId).findLast((message) => message.role === "user" && message.sender?.id)?.sender?.id;
  const roomAuto = bot.modelSelection.auto === true ? autoPickForTurn({
    bot, threadId,
    speaker: roomAutoSpeakerId ? { origin: "person", principalId: roomAutoSpeakerId, groupId } : roomRoutineSpeaker(threadId) ?? { origin: "operator" },
    role: orchestration ? "worker" : "orchestration",
    text: [operation?.goalRun?.goal, orchestration?.turnInstructions].filter(Boolean).join("\n")
  }) : null;
  // #1137, #1154: the bot's model cannot run for the person who wrote (no
  // credentials of theirs for its engine, or their session does not offer
  // it), so the bot answers with a model they can run, for this turn only.
  if (!roomAuto && roomAutoSpeakerId && !cardContinuation) {
    warmPayerAccountModels(bot, { origin: "person", principalId: roomAutoSpeakerId, groupId });
  }
  const roomSwitch = !roomAuto && roomAutoSpeakerId
    ? speakerTurnSelection(bot, { origin: "person", principalId: roomAutoSpeakerId, groupId })
    : null;
  const roomOwnDefault = roomSwitch?.selection ?? null;
  if (roomSwitch) {
    turnModelSwitches.set(threadId, { botId: bot.id, requested: roomSwitch.requested, actual: roomSwitch.selection, principalId: roomAutoSpeakerId!.trim().toLowerCase() });
    roomTurnRuns.set(threadId, { botId: bot.id, run: turnRunFor(roomSwitch.selection, roomSwitch.requested) });
  } else {
    turnModelSwitches.delete(threadId);
    roomTurnRuns.delete(threadId);
  }
  const roomSelection = roomAuto?.pick.selection ?? roomOwnDefault ?? bot.modelSelection;
  /** The selection this room turn runs: the Auto pick while the bot is still
   * on Auto, or the person's own default model (#1137). */
  const roomTurnSelection = (ready: BotRecord): ModelSelection => roomOwnDefault ?? (roomAuto && ready.modelSelection.auto === true ? roomSelection : ready.modelSelection);
  const instance = registry.get(roomSelection.instanceId);
  const userName = cfg.profile?.name?.trim() || "User";
  if (providerInstancesChanging.has(roomSelection.instanceId)) {
    onDispatchError?.(`${bot.name}'s provider account is being updated — try again shortly`);
    return { kind: "return", value: true };
  }
  const roomPolicyRefusal = instance ? policyModelRefusal(instance) : undefined;
  const roomModelRefusal = modelSwitchRefusal(roomSelection.instanceId, roomSelection.model, effectiveBotOwner(bot));
  // A room turn a guest drives on a Cloud home is confined like a guest's
  // own conversation, or refused on an engine that cannot be.
  if (!groupSpeakers.has(threadId)) guestDrivenTurns.delete(threadId);
  const roomGuestConfined = cloudGuestDriven(threadId) || cloudGuestDrivenHandoff(orchestration?.roomHandoffId) || botmailConfined(threadId);
  const roomGuestRefusal = roomGuestConfined && instance?.adapter.capabilities.guestTurns !== "confined"
    ? (cloudGuestDriven(threadId) || !botmailConfined(threadId) ? guestEngineRefusal(threadId) : BOTMAIL_ENGINE_REFUSAL) : undefined;
  if (!instance || roomPolicyRefusal || roomModelRefusal || roomGuestRefusal) {
    message = roomPolicyRefusal ?? roomModelRefusal ?? roomGuestRefusal ?? (namesEngine(roomSelection) ? `${bot.name}'s model is unavailable` : NO_ENGINE_PERSON);
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: failedTurnTool(message)
    });
    onDispatchError?.(message);
    return { kind: "return", value: true };
  }
  // Organization server (slice 3, D13): a room turn needs engine access for
  // the person whose message it answers, as a Direct turn does.
  const roomSpeakerId = store.activePath(threadId).findLast((message) => message.role === "user" && message.sender?.id)?.sender?.id;
  // A room turn no person asked for (a goal routine, other automation)
  // marks its thread, so a bot hop it starts carries the routine lineage.
  if (!cardContinuation) {
    if (roomSpeakerId) {
      turnRoutineLineage.delete(threadId);
      turnRoutinePayers.delete(threadId);
      turnRoutineTriggers.delete(threadId);
    } else {
      turnRoutineLineage.add(threadId);
      // a room routine runs on this bot's owner's credentials
      owner = effectiveBotOwner(bot);
      if (owner) turnRoutinePayers.set(threadId, owner);
    }
  }
  const roomAccessSpeaker: TurnSpeaker = roomSpeakerId ? { origin: "person", principalId: roomSpeakerId, groupId } : roomRoutineSpeaker(threadId) ?? { origin: "operator" };
  const roomAccessRefusal = cardContinuation ? null
    : orgEngineRefusal(bot, instance, roomAccessSpeaker, roomTurnSelection(bot).model) ?? ownerModelOfflineRefusal(bot, instance, roomAccessSpeaker, roomTurnSelection(bot).model);
  if (roomAccessRefusal) {
    engine = engineDisplayName(instance);
    card = accessCardFor(bot, roomAccessRefusal, engine);
    store.appendMessage(threadId, {
      role: "bot",
      kind: "access",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      access: card
    });
    const notice = engineAccessNotice(roomAccessRefusal.reason, engine, roomAccessRefusal);
    notifyAccess(deliverableNotification("turn-failed", bot, threadId, notice, { avatarUrl: bot.avatarUrl }), card);
    if (orchestration) {
      orchestration.result.outcome = "dispatch_failed";
      orchestration.result.replyText = "";
    }
    onDispatchError?.(notice);
    return { kind: "return", value: true };
  }
  // One turn per bot at a time, across BOTH engines. Without this a bot
  // could run its 1:1 turn and a room turn concurrently — two provider
  // processes, interleaved token spend, and an interrupt that only ever
  // reached one of them. Callers wait for a busy member before getting here
  // (waitForChatRoomMember / the goal wait), so this is the last-line guard
  // for the narrow window in which a 1:1 re-claims the bot between that wait
  // settling and this turn starting.
  if (bot.busy) {
    if (orchestration) {
      orchestration.result.outcome = "busy";
      return { kind: "return", value: true };
    }
    message = `${bot.name} is busy in another conversation — skipped this round`;
    store.appendMessage(threadId, {
      role: "bot",
      kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: { name: message, ok: false }
    });
    onDispatchError?.(message);
    return { kind: "return", value: true };
  }
  const internalGeneration = beginInternalCapabilityGeneration(threadId);
  const roomRoutine = !roomSpeakerId && roomRoutineSpeaker(threadId) !== null;
  const roomPrincipal = sandboxPrincipalForTurn({
    botOwnerPrincipalId: effectiveBotOwner(bot),
    routine: roomRoutine,
    speakerPrincipalId: roomSpeakerId,
    roomCreatorPrincipalId: group.createdBy ?? group.humanIds?.[0]
  });
  turnSpeakers.set(threadId, roomAccessSpeaker);
  turnSpeakerPrincipals.set(threadId, roomPrincipal ?? "");
  if (roomGuestConfined) guestDrivenTurns.set(threadId, internalGeneration);
  // A room turn is never provably the owner's alone (server/lending-memory.ts).
  const resourceOwner: TurnOwner = { threadId, generation: internalGeneration };
  turnResourceOwners.set(threadId, resourceOwner);
  let roomVmTarget: ReturnType<typeof localVmTargetForBot> | null = null;
        ctx.bot = bot;
    ctx.card = card;
    ctx.destination = destination;
    ctx.engine = engine;
    ctx.group = group;
    ctx.instance = instance;
    ctx.internalGeneration = internalGeneration;
    ctx.message = message;
    ctx.next = next;
    ctx.owner = owner;
    ctx.preparedApprovalMode = preparedApprovalMode;
    ctx.preparedSelection = preparedSelection;
    ctx.resourceOwner = resourceOwner;
    ctx.roomAccessSpeaker = roomAccessSpeaker;
    ctx.roomGuestConfined = roomGuestConfined;
    ctx.roomPrincipal = roomPrincipal;
    ctx.roomRoutine = roomRoutine;
    ctx.roomSpeakerId = roomSpeakerId;
    ctx.roomTurnSelection = roomTurnSelection;
    ctx.roomVmTarget = roomVmTarget;
    ctx.userName = userName;
    return { kind: "continue", ctx };
  };
}
