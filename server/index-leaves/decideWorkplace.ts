// @ts-nocheck
/** decideWorkplace (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createDecideWorkplace(getHost: () => Host): any {
function decideWorkplace(input: { desktopTargeted: boolean; routine: boolean; principal: string | null; personAsked: boolean }) {
  const host = getHost();

  const principal = input.principal?.trim().toLowerCase() || null;
  return host.resolveBotWorkplace({
    organization: host.IDENTITY.kind === "perspicax",
    sandboxConfigured: Boolean(host.userSandbox),
    desktopTargeted: input.desktopTargeted,
    routine: input.routine,
    principal,
    personAsked: input.personAsked,
    preference: host.workplacePreference(principal),
    desktopConnected: host.desktopBridges.connected(principal)
  });

}
  return decideWorkplace;
}
