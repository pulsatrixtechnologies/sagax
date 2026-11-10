// @ts-nocheck
/** engineConnectorsPromptFor (#1388). Pure move from server/index.ts. */
import { engineConnectorsPrompt } from "../harness-connectors.ts";
import { connectorConventionsPrompt } from "../perspicax/perspicax-conventions.ts";
import type { ConnectorTurnPlan } from "../connectors/turn-plan.ts";
export type Host = Record<string, any>;

export function createEngineConnectorsPromptFor(getHost: () => Host): any {
function engineConnectorsPromptFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker,   turn: { level?: ApprovalMode; relay?: boolean; perspicaxConventions?: boolean; threadId?: string; plan?: ConnectorTurnPlan } = {}) {
  const host = getHost();
  // the turn's connector plan (server/connectors/turn-plan.ts), computed in
  // turn setup; a caller outside a turn gets the same plan computed here
  const plan = turn.plan ?? host.connectorPlanForTurn(bot, instance, speaker, turn.threadId);
  const input = plan.input;
  const claudeAi = plan.claudeAi;
  // Review of #2912: ConnectWise reached through a claude.ai connector, with
  // no Perspicax mount on this turn, still gets the calling conventions.
  const conventions = claudeAi && instance.driverKind === "claudeAgent"
    ? connectorConventionsPrompt(host.claudeAiConnectorRows?.(input), turn.perspicaxConventions === true)
    : "";
  return engineConnectorsPrompt({
    driver: instance.driverKind,
    claudeAi,
    grokCloud: plan.grokCloudOnTurn,
    foreign: plan.account === "foreign",
    // what Full and run_with_engine change in the connector rules (2026-10-28)
    full: turn.level === "full",
    relay: turn.relay === true,
    ...(turn.relay ? { elsewhere: host.connectorsElsewhereFor(bot, instance, speaker) } : {})
  }) + conventions;

}
  return engineConnectorsPromptFor;
}
