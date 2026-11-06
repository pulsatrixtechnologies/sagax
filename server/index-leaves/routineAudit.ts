// @ts-nocheck
/** routineAudit (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineAudit(getHost: () => Host): any {
function routineAudit(action: string, principalId: string | undefined, extra: { routine?: Pick<Routine, "id" | "name">; reason?: string; auth?: RequestAuth } = {}) {
  const host = getHost();
  const { DATA_DIR, appendAdminAction } = host;
  const person = principalId ? host.principals.byId(principalId) : null;
  appendAdminAction(DATA_DIR, {
    category: extra.routine ? "bot" : "people",
    action,
    target: extra.routine
      ? { kind: "routine", id: extra.routine.id, name: extra.routine.name }
      : { kind: "person", ...(principalId ? { id: principalId } : {}), ...(person?.name ? { name: person.name } : {}) },
    ...(extra.reason ? { after: { reason: extra.reason } } : {}),
    actor: extra.auth ? (host.IDENTITY.kind === "perspicax" ? host.orgAuditActor(extra.auth) : host.decisionActorFor(extra.auth)) : { kind: "worker" }
  });

}
  return routineAudit;
}
