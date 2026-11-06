// @ts-nocheck
/** runGroupGoalStep (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunGroupGoalStep(getHost: () => Host): any {
async function runGroupGoalStep(args: {
  groupId: string;
  threadId: string;
  bot: BotRecord;
  operation: GroupTurnOperation;
  skillAuthoringClaim: { claimed: boolean };
  coordinator: boolean;
  instructions: string;
}): Promise<{ ran: boolean; replyText: string; outcome?: GroupMemberTurnOutcome; stopReason?: string | null }> {
  const host = getHost();
  const run = args.operation.goalRun;
  if (!run || args.operation.cancelled || run.turnCount >= run.maxTurns) {
    return { ran: false, replyText: "" };
  }
  let retriedTransient = false;
  for (;;) {
    const availability = await host.waitForGroupMemberBot(args.bot, args.operation, (detail) => {
      host.updateGroupGoalRunProgress(args.operation, `${detail} This goal will continue when they are available.`);
    });
    if (availability === "cancelled") return { ran: false, replyText: "", outcome: "cancelled" };
    if (availability === "unavailable") {
      return { ran: false, replyText: "", outcome: "unavailable", stopReason: `${args.bot.name} is no longer available` };
    }
    if (availability === "timed_out") {
      // still busy after the cap: surface it as a busy outcome the loop can
      // route around, never as a provider failure
      const minutes = Math.max(1, Math.round(host.GROUP_GOAL_WAIT_MAX_MS / 60_000));
      return {
        ran: false,
        replyText: "",
        outcome: "busy",
        stopReason: `${args.bot.name} stayed busy in another conversation for ${minutes} minute${minutes === 1 ? "" : "s"}`
      };
    }
    if (run.turnCount >= run.maxTurns) return { ran: false, replyText: "" };

    const result: GroupTurnOrchestration["result"] = {};
    let claimed = false;
    const coordinatorTurn: GroupGoalCoordinatorTurn | undefined = args.coordinator
      ? { token: Symbol("goal-coordinator-turn"), assistantItems: [], discard: false }
      : undefined;
    if (coordinatorTurn) host.addGroupGoalCoordinatorTurn(args.threadId, coordinatorTurn);
    try {
      const ran = await host.runGroupMemberTurn(
        args.groupId,
        args.threadId,
        args.bot.id,
        run.turnCount === 0 ? 0 : 1,
        new Set(),
        undefined,
        undefined,
        () => args.operation.cancelled,
        () => host.groupProviderHandshakeStarted(args.operation),
        () => host.groupProviderHandshakeSettled(args.operation),
        args.skillAuthoringClaim,
        {
          systemInstructions: args.instructions,
          followMentions: false,
          result,
          goalRunId: run.runId,
          onClaimed: () => {
            if (claimed) return;
            claimed = true;
            run.turnCount += 1;
            args.operation.botIds.add(args.bot.id);
            host.updateGroupGoalRunProgress(
              args.operation,
              `${args.bot.name} is working on team turn ${run.turnCount} of ${run.maxTurns}.`,
            );
          },
          onTurnStarted: (turnId) => {
            if (coordinatorTurn && !coordinatorTurn.turnId) coordinatorTurn.turnId = turnId;
          }
        },
      );
      // Busy here is a lost claim race — a 1:1 re-claiming the bot between
      // the wait settling and this turn starting — so wait and retry
      // in-step. A parked member is deliberately absent from both this
      // retry and the transient one below: the computer seat is still held,
      // an immediate retry would wait the ceiling out again while the
      // registered resume already owns re-running the member.
      if (result.outcome === "busy") continue;
      // One retry for a transient provider failure: a 13-turn goal must not
      // die on a single blip at turn 11. The retry claims the bot again and
      // so costs a turn like any other model call — budget is spent, never
      // stretched, and the cap still holds.
      const outcome = result.outcome;
      // spend_capped is deliberately absent: a cap refusal is deterministic,
      // and a retry would just repeat the same spend-limit activity message.
      const transient =
        outcome === "provider_failed" ||
        outcome === "dispatch_failed" ||
        outcome === "stalled" ||
        outcome === "timed_out";
      if (transient && !retriedTransient) {
        retriedTransient = true;
        host.updateGroupGoalRunProgress(
          args.operation,
          `${args.bot.name}'s turn did not settle (${outcome.replace("_", " ")}) — retrying once.`,
        );
        continue;
      }
      return {
        ran,
        replyText: result.replyText ?? "",
        outcome: result.outcome,
        stopReason: result.stopReason
      };
    } finally {
      // Membership here means this bot is part of the room operation NOW,
      // not merely the next teammate the coordinator hopes to use. In
      // particular, an idle waiter must never redirect the bot's Stop button
      // away from unrelated direct work.
      args.operation.botIds.delete(args.bot.id);
      if (coordinatorTurn && host.groupGoalCoordinatorTurns.get(args.threadId)?.has(coordinatorTurn)) {
        if (result.outcome === "timed_out" || result.outcome === "stalled") {
          // interruptTurn is asynchronous: the orchestration can stop before
          // the provider emits its final text/completion. Retain a discard-only
          // guard so a late private decision envelope never reaches the room.
          // Broken providers get a bounded fallback; the token check keeps an
          // old timer from deleting a newer goal turn on the same thread.
          coordinatorTurn.discard = true;
          coordinatorTurn.assistantItems = [];
          const cleanupTimer = setTimeout(() => {
            host.removeGroupGoalCoordinatorTurn(args.threadId, coordinatorTurn);
          }, host.GROUP_GOAL_COORDINATOR_GUARD_MS);
          cleanupTimer.unref?.();
          coordinatorTurn.cleanupTimer = cleanupTimer;
        } else {
          host.removeGroupGoalCoordinatorTurn(args.threadId, coordinatorTurn);
        }
      }
    }
  }
}
  return runGroupGoalStep;
}
