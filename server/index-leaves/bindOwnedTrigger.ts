// @ts-nocheck
/** bindOwnedTrigger (#1388). Pure move from server/index.ts. */
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
    kind: routine.schedule.type === "event" ? "email" : "webhook",
    // the trigger starts as its routine does (active unless created paused)
    enabled: routine.enabled
  });

}
  return bindOwnedTrigger;
}
