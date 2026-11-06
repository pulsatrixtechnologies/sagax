// @ts-nocheck
/** routineScopeDeps (#1388). Pure move from server/index.ts. */
import { VisibleSet } from "../bots/bot-visibility.ts";
export type Host = Record<string, any>;

export function createRoutineScopeDeps(getHost: () => Host): any {
function routineScopeDeps(auth: RequestAuth, visible: VisibleSet, viewerId: string | undefined) {
  const host = getHost();
  const { routineVisible } = host;

  const mine = (value: Routine | RoutineRun) => routineVisible(value, visible) && (!viewerId || host.routineSeenBy(value, viewerId));
  return {
    mine,
    facts: host.routineScopeFacts,
    canRun: (routine) => !host.routineNeedsRun(auth, routine.botId) && host.mayRunRoutineNow(auth, routine),
    canEdit: (routine) => !host.routineNeedsRun(auth, routine.botId),
    wire: host.routineOnWire,
    teamName: (teamId) => host.orgTeams.name(teamId)
  };

}
  return routineScopeDeps;
}
