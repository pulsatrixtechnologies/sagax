// @ts-nocheck
// #1383: room-member launch, computer mount. Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";

export function createMountRoomMemberTurn(host: GroupMemberTurnHost) {
  const {
    PlaceUnavailableError,
    activeInternalGenerationByThread,
    decideWorkplace,
    failedTurnTool,
    groupSpeakers,
    mountUserSandbox,
    registerComputerResume,
    startScreenPoller,
    store,
  } = host;

  function afterBrowser(ctx: GroupMemberTurnCtx) {
    const { isCancelled, threadId, roomSpeaker, internalGeneration, readyBot } = ctx;
  // Stop/delete may land while browser state is being prepared. Capability
  // publication and this exact claim are both fenced; finally releases only
  // this setup, so a replacement turn's busy state is never cleared here.
  const browserReadyBot = store.bot(readyBot.id);
  if (isCancelled?.() || !browserReadyBot?.busy ||
      groupSpeakers.get(threadId) !== roomSpeaker ||
      activeInternalGenerationByThread.get(threadId) !== internalGeneration) {
    return false;
  }
  }

  function afterTeamBoat(ctx: GroupMemberTurnCtx, attached: any) {
    const { isCancelled, threadId, roomSpeaker, internalGeneration, integrations, readyBot } = ctx;
    if (isCancelled?.() || groupSpeakers.get(threadId) !== roomSpeaker ||
        activeInternalGenerationByThread.get(threadId) !== internalGeneration) return false;
    Object.assign(integrations, attached.mount);
    startScreenPoller(readyBot.id, threadId, { computer: attached.capture });
  }

  function beginDesktop(ctx: GroupMemberTurnCtx) {
    const {
      isCancelled, threadId, roomSpeaker, internalGeneration, roomPlan, roomRoutine, roomPrincipal,
      roomSpeakerId, integrations, readyBot, instance, roomPlaced,
    } = ctx;
    let roomPlace = ctx.roomPlace;
  // The speaker's own explicit place, mounted exactly as its bot thread
  // mounts it. A channel has no conversation pin and no Auto fallback here:
  // only a destination the person chose reaches a desktop.
  const roomSetupIsCurrent = () => !isCancelled?.() &&
    groupSpeakers.get(threadId) === roomSpeaker &&
    activeInternalGenerationByThread.get(threadId) === internalGeneration;
  if (roomPlan.computer === "local") roomPlace = decideWorkplace({ desktopTargeted: true, routine: roomRoutine, principal: roomPrincipal, personAsked: Boolean(roomSpeakerId) });
  mountUserSandbox(integrations, {
    botId: readyBot.id, threadId, generation: internalGeneration,
    customMcp: instance.adapter.capabilities.customMcp === true,
    decision: roomPlace, staging: roomPlaced.staging
  });
    ctx.roomPlace = roomPlace;
    ctx.roomSetupIsCurrent = roomSetupIsCurrent;
  }

  function afterPlugins(ctx: GroupMemberTurnCtx) {
    if (!ctx.roomSetupIsCurrent()) return false;
  }

  function defineScreens(ctx: GroupMemberTurnCtx) {
    const {
      roomSetupIsCurrent, readyGroup, readyBot, threadId, internalGeneration, roomSpeaker,
      resourceOwner, bot, onDispatchError, instance, orchestration,
    } = ctx;
  // A lazily claimed desktop (the VPS, the member's Boat) shows in the room
  // from the moment its first computer call claims it.
  const showClaimedScreen = (capture: () => Promise<{ png: string; format: string }>) => {
    if (roomSetupIsCurrent() && store.group(readyGroup.id)?.busyBotId === readyBot.id) {
      ctx.roomScreenBotId = readyBot.id;
      startScreenPoller(readyBot.id, threadId, { computer: capture });
    }
  };
  // The member's cloud computer could not start on its first computer call:
  // the same row, report and parking a failure at setup gets (the catch at
  // the end of this function), then the member's turn ends. Fenced to this
  // member's still-running turn.
  const failRoomClaim = (failure: string, error?: unknown) => {
    if (activeInternalGenerationByThread.get(threadId) !== internalGeneration || groupSpeakers.get(threadId) !== roomSpeaker) return;
    if (resourceOwner.computerParkedOn) {
      registerComputerResume({
        botId: bot.id,
        threadId,
        resource: resourceOwner.computerParkedOn,
        generation: internalGeneration,
        afterMessageId: store.activePath(threadId).findLast((entry) => entry.role === "user")?.id
      });
      ctx.roomClaimFailure = { parked: true };
      if (orchestration) orchestration.result.stopReason = `${bot.name} parked waiting for the computer`;
    } else {
      // Read as a room member's place (mountBotBoat): its one line, with no
      // retry of its own.
      const placeFailure = error instanceof PlaceUnavailableError ? error : undefined;
      const message = placeFailure?.message ?? failure;
      ctx.roomClaimFailure = { parked: false, message };
      store.appendMessage(threadId, {
        role: "bot", kind: "activity",
        from: { botId: bot.id, name: bot.name, color: bot.color },
        tool: failedTurnTool(message, placeFailure ? { place: placeFailure.row } : {})
      });
      onDispatchError?.(message);
      // Claude settles the interrupt as exit_before_result: not a second
      // incident for the same failure.
      resourceOwner.lazyClaimFailureReported = true;
    }
    void instance.adapter.interruptTurn(threadId).catch(() => {});
  };
    ctx.showClaimedScreen = showClaimedScreen;
    ctx.failRoomClaim = failRoomClaim;
  }

  return { afterBrowser, afterTeamBoat, beginDesktop, afterPlugins, defineScreens };
}
