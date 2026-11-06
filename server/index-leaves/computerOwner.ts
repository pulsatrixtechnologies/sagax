// @ts-nocheck
/** computerOwner (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createComputerOwner(getHost: () => Host): any {
function computerOwner(auth: RequestAuth) {
  const host = getHost();
  return clientSessionIsComputerOwner(auth, {
    organization: host.IDENTITY.kind === "perspicax",
    cloudHome: false,
    localPrincipalId: host.localPrincipalId(),
    operatorEmail: host.cfg.profile?.email
  });

}
  return computerOwner;
}
