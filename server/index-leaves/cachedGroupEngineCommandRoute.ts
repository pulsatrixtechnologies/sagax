// @ts-nocheck
/** cachedGroupEngineCommandRoute (#1388). Pure move from server/index.ts. */
import { resolveTypedCommand } from "../../shared/harness-commands.ts";
export type Host = Record<string, any>;

export function createCachedGroupEngineCommandRoute(getHost: () => Host): any {
function cachedGroupEngineCommandRoute(   group: GroupRecord,   threadId: string,   text: string,   members: readonly BotRecord[],   channelMode: "chat" | "goal" | undefined,   burstLines: number,   speaker: TurnSpeaker, ) {
  const host = getHost();

  const route = host.groupEngineCommandRoute(group, text, members, channelMode, burstLines);
  const target = route ? members.find((member) => member.id === route.botId) : undefined;
  if (!route || !target) return null;
  const source = host.harnessCommandSource(target, threadId, { group, speaker });
  const commands = source ? host.harnessCommands.cached(source)?.commands ?? [] : [];
  return resolveTypedCommand(host.extractTurnImages(route.commandText).text, commands).kind === "engine" ? route : null;

}
  return cachedGroupEngineCommandRoute;
}
