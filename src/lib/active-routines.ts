// How many of the viewer's routines are on: the number beside the routines
// icon under the name in the sidebar account row. Active is the scheduler's
// own rule (server/routines/routines.ts): the Active switch is on, the server has not
// paused it (suspended) and it still has a next run (a one-time routine that
// ran, or an interval past its end date, has none). Only routines of bots the
// viewer owns count: a bot shared with them is someone else's.
import type { Routine } from "./routines";
import { viewerOwnsBot } from "./primary-bot";

export function isActiveRoutine(routine: Pick<Routine, "enabled" | "suspended" | "nextRunAt">): boolean {
  return routine.enabled && !routine.suspended && routine.nextRunAt !== null && routine.nextRunAt !== undefined;
}

export function activeRoutineCount(
  routines: readonly Pick<Routine, "botId" | "enabled" | "suspended" | "nextRunAt">[],
  bots: readonly { id: string; ownerUserId?: string }[],
  viewerId: string,
): number {
  const own = new Set(bots.filter((bot) => viewerOwnsBot(bot, viewerId)).map((bot) => bot.id));
  return routines.filter((routine) => own.has(routine.botId) && isActiveRoutine(routine)).length;
}
