// @ts-nocheck
/** runGroupGoalOperation (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRunGroupGoalOperation(getHost: () => Host): any {
async function runGroupGoalOperation(args: {   groupId: string;   threadId: string;   coordinator: BotRecord;   members: BotRecord[];   operation: GroupTurnOperation; }) {
  const host = getHost();

  const run = args.operation.goalRun;
  if (!run) return;
  const skillAuthoringClaim = { claimed: false };
  const assignmentCounts = new Map<string, number>();
  const goalMembers: GoalRunMember[] = args.members.map((member) => ({
    id: member.id,
    name: member.name,
    hidden: member.hidden,
    chiefOfStaff: member.chiefOfStaff
  }));

  // A teammate that stayed busy past the wait cap comes back to the lead as
  // a note on its next turn, so the lead reassigns instead of the run dying.
  let coordinatorNote: string | undefined;
  let waitExhaustions = 0;
  while (!args.operation.cancelled && run.turnCount < run.maxTurns) {
    const coordinatorTurn = run.turnCount + 1;
    const note = coordinatorNote;
    coordinatorNote = undefined;
    const coordinatorResult = await host.runGroupGoalStep({
      ...args,
      bot: args.coordinator,
      skillAuthoringClaim,
      coordinator: true,
      instructions: groupGoalCoordinatorInstructions({
        goal: run.goal,
        members: goalMembers,
        turn: coordinatorTurn,
        maxTurns: run.maxTurns,
        remainingTurns: run.maxTurns - coordinatorTurn,
        note
      })
    });
    if (args.operation.cancelled) return;
    if (coordinatorResult.outcome === "held") {
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        `${args.coordinator.name} runs on a machine, so this goal was not coordinated on the fleet host.`,
      );
      return;
    }
    if (coordinatorResult.outcome === "unavailable") {
      host.finishGroupGoalRun(args.groupId, args.operation, "blocked", `${args.coordinator.name} is not available.`);
      return;
    }
    if (coordinatorResult.outcome === "spend_capped") {
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        coordinatorResult.stopReason ?? `${args.coordinator.name} hit the workspace spend cap.`,
      );
      return;
    }
    if (coordinatorResult.outcome === "busy") {
      // The lead is the one member the run cannot route around. Blocked, not
      // failed: the goal text is intact and nothing about the team broke.
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        `${coordinatorResult.stopReason ?? `${args.coordinator.name} stayed busy`} — send the goal again when they are free.`,
      );
      return;
    }
    if (coordinatorResult.outcome === "parked") {
      // The lead parked at the computer wait ceiling: like lead-busy, the
      // run cannot route around them, but the parked lead turn itself
      // resumes through the registered entry once the seat frees.
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        `${coordinatorResult.stopReason ?? `${args.coordinator.name} parked waiting for the computer`} — send the goal again when the computer is free.`,
      );
      return;
    }
    if (!coordinatorResult.ran || coordinatorResult.outcome !== "settled") {
      const reason = coordinatorResult.stopReason?.trim().slice(0, 120);
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "failed",
        `${args.coordinator.name} could not complete the coordination step${reason ? ` — ${reason}` : ""}.`,
      );
      return;
    }

    const decision = parseGroupGoalDecision(coordinatorResult.replyText).decision;
    if (!decision) {
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        `${args.coordinator.name} did not provide a valid next-step decision.`,
      );
      return;
    }
    if (decision.status !== "continue") {
      host.finishGroupGoalRun(args.groupId, args.operation, decision.status, decision.detail);
      return;
    }
    if (run.turnCount >= run.maxTurns) break;

    const worker = resolveGroupGoalMember(decision.next, goalMembers);
    if (!worker) {
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        `${args.coordinator.name} selected a teammate who is not an active member of this channel.`,
      );
      return;
    }
    const workerBot = host.store.bot(worker.id);
    if (!workerBot || workerBot.hidden) {
      host.finishGroupGoalRun(args.groupId, args.operation, "blocked", `${worker.name} is not available.`);
      return;
    }
    const assignmentKey = groupGoalAssignmentKey(worker.id, decision.instruction);
    const repeated = (assignmentCounts.get(assignmentKey) ?? 0) + 1;
    assignmentCounts.set(assignmentKey, repeated);
    if (repeated >= 3) {
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        `The team repeated the same assignment three times without resolving the goal.`,
      );
      return;
    }

    const workerTurn = run.turnCount + 1;
    // Lot 3: worker turns run on the job runtime (poll root of the goal run).
    // Busy-wait / Stop / turn-count stay with this loop; same-bot self-assign
    // falls back inside runGoalWorkerOnRuntime.
    const workerResult = await host.runGoalWorkerOnRuntime({
      groupId: args.groupId,
      threadId: args.threadId,
      lead: args.coordinator,
      worker: workerBot,
      operation: args.operation,
      skillAuthoringClaim,
      assignment: decision.instruction,
      instructions: groupGoalWorkerInstructions({
        goal: run.goal,
        coordinatorName: args.coordinator.name,
        assignment: decision.instruction,
        turn: workerTurn,
        maxTurns: run.maxTurns
      })
    });
    if (args.operation.cancelled) return;
    if (workerResult.outcome === "held") {
      coordinatorNote =
        `${workerBot.name} has this assignment on their machine. The fleet host did not run it. ` +
        "Leave that assignment with them. Continue with other members, or report blocked if the goal must wait.";
      continue;
    }
    if (workerResult.outcome === "unavailable") {
      host.finishGroupGoalRun(args.groupId, args.operation, "blocked", `${workerBot.name} is not available.`);
      return;
    }
    if (workerResult.outcome === "spend_capped") {
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "blocked",
        workerResult.stopReason ?? `${workerBot.name} hit the workspace spend cap.`,
      );
      return;
    }
    if (workerResult.outcome === "busy" || workerResult.outcome === "parked") {
      // bounded: a team that keeps landing on busy or computer-parked
      // teammates is blocked, not looping — three exhausted waits per run,
      // then stop and say so
      waitExhaustions += 1;
      if (waitExhaustions >= host.GROUP_GOAL_MAX_WAIT_EXHAUSTIONS) {
        host.finishGroupGoalRun(
          args.groupId,
          args.operation,
          "blocked",
          `Teammates stayed busy past the wait limit ${waitExhaustions} times — try again when the team is free.`,
        );
        return;
      }
      // Soft failure, returned to the lead as data (the way a delegation
      // error reaches a manager): the goal keeps going with the remaining
      // team instead of ending on one teammate's calendar.
      const reason = workerResult.stopReason?.trim().slice(0, 120) ?? `${workerBot.name} stayed busy`;
      host.store.appendMessage(args.threadId, {
        role: "bot",
        kind: "activity",
        from: { botId: args.coordinator.id, name: args.coordinator.name, color: args.coordinator.color },
        tool: { name: `${reason} — asking ${args.coordinator.name} to reassign`, ok: false }
      });
      host.updateGroupGoalRunProgress(args.operation, `${reason}. ${args.coordinator.name} is reassigning.`);
      coordinatorNote =
        `${reason} and could not take the assignment "${decision.instruction.slice(0, 160)}". ` +
        "Reassign it to another available member, do it yourself if you can, or report blocked.";
      continue;
    }
    if (!workerResult.ran || workerResult.outcome !== "settled" || !workerResult.replyText.trim()) {
      const reason = workerResult.stopReason?.trim().slice(0, 120);
      host.finishGroupGoalRun(
        args.groupId,
        args.operation,
        "failed",
        `${workerBot.name} could not return a result to ${args.coordinator.name}${reason ? ` — ${reason}` : ""}.`,
      );
      return;
    }
  }

  if (!args.operation.cancelled && !run.finished) {
    host.finishGroupGoalRun(
      args.groupId,
      args.operation,
      "limit-reached",
      `Paused at the ${run.maxTurns}-turn safety limit. Send the goal again to continue with a fresh bounded run.`,
    );
  }

}
  return runGroupGoalOperation;
}
