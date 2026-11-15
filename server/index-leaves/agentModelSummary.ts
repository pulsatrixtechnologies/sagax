// @ts-nocheck
/** agentModelSummary (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAgentModelSummary(getHost: () => Host): any {
function agentModelSummary(bot: BotRecord): { instance_id: string; model: string; effort?: string; auto?: boolean; harness?: string; harness_own?: boolean } | null {
  const host = getHost();
  const selection = bot.modelSelection;
  if (!selection?.instanceId) return null;
  // #4329 lot 5: what runs the model, and whether the bot chose it itself
  const harness = host.registry?.get(selection.instanceId)?.driverKind ?? bot.harness;
  return {
    instance_id: selection.instanceId,
    model: selection.model ?? "",
    ...(selection.effort ? { effort: selection.effort } : {}),
    ...(selection.auto === true ? { auto: true } : {}),
    ...(harness ? { harness } : {}),
    ...(bot.harness ? { harness_own: true } : {}),
  };
}
  return agentModelSummary;
}
