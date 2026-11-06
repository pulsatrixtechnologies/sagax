// @ts-nocheck
/** turnStartFor (#1388). Pure move from server/index.ts. */
import { turnStartOf } from "../../shared/custom-rules.ts";
export type Host = Record<string, any>;

export function createTurnStartFor(getHost: () => Host): any {
function turnStartFor(threadId: string) {
  const host = getHost();
  const speaker = host.turnSpeakers.get(threadId);
  return turnStartOf({
    origin: speaker?.origin,
    routine: speaker?.origin === "peer" && speaker.routine === true,
    routineLineage: host.turnRoutineLineage.has(threadId)
  });

}
  return turnStartFor;
}
