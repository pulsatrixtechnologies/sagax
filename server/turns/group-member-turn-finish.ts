// @ts-nocheck
// #1383: room-member launch catch/finally. Never imports server/index.ts.
// Invoked from launch's try so cleanup still runs on the same return paths.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";

export function createFinishGroupMemberTurn(host: GroupMemberTurnHost) {
  const {
    ComputerWaitParked,
    DirectTurnSetupCancelled,
    PlaceUnavailableError,
    activeGroupSpeaker,
    coordinator,
    directCoordinationSettlers,
    drainComputerResumes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    failedTurnTool,
    groupSpeakers,
    localVmThreadTargets,
    registerComputerResume,
    releaseLocalVmThread,
    releaseTurnResources,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    settleDirectCoordination,
    stopScreenPoller,
    store,
    turnResourceOwners,
    vpsThreadEnded,
    watchdog,
  } = host;

  function releaseRoomLease(ctx: GroupMemberTurnCtx) {
    if (ctx.roomVmTarget && localVmThreadTargets.get(ctx.threadId) === ctx.roomVmTarget) releaseLocalVmThread(ctx.threadId);
    ctx.roomVmTarget = null;
    const currentOwner = turnResourceOwners.get(ctx.threadId);
    if (!currentOwner || currentOwner.generation === ctx.resourceOwner.generation) {
      if (ctx.roomScreenBotId) stopScreenPoller(ctx.roomScreenBotId, ctx.threadId);
      if (ctx.roomVpsBotId) vpsThreadEnded(ctx.roomVpsBotId, ctx.threadId);
    }
    ctx.roomScreenBotId = null;
    ctx.roomVpsBotId = null;
    releaseTurnResources(ctx.resourceOwner);
  }

  function finishCatch(ctx: GroupMemberTurnCtx, error: any) {
    const { providerDispatched, bot, threadId, orchestration, onDispatchError, roomSpeaker } = ctx;
if (providerDispatched) throw error;
    if (error instanceof DirectTurnSetupCancelled) return false;
    const isSpendCap = typeof error === "object" && error !== null && (error as { code?: string }).code === "spend_cap";
    const isVariantError = typeof error === "object" && error !== null && (error as { code?: string }).code === "unsupported_model_variant";
    const isToolScopeError = typeof error === "object" && error !== null && (error as { code?: string }).code === "tool_scope";
    if (error instanceof ComputerWaitParked) {
      // A turn the runtime owns parks on the seat there and continues in
      // place once it frees (#2204): only a turn outside it registers the
      // host's own resume.
      if (!coordinator.node(error.generation) && !directCoordinationSettlers.has(error.generation)) registerComputerResume({
        botId: bot.id,
        threadId,
        resource: error.resource,
        generation: error.generation,
        afterMessageId: store.activePath(threadId).findLast((entry) => entry.role === "user")?.id
      });
      // The room settles with the parked chip the wait appended (#1651);
      // the registered resume re-runs the speaker turn through the group
      // queue once the seat frees. "parked" is its own outcome, not "busy":
      // the member never ran, an in-step retry would only wait the ceiling
      // out again and burn goal turns, and the goal loop routes around the
      // member while the registered resume owns the re-run.
      if (orchestration) {
        orchestration.result.outcome = "parked";
        orchestration.result.stopReason = `${bot.name} parked waiting for the computer`;
      }
      return false;
    }
    if (!roomSpeaker && !isSpendCap && !isVariantError && !isToolScopeError) throw error;
    const message = error instanceof Error ? error.message : "Local VM setup failed";
    const failure = store.appendMessage(threadId, {
      role: "bot", kind: "activity",
      from: { botId: bot.id, name: bot.name, color: bot.color },
      tool: failedTurnTool(message, error instanceof PlaceUnavailableError ? { place: error.row } : {})
    });
    orchestration?.onFailureRecorded?.(failure.id);
    onDispatchError?.(message);
    if (orchestration) {
      // A spend-cap refusal is deterministic: record it as its own
      // non-retryable outcome (the goal loop treats it as a blocked run,
      // never as a transient dispatch failure worth a second attempt).
      orchestration.result.outcome = isSpendCap ? "spend_capped" : "dispatch_failed";
      if (isSpendCap) orchestration.result.stopReason = message;
    }
    return isToolScopeError;
  }

  function finishFinally(ctx: GroupMemberTurnCtx) {
    const {
      unregisterSetupStall, providerDispatched, roomSpeaker, retainRoomVmLease, setupStallCause,
      roomHandoffSourceSucceeded, roomHandoffSourceStalled, internalGeneration, group, bot, threadId,
    } = ctx;
    const releaseRoomVmLease = () => releaseRoomLease(ctx);
unregisterSetupStall();
    revokeInternalCapabilityGeneration(threadId, internalGeneration);
    if (ctx.roomRootOpened) {
      // The root this turn opened at the claim ends here (OpenMausBot, #2204).
      const stopReason = ctx.orchestration?.result?.stopReason;
      settleDirectCoordination(internalGeneration, {
        ok: roomHandoffSourceSucceeded,
        ...(roomHandoffSourceStalled || setupStallCause !== undefined ? { stalled: true } : {}),
        text: roomHandoffSourceSucceeded ? String(ctx.replyText ?? "").trim() : stopReason || ctx.setupStallCause || String(ctx.replyText ?? "").trim() || "The turn did not run",
      });
    } else coordinator.sourceSettled(internalGeneration, roomHandoffSourceSucceeded, roomHandoffSourceStalled || setupStallCause !== undefined);
    if (!retainRoomVmLease) releaseRoomVmLease();
    if (!providerDispatched && roomSpeaker && groupSpeakers.get(threadId) === roomSpeaker) {
      groupSpeakers.delete(threadId);
      watchdog.settle(threadId);
      const remaining = activeGroupSpeaker(group.id);
      store.patchGroup(group.id, { busyBotId: remaining?.botId ?? null });
      if (store.bot(bot.id)?.busy) {
        store.setActivity(bot.id, "idle");
        retryDelegationsWaitingOn(bot.id);
      }
      drainQueuedSends();
      drainComputerResumes();
      drainSecretResumes();
      drainTeamSetupResumes();
    }
  }

  function bindRoomLease(ctx: GroupMemberTurnCtx) {
    ctx.releaseRoomVmLease = () => releaseRoomLease(ctx);
  }

  return { finishCatch, finishFinally, bindRoomLease };
}
