// @ts-nocheck
/** routineOnWire (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineOnWire(getHost: () => Host): any {
function routineOnWire(routine: Routine): Omit<Routine, "runAs"> & { runAs?: { principalId: string; name: string } } {
  const host = getHost();

  const { runAs: _runAs, ...rest } = routine;
  if (host.IDENTITY.kind !== "perspicax") return rest;
  const principalId = host.effectiveRunAs(routine);
  if (!principalId) return rest;
  const person = host.principals.byId(principalId);
  return { ...rest, runAs: { principalId, name: person?.name || person?.login || "" } };

}
  return routineOnWire;
}
