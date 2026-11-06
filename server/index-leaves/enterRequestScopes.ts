// @ts-nocheck
/** enterRequestScopes (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createEnterRequestScopes(getHost: () => Host): any {
function enterRequestScopes(scopes: RequestScopes) {
  const host = getHost();

  // Set for every request (null when none), so a kept-alive connection never inherits one.
  host.adminActorScope.enterWith(scopes.adminActor ?? null);
  host.threadViewerScope.enterWith(scopes.viewer);
  host.delegatedRequestScope.enterWith(scopes.delegated);
  host.continuationThreadScope.enterWith(scopes.continuation);
  host.actConfirmedScope.enterWith(scopes.actConfirmed);

}
  return enterRequestScopes;
}
