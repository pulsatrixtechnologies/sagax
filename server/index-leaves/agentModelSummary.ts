// @ts-nocheck
/** agentModelSummary (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentModelSummary(getHost: () => Host): any {
function agentModelSummary(bot: BotRecord): { instance_id: string; model: string; effort?: string; auto?: boolean } | null {
  const host = getHost();
  const selection = bot.modelSelection;
  if (!selection?.instanceId) return null;
  return {
    instance_id: selection.instanceId,
    model: selection.model ?? "",
    ...(selection.effort ? { effort: selection.effort } : {}),
    ...(selection.auto === true ? { auto: true } : {}),
  };
}
  return agentModelSummary;
}
