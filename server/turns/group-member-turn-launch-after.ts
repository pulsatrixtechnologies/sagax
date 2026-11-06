// @ts-nocheck
// #1383: room-member launch, outcome settle. Never imports server/index.ts.
import type { GroupMemberTurnHost } from "./group-member-turn-types.ts";
import type { GroupMemberTurnCtx } from "./group-member-turn-ctx.ts";

export function createSettleRoomMemberTurn(host: GroupMemberTurnHost) {
  const {
    activeGroupSpeaker,
    drainComputerResumes,
    drainQueuedSends,
    drainSecretResumes,
    drainTeamSetupResumes,
    groupSpeakers,
    hasUnboundDiscardedGroupGoalTurn,
    retryDelegationsWaitingOn,
    revokeInternalCapabilityGeneration,
    store,
    turnResourceOwners,
    unansweredApprovals,
    watchdog,
  } = host;

  return function settleRoomMemberTurn(ctx: GroupMemberTurnCtx, outcome: any) {
    const {
      threadId, bot, group, internalGeneration, orchestration, skillAuthoring, skillAuthoringClaim,
      replyText, providerTurnId, resourceOwner,
    } = ctx;
  // The provider turn is terminal now. Revoke before any chained teammate
  // work so a retained proxy from this member cannot act during the next
  // member's generation.
  revokeInternalCapabilityGeneration(threadId, internalGeneration);
  ctx.retainRoomVmLease = outcome === "timed_out" || outcome === "stalled";
  if (!ctx.retainRoomVmLease) ctx.releaseRoomVmLease();
  ctx.roomHandoffSourceSucceeded = outcome === "settled";
  ctx.roomHandoffSourceStalled = outcome === "stalled";
  if (orchestration) {
    orchestration.result.replyText = unansweredApprovals.annotate(threadId, providerTurnId, replyText.trim(), outcome === "settled");
    orchestration.result.outcome = outcome;
  }
  // A timed-out provider still owns the room thread until its interrupt
  // produces turn.completed (or the stall watchdog's grace fallback runs).
  // Do not clear busy or start the next member on that same thread early.
  if (outcome === "cancelled") {
    // The guarded dispatch already waited for the adapter to become
    // addressable and issued the second interrupt. Retire its later events and
    // settle this exact room owner explicitly so those events cannot touch a
    // replacement turn on the same thread.
    const currentGroup = store.group(group.id);
    groupSpeakers.delete(threadId);
    const remaining = activeGroupSpeaker(group.id);
    store.patchGroup(currentGroup?.id ?? group.id, { busyBotId: remaining?.botId ?? null, unread: true });
    const currentBot = store.bot(bot.id);
    if (currentBot?.busy) {
      store.setActivity(currentBot.id, "idle");
      retryDelegationsWaitingOn(currentBot.id);
    }
    watchdog.settle(threadId);
    drainQueuedSends();
    drainComputerResumes();
    drainSecretResumes();
    drainTeamSetupResumes();
    return false;
  }
  if (outcome === "timed_out") {
    // turn.completed is intentionally retired above, so it cannot release
    // room ownership for us. Give interrupt a short grace period, then do the
    // same bounded cleanup as the stall watchdog. An unbound goal handshake
    // keeps the room closed until attribution becomes safe.
    const releaseOwnership = () => {
      if (turnResourceOwners.get(threadId)?.generation !== resourceOwner.generation) return;
      if (hasUnboundDiscardedGroupGoalTurn(threadId)) {
        const retry = setTimeout(releaseOwnership, 1_000);
        retry.unref?.();
        return;
      }
      ctx.releaseRoomVmLease();
      const speaker = groupSpeakers.get(threadId);
      if (speaker?.botId === bot.id) {
        groupSpeakers.delete(threadId);
        const remaining = activeGroupSpeaker(group.id);
        store.patchGroup(group.id, { busyBotId: remaining?.botId ?? null, unread: true });
      }
      const currentBot = store.bot(bot.id);
      if (currentBot?.busy) {
        store.setActivity(bot.id, "idle");
        retryDelegationsWaitingOn(bot.id);
        drainQueuedSends();
        drainComputerResumes();
        drainSecretResumes();
        drainTeamSetupResumes();
      }
    };
    const release = setTimeout(releaseOwnership, 6_000);
    release.unref?.();
    return false;
  }
  if (outcome === "stalled") return false;
  // turn.completed normally performs this cleanup. Only use the fallback
  // when this invocation still owns the room; otherwise it would emit a
  // duplicate group frame or clear a newer speaker's state.
  groupSpeakers.delete(threadId);
  const remaining = activeGroupSpeaker(group.id);
  store.patchGroup(group.id, { busyBotId: remaining?.botId ?? null, unread: true });
  if (store.bot(bot.id)?.busy) {
    store.setActivity(bot.id, "idle");
    retryDelegationsWaitingOn(bot.id);
  }
  if (outcome === "dispatch_failed") {
    if (skillAuthoring) skillAuthoringClaim.claimed = false;
    // No turn.completed follows a rejected room dispatch. Anything that was
    // queued while this bot briefly owned the room must be retried now.
    drainQueuedSends();
    drainComputerResumes();
    drainSecretResumes();
    drainTeamSetupResumes();
  }
  if (outcome === "provider_failed" || outcome === "parked") {
    if (skillAuthoring) skillAuthoringClaim.claimed = false;
    return false;
  }
  };
}
