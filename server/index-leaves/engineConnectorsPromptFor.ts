// @ts-nocheck
/** engineConnectorsPromptFor (#1388). Pure move from server/index.ts. */
import { accountConnectorsForTurn, engineConnectorsPrompt } from "../harness-connectors.ts";
import { connectorConventionsPrompt } from "../perspicax/perspicax-conventions.ts";
export type Host = Record<string, any>;

export function createEngineConnectorsPromptFor(getHost: () => Host): any {
function engineConnectorsPromptFor(bot: BotRecord, instance: Parameters<typeof withholdHostToolsFor>[0] & { instanceId: string }, speaker: TurnSpeaker,   turn: { level?: ApprovalMode; relay?: boolean; perspicaxConventions?: boolean } = {}) {
  const host = getHost();
  const { claudeAiConnectorsForTurn } = host;

  const input = host.accountConnectorInput(bot, instance, speaker);
  const account = accountConnectorsForTurn(input);
  const claudeAi = claudeAiConnectorsForTurn(input);
  // Review of #2912: ConnectWise reached through a claude.ai connector, with
  // no Perspicax mount on this turn, still gets the calling conventions.
  const conventions = claudeAi && instance.driverKind === "claudeAgent"
    ? connectorConventionsPrompt(host.claudeAiConnectorRows?.(input), turn.perspicaxConventions === true)
    : "";
  return engineConnectorsPrompt({
    driver: instance.driverKind,
    claudeAi,
    grokCloud: host.grokCloudOnTurn(input, instance, bot),
    foreign: account === "foreign",
    // what Full and run_with_engine change in the connector rules (2026-10-28)
    full: turn.level === "full",
    relay: turn.relay === true,
    ...(turn.relay ? { elsewhere: host.connectorsElsewhereFor(bot, instance, speaker) } : {})
  }) + conventions;

}
  return engineConnectorsPromptFor;
}
