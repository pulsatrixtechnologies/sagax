// @ts-nocheck
/** routineOnWire (#1388). Pure move from server/index.ts; #4098 adds needsPerson. */
export type Host = Record<string, any>;

export function createRoutineOnWire(getHost: () => Host): any {
function routineOnWire(routine: Routine): Omit<Routine, "runAs"> & { runAs?: { principalId: string; name: string } } {
  const host = getHost();

  const { runAs: _runAs, ...fields } = routine;
  // #4098: what of it waits on the person (null: nothing), from the facts
  // the chat's row gate reads (server/routines/routine-needs-person.ts)
  const rest = { ...fields, needsPerson: host.routineNeedsPersonOf?.(routine) ?? null };
  if (host.IDENTITY.kind !== "perspicax") return rest;
  const principalId = host.effectiveRunAs(routine);
  if (!principalId) return rest;
  const person = host.principals.byId(principalId);
  return { ...rest, runAs: { principalId, name: person?.name || person?.login || "" } };

}
  return routineOnWire;
}
