// @ts-nocheck
/** proposalRuleCandidate (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createProposalRuleCandidate(getHost: () => Host): any {
function proposalRuleCandidate(card: NonNullable<Message["card"]> | undefined): { tool: string; scope: Record<string, string>; description: string; classes: StepUpClass[] } | undefined {
  const host = getHost();

  const operation = card?.routineRequest?.operation;
  if (operation) {
    const routineId = "routineId" in operation ? operation.routineId : undefined;
    const name = routineId ? host.routines?.listRoutines().find((row) => row.id === routineId)?.name : undefined;
    const forBot = operation.forBot?.botId;
    const verb: Record<string, string> = { create: "Create routines", update: "Change", pause: "Pause", resume: "Resume", run_now: "Run now", delete: "Delete" };
    return {
      tool: "sagax:routine",
      scope: { action: operation.action, ...(routineId ? { routine: routineId } : {}), ...(forBot ? { for: forBot } : {}) },
      description: operation.action === "create"
        ? `Create routines${forBot ? ` for ${host.store.bot(forBot)?.name ?? "another bot"}` : ""}`
        : `${verb[operation.action] ?? "Change"} the routine${name ? ` "${name}"` : ""}`,
      classes: operation.action === "delete" ? ["destructive"] : operation.action === "run_now" || operation.action === "pause" ? [] : ["always-grant"]
    };
  }
  const profile = card?.profileRequest;
  if (profile) {
    const fields = Object.keys(profile.changes ?? {}).sort();
    return {
      tool: "sagax:profile",
      scope: { target: profile.targetBotId, fields: fields.join(",") },
      description: `Change ${fields.join(", ") || "the profile"} of ${host.store.bot(profile.targetBotId)?.name ?? profile.targetName}`,
      classes: []
    };
  }
  const model = card?.modelRequest;
  if (model) {
    return {
      tool: "sagax:model",
      scope: { target: model.targetBotId, model: `${model.selection.instanceId}/${model.selection.model}` },
      description: `Switch ${host.store.bot(model.targetBotId)?.name ?? model.targetName} to ${model.selection.model}`,
      classes: []
    };
  }
  // #2091 (decided 2026-11-05): a rule proposal and a team-memory proposal offer
  // their rule too (every card does)
  const ruleRequest = card?.ruleRequest;
  if (ruleRequest) {
    const action = ruleRequest.operation.action;
    const verb: Record<string, string> = { add: "Add", change: "Change", remove: "Remove" };
    return {
      tool: "sagax:rule",
      scope: { action, ...(ruleRequest.scopeBotId ? { for: ruleRequest.scopeBotId } : {}) },
      description: `${verb[action] ?? "Change"} approval rules${ruleRequest.scopeBotId ? ` for ${host.store.bot(ruleRequest.scopeBotId)?.name ?? ruleRequest.scopeBotName}` : ""}`,
      classes: ["always-grant"]
    };
  }
  const teamMemoryRequest = card?.teamMemoryRequest;
  if (teamMemoryRequest) {
    return {
      tool: "sagax:team_memory",
      scope: { section: teamMemoryRequest.section, kind: teamMemoryRequest.kind },
      description: `Remember ${teamMemoryRequest.kind} entries for the team`,
      classes: []
    };
  }
  return undefined;

}
  return proposalRuleCandidate;
}
