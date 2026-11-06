// @ts-nocheck
/** routineRunAccessCard (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineRunAccessCard(getHost: () => Host): any {
function routineRunAccessCard(run: RoutineRun, viewerId: string | undefined) {
  const host = getHost();

  if (run.status !== "failed" && run.status !== "blocked") return undefined;
  const from = run.createdAt;
  const until = (run.finishedAt ?? Date.now()) + 5_000;
  const threads = [...new Set([run.threadId, run.resultsThreadId, run.sourceThreadId].filter((id): id is string => Boolean(id)))];
  let found: { at: number; access: WireAccessCard } | undefined;
  for (const threadId of threads) {
    for (const message of host.store.messagesTail(threadId, 50).messages) {
      const access = message.kind === "access" ? message.access : undefined;
      if (!access || message.at < from || message.at > until || access.botId !== run.botId) continue;
      // a paused routine's card names its routine; any other card is a
      // routine turn's (the owner pays), never a person's own message
      if (access.reason === "routine_delegation" ? access.routineId !== run.routineId : access.reason === "no_access" && !access.routine) continue;
      if (host.IDENTITY.kind === "perspicax" && !host.accessCardVisibleTo(message, viewerId)) continue;
      if (!found || message.at >= found.at) found = { at: message.at, access };
    }
  }
  if (!found) return undefined;
  if (!viewerId) return found.access;
  const person = host.principals.byId(viewerId);
  return host.accessCardForViewer({ access: found.access }, { principalId: viewerId, admin: person?.local === true || person?.orgRole === "admin" }).access;

}
  return routineRunAccessCard;
}
