// @ts-nocheck
/** engineConnectorsPromptFor (#1388). Pure move from server/index.ts.
 * #3351 (connectors across engines L8): the one connector list of
 * server/connectors/list-prompt.ts, the same text for the same person on
 * every engine and turn kind. */
import { connectorListPrompt, nativeConnectorMounts } from "../connectors/list-prompt.ts";
import { connectorConventionsPrompt } from "../perspicax/perspicax-conventions.ts";
import { allowsTool } from "../../shared/tool-scope.ts";
import { CALL_CONNECTOR_TOOL } from "../../shared/connector-call.ts";
import type { ConnectorTurnPlan } from "../connectors/turn-plan.ts";
export type Host = Record<string, any>;

export function createEngineConnectorsPromptFor(getHost: () => Host): any {
function engineConnectorsPromptFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker,   turn: { level?: ApprovalMode; perspicaxConventions?: boolean; threadId?: string; plan?: ConnectorTurnPlan; agents?: boolean; toolScope?: unknown } = {}) {
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
  const registry = host.connectorRegistry;
  const hub = host.connectorHub;
  const slot = host.turnSlotFor?.(bot, instance);
  return connectorListPrompt({
    principal: plan.principal,
    confined: plan.guestConfined,
    foreign: plan.account === "foreign",
    accounts: plan.accounts(),
    native: nativeConnectorMounts(plan, {
      ...(slot ? { slot } : {}),
      ...(registry?.accountInstanceOf ? { accountInstance: (provider, id) => registry.accountInstanceOf(provider, id) } : {}),
    }),
    callable: (provider) => hub?.callable?.(provider) === true,
    // call_connector is an agents tool: offered when the agents server is
    // mounted and the turn's tool selection keeps it (P3)
    callTool: turn.agents !== false && allowsTool(turn.toolScope, { kind: "mcp", server: "agents", name: CALL_CONNECTOR_TOOL }),
    // what Full changes in the connector rules (2026-10-28)
    full: turn.level === "full",
  }) + conventions;

}
  return engineConnectorsPromptFor;
}
