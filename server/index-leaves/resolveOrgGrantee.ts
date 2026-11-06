// @ts-nocheck
/** resolveOrgGrantee (#1388). Pure move from server/index.ts. */
import { isPrincipalId } from "../auth/principals.ts";
export type Host = Record<string, any>;

export function createResolveOrgGrantee(getHost: () => Host): any {
function resolveOrgGrantee(ref: string): { ok: true; id: string } | { ok: false; code: "unknown_person" } {
  const host = getHost();

  const id = ref.trim().toLowerCase();
  const principal = isPrincipalId(id) ? host.principals.byId(id) : null;
  if (!principal?.subject || host.IDENTITY.kind !== "perspicax" || principal.subject.iss !== host.IDENTITY.issuer) return { ok: false, code: "unknown_person" };
  const listed = host.perspicaxDirectory?.directory();
  if (listed) {
    const person = listed.people.find((entry) => entry.sub === principal.subject!.sub);
    return person && person.status === "active" ? { ok: true, id: principal.id } : { ok: false, code: "unknown_person" };
  }
  return principal.disabledAt === undefined ? { ok: true, id: principal.id } : { ok: false, code: "unknown_person" };

}
  return resolveOrgGrantee;
}
