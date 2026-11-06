// @ts-nocheck
/** viewerIsOperator (#1388). Pure move from server/index.ts. */
import { sessionIsOperator } from "../people/viewer-identity.ts";
export type Host = Record<string, any>;

export function createViewerIsOperator(getHost: () => Host): any {
function viewerIsOperator(auth: RequestAuth) {
  const host = getHost();
  if (auth.kind === "loopback") return auth.trust !== "service";
  return sessionIsOperator({
    principalId: auth.session.principalId,
    email: auth.session.email,
    admin: auth.scopes.includes("admin"),
    localPrincipalId: host.localPrincipalId(),
    operatorEmail: host.cfg.profile?.email,
    // On an organization server a session with no person behind it is never
    // the operator (its profile, bot looks), unless it holds admin scope.
    orgExists: host.IDENTITY.kind === "perspicax"
  });

}
  return viewerIsOperator;
}
