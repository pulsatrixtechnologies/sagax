// @ts-nocheck
/** bindOwnedTrigger (#1388). Pure move from server/index.ts. */
import { ownedTriggerOf } from "../../shared/routine-github.ts";
export type Host = Record<string, any>;

export function createBindOwnedTrigger(getHost: () => Host): any {
function bindOwnedTrigger(routine: Routine) {
  const host = getHost();

  host.webhooks.createOwned({
    routineId: routine.id,
    name: routine.name,
    prompt: routine.prompt,
    botId: routine.botId,
    runOn: routine.runOn,
    // webhook, email, or GitHub events with their kinds and filters (I3)
    ...ownedTriggerOf(routine.schedule),
    // the trigger starts as its routine does (active unless created paused)
    enabled: routine.enabled
  });

}
  return bindOwnedTrigger;
}
