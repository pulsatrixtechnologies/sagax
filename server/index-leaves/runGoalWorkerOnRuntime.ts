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
  const { operation, worker } = args;
  const run = operation.goalRun;
  if (!run || operation.cancelled || run.turnCount >= run.maxTurns) return { ran: false, replyText: "" };
  // Every goal step is a root of the runtime (#2204, upstream beginTurn):
  // the member's room claim begins its own root carrying the goal run id, so
  // a park at the computer wait ceiling ends that root and comes back to the
  // lead as data. The wait for the member, Stop, the turn count and the one
  // transient retry stay with runGroupGoalStep.
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
  return runGoalWorkerOnRuntime;
}
