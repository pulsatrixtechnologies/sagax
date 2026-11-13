// @ts-nocheck
/** turnReachPrompt (#1388). Pure move from server/index.ts. */
import { noteTurnReach, reachContributions, reachSummaryPrompt } from "../turns/turn-reach.ts";
import type { ConnectorTurnPlan } from "../connectors/turn-plan.ts";
export type Host = Record<string, any>;

export function createTurnReachPrompt(getHost: () => Host): any {
function turnReachPrompt(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker, threadId: string,   integrations: NonNullable<SendTurnInput["integrations"]>, computer: boolean, connectorPlan?: ConnectorTurnPlan) {
  const host = getHost();
  // the turn's connector plan, the one the connectors section reads (server/connectors/turn-plan.ts)
  const plan = connectorPlan ?? host.connectorPlanForTurn(bot, instance, speaker, threadId);
  const builtins = [
    ...(integrations.browser ? ["the built-in browser"] : []),
    ...(computer ? ["a computer"] : []),
    ...(integrations.data ? ["Data"] : []),
    ...(integrations.phone ? ["the phone"] : []),
    ...(integrations.messages ? ["messages and the Apple apps On in Connect Apps > This Mac (mac_* tools)"] : []),
  ];
  // Solo server: the operator at this computer owns its bots and pays (the
  // machine's own logins). Organization server: the speaker and the payer
  // as the turn resolves them (turnPayer); an operator turn has no person.
  const ownerPrincipalId = host.effectiveBotOwner(bot).trim().toLowerCase();
  const solo = host.IDENTITY.kind !== "perspicax";
  const speakerPrincipalId = speaker.origin === "operator"
    ? (solo ? ownerPrincipalId : undefined)
    : speaker.principalId?.trim().toLowerCase() || undefined;
  const payerPrincipalId = solo ? ownerPrincipalId : host.autoPayerKey(bot, speaker);
  const reach = reachContributions({
    botId: bot.id,
    threadId,
    ownerPrincipalId,
    ...(speakerPrincipalId ? { speakerPrincipalId } : {}),
    ...(payerPrincipalId && payerPrincipalId !== "unknown" ? { payerPrincipalId } : {}),
    room: false
  });
  noteTurnReach(threadId, reach);
  return reachSummaryPrompt({
    servers: Object.keys(integrations.custom ?? {}),
    builtins,
    claudeAi: plan.claudeAi,
    grokCloud: plan.grokCloudOnTurn,
    lines: reach.lines
  });

}
  return turnReachPrompt;
}
