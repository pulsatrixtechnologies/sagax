// @ts-nocheck
/** unattendedDispatchState (#1388). Pure move from server/index.ts. */
import { isSurfaceBot } from "../temporary-agents.ts";
export type Host = Record<string, any>;

export function createUnattendedDispatchState(getHost: () => Host): any {
function unattendedDispatchState(botId: string) {
  const host = getHost();

  const bot = host.store.bot(botId);
  // Routines and webhooks share this state; proactive wakes are excluded
  // from capacity so a wake never holds a person's routine in the queue.
  // lot S1: a surface bot never holds a routine or an automation, by any
  // path (a routine, its request card applied in Full access, a webhook):
  // to them it is no bot
  const decision = host.admit("unattended", {}, {
    botPresent: Boolean(bot) && !isSurfaceBot(bot),
    atCapacity: Boolean(bot) && host.botAtThreadCapacity(botId, undefined, { excludeProactive: true }),
    groupTurn: Boolean(bot) && Boolean(host.activeGroupTurnForBot(botId))
  });
  if (decision.action === "refuse") return decision.code === "missing" ? "missing" : "busy";
  return "ready";

}
  return unattendedDispatchState;
}
