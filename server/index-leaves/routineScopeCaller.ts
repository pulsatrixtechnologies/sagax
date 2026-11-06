// @ts-nocheck
/** routineScopeCaller (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createRoutineScopeCaller(getHost: () => Host): any {
function routineScopeCaller(auth: RequestAuth, viewerId: string | undefined) {
  const host = getHost();

  return {
    admin: host.orgAdminCaller(auth),
    viewTeam: host.callerCan(auth, "routines.viewTeam"),
    viewAll: host.callerCan(auth, "routines.viewAll"),
    teamIds: host.IDENTITY.kind === "perspicax" && viewerId ? host.principalTeams(viewerId).map((team) => team.id) : []
  };

}
  return routineScopeCaller;
}
