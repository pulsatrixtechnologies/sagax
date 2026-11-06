// @ts-nocheck
/** mayRunRoutineNow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMayRunRoutineNow(getHost: () => Host): any {
function mayRunRoutineNow(auth: RequestAuth, routine: Routine) {
  const host = getHost();

  const organization = host.IDENTITY.kind === "perspicax";
  const person = auth.kind === "session";
  return host.routineRunNowAllowed({
    organization,
    person,
    ...(person ? { principalId: auth.session.principalId } : {}),
    admin: organization && person && (host.orgAdminCaller(auth) || host.callerCan(auth, "routines.runNowAny")),
    ...host.routineRunNowParties(routine)
  });

}
  return mayRunRoutineNow;
}
