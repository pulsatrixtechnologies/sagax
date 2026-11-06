// @ts-nocheck
/** speakerMayRunRoutineNow (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createSpeakerMayRunRoutineNow(getHost: () => Host): any {
function speakerMayRunRoutineNow(principalId: string | undefined, routine: Routine) {
  const host = getHost();
  const { can, isPrincipalId } = host;

  const organization = host.IDENTITY.kind === "perspicax";
  const person = principalId && isPrincipalId(principalId) ? host.principals.byId(principalId) : undefined;
  const active = Boolean(person && person.disabledAt === undefined);
  return host.routineRunNowAllowed({
    organization,
    person: true,
    ...(active ? { principalId } : {}),
    admin: organization && active && (person!.local === true || person!.orgRole === "admin" || can(host.principalPermissions(principalId, { sessionAdmin: false }), "routines.runNowAny")),
    ...host.routineRunNowParties(routine)
  });

}
  return speakerMayRunRoutineNow;
}
