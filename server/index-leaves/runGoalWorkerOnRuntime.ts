// @ts-nocheck
/** runGoalWorkerOnRuntime (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunGoalWorkerOnRuntime(getHost: () => Host): any {
async function runGoalWorkerOnRuntime(args: {
  groupId: string;
  threadId: string;
  lead: BotRecord;
  worker: BotRecord;
  operation: GroupTurnOperation;
  skillAuthoringClaim: { claimed: boolean };
  instructions: string;
  assignment: string;
}): Promise<{ ran: boolean; replyText: string; outcome?: GroupMemberTurnOutcome; stopReason?: string | null }> {
  const host = getHost();
  const { operation, worker, lead } = args;
  const run = operation.goalRun;
  if (!run || operation.cancelled || run.turnCount >= run.maxTurns) return { ran: false, replyText: "" };
  // Lead assigning themselves: the runtime API refuses it; keep the harness path.
  if (worker.id === lead.id) {
    return host.runGroupGoalStep({
      groupId: args.groupId,
      threadId: args.threadId,
      bot: worker,
      operation,
      skillAuthoringClaim: args.skillAuthoringClaim,
      coordinator: false,
      instructions: args.instructions
    });
  }

  let retriedTransient = false;
  for (;;) {
    const availability = await host.waitForGroupMemberBot(worker, operation, (detail) => {
      host.updateGroupGoalRunProgress(operation, `${detail} This goal will continue when they are available.`);
    });
    if (availability === "cancelled") return { ran: false, replyText: "", outcome: "cancelled" };
    if (availability === "unavailable") {
      return { ran: false, replyText: "", outcome: "unavailable", stopReason: `${worker.name} is no longer available` };
    }
    if (availability === "timed_out") {
      const minutes = Math.max(1, Math.round(host.GROUP_GOAL_WAIT_MAX_MS / 60_000));
      return {
        ran: false,
        replyText: "",
        outcome: "busy",
        stopReason: `${worker.name} stayed busy in another conversation for ${minutes} minute${minutes === 1 ? "" : "s"}`
      };
    }
    if (operation.cancelled || run.turnCount >= run.maxTurns) return { ran: false, replyText: "" };

    const source = { groupId: args.groupId, threadId: args.threadId, botId: lead.id };
    const target = { groupId: args.groupId, threadId: args.threadId, botId: worker.id };
    let node: HandoffView;
    try {
      node = host.coordinator.enqueueGoalAssignment(source, target, args.assignment, run.runId);
    } catch (error) {
      return {
        ran: false,
        replyText: "",
        outcome: "dispatch_failed",
        stopReason: error instanceof Error ? error.message : String(error)
      };
    }

    let claimed = false;
    host.goalWorkerTurns.set(node.id, {
      systemInstructions: args.instructions,
      // 84841aeed moved workers onto the runtime. Count the same actual
      // admission as runGroupGoalStep, after the spend cap has passed.
      onClaimed: () => {
        if (claimed) return;
        claimed = true;
        run.turnCount += 1;
        operation.botIds.add(worker.id);
        host.updateGroupGoalRunProgress(operation, `${worker.name} is working on team turn ${run.turnCount} of ${run.maxTurns}.`);
      },
    });
    operation.awaitingRuntimeWorker = true;
    try {
      host.coordinator.tick();
      const deadline = Date.now() + host.GROUP_GOAL_WAIT_MAX_MS;
      while (!operation.cancelled) {
        const current = host.coordinator.node(node.id) ?? node;
        if (["completed", "failed", "cancelled"].includes(current.status)) {
          if (current.status === "completed") {
            return { ran: true, replyText: current.result || "", outcome: "settled" };
          }
          const detail = (current.result || current.status).split("\n", 1)[0]!.slice(0, 200);
          if (/spend cap|monthly spend/i.test(detail)) {
            return { ran: true, replyText: "", outcome: "spend_capped", stopReason: detail };
          }
          if (/machine|fleet host|held/i.test(detail)) {
            return { ran: true, replyText: "", outcome: "held", stopReason: detail };
          }
          if (/parked|computer/i.test(detail)) {
            return { ran: true, replyText: "", outcome: "parked", stopReason: detail };
          }
          if (current.status === "cancelled" || operation.cancelled) {
            return { ran: true, replyText: current.result || "", outcome: "cancelled", stopReason: detail };
          }
          const outcome: GroupMemberTurnOutcome =
            /stall/i.test(detail) ? "stalled"
              : /timed out|timeout/i.test(detail) ? "timed_out"
                : "provider_failed";
          if (!retriedTransient && (outcome === "provider_failed" || outcome === "stalled" || outcome === "timed_out")) {
            retriedTransient = true;
            host.updateGroupGoalRunProgress(
              operation,
              `${worker.name}'s turn did not settle (${outcome.replace("_", " ")}) — retrying once.`,
            );
            break;
          }
          return { ran: true, replyText: current.result || "", outcome, stopReason: detail };
        }
        if (Date.now() >= deadline) {
          host.coordinator.cancelRoom(args.groupId, args.threadId, `${worker.name} stayed busy past the wait limit`, "failed");
          return {
            ran: true,
            replyText: "",
            outcome: "busy",
            stopReason: `${worker.name} stayed busy past the wait limit`
          };
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
        host.coordinator.tick();
      }
      if (operation.cancelled) {
        host.coordinator.cancelRoom(args.groupId, args.threadId, "Stopped by you.");
        return { ran: false, replyText: "", outcome: "cancelled" };
      }
      // Transient retry: loop again (turn already spent).
      continue;
    } finally {
      host.goalWorkerTurns.delete(node.id);
      operation.awaitingRuntimeWorker = false;
      operation.botIds.delete(worker.id);
    }
  }

}
  return runGoalWorkerOnRuntime;
}
