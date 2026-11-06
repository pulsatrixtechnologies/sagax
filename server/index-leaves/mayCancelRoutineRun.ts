// @ts-nocheck
/** mayCancelRoutineRun (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMayCancelRoutineRun(getHost: () => Host): any {
function mayCancelRoutineRun(auth: RequestAuth, run: RoutineRun, routine: Routine | undefined) {
  const host = getHost();

  if (routine) return host.mayRunRoutineNow(auth, routine);
  const organization = host.IDENTITY.kind === "perspicax";
  const person = auth.kind === "session";
  const bot = host.store.bot(run.botId);
  const botOwner = bot ? host.effectiveBotOwner(bot) : undefined;
  const runAs = host.effectiveRunAs(run);
  return host.routineRunNowAllowed({
    organization,
    person,
    ...(person ? { principalId: auth.session.principalId } : {}),
    admin: organization && person && (host.orgAdminCaller(auth) || host.callerCan(auth, "routines.runNowAny")),
    ...(botOwner ? { botOwner } : {}),
    ...(runAs ? { runAs } : {})
  });

}
  return mayCancelRoutineRun;
}
