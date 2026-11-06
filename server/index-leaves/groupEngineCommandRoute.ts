// @ts-nocheck
/** groupEngineCommandRoute (#1388). Pure move from server/index.ts. */
import { groupCommandTarget } from "../../shared/harness-commands.ts";
import { harnessEngineFor } from "../harness-commands.ts";
export type Host = Record<string, any>;

export function createGroupEngineCommandRoute(getHost: () => Host): any {
function groupEngineCommandRoute(   group: Pick<GroupRecord, "dm" | "defaultResponder">,   text: string,   members: readonly BotRecord[],   channelMode: "chat" | "goal" | undefined,   burstLines = 0, ) {
  const host = getHost();

  if (group.dm || channelMode === "goal" || burstLines > 1) return null;
  const route = groupCommandTarget(text, members, group.defaultResponder);
  const target = route ? members.find((member) => member.id === route.botId) : undefined;
  // the bot keeps its own engine wherever it works (upstream #2220)
  const instance = target ? host.registry.get(target.modelSelection.instanceId) : null;
  if (!route || !instance?.listCommands || !harnessEngineFor(instance.driverKind)) return null;
  return route;

}
  return groupEngineCommandRoute;
}
