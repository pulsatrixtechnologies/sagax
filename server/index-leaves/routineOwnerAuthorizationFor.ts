// @ts-nocheck
/** routineOwnerAuthorizationFor (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineOwnerAuthorizationFor(getHost: () => Host): any {
function routineOwnerAuthorizationFor(bot: BotRecord, threadId: string) {
  const host = getHost();

  const speaker = host.turnSpeakers.get(threadId);
  const carried = speaker?.origin === "peer" ? speaker.routineOwnerAuthorization : undefined;
  if (speaker?.origin === "peer" && !carried) return null;
  if (speaker && speaker.origin !== "owner-routine" && speaker.origin !== "peer") return null;
  const run = carried ? host.routines?.listRuns().find((entry) => entry.id === carried.runId) ?? null : host.activeRoutineRunForThread(threadId);
  if (!run) return null;
  const rootBot = host.store.bot(run.botId);
  const routine = host.routines?.getRoutine(run.routineId) ?? null;
  const hook = run.webhookId ? host.webhooks.list().find((entry) => entry.id === run.webhookId) : undefined;
  const grant = host.routineOwnerAuthorization({
    run, routine,
    rootBotOwner: rootBot ? host.effectiveBotOwner(rootBot) : "",
    receivingBotOwner: host.effectiveBotOwner(bot),
    webhookRoutineId: hook?.routineId
  });
  if (!grant || (carried && (carried.routineId !== grant.routineId || carried.botId !== grant.botId || carried.principalId !== grant.principalId))) return null;
  if (speaker?.origin === "peer" && host.peerOwnerPrincipal(speaker)?.trim().toLowerCase() !== grant.principalId) return null;
  return grant;

}
  return routineOwnerAuthorizationFor;
}
