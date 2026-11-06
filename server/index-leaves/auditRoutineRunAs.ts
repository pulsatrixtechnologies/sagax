// @ts-nocheck
/** auditRoutineRunAs (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAuditRoutineRunAs(getHost: () => Host): any {
function auditRoutineRunAs(auth: RequestAuth, routine: Routine, before: string | undefined) {
  const host = getHost();

  const after = host.effectiveRunAs(routine);
  if (host.IDENTITY.kind !== "perspicax" || !after || after === before) return;
  const label = (principalId: string) => {
    const person = host.principals.byId(principalId);
    return { principalId, ...(person?.name || person?.login ? { name: person.name || person.login } : {}) };
  };
  host.orgAudit({
    category: "bot", action: "routine.run_as", target: { kind: "routine", id: routine.id, name: routine.name }, changed: ["runAs"],
    before: before ? { runAs: label(before) } : {}, after: { runAs: label(after) },
    actor: host.orgAuditActor(auth)
  });

}
  return auditRoutineRunAs;
}
