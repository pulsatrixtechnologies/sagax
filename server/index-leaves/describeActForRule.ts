// @ts-nocheck
/** describeActForRule (#1388). Pure move from server/index.ts. */
import { createBotActService } from "../bots/bot-act.ts";
export type Host = Record<string, any>;

export function createDescribeActForRule(getHost: () => Host): any {
function describeActForRule(target: Parameters<NonNullable<Parameters<typeof createBotActService>[0]["describeAct"]>>[0]) {
  const host = getHost();

  if (target.kind === "ui") return `Screen: ${target.command}`;
  const named = target.path.split("/").map((segment) => {
    if (!segment || !host.isOpaqueId(segment)) return segment;
    return host.store.bot(segment)?.name ?? host.store.groups.find((group) => group.id === segment)?.name ?? "…";
  }).join("/");
  return `${target.method.toUpperCase()} ${named}`;

}
  return describeActForRule;
}
