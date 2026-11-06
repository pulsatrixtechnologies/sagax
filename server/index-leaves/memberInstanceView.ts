// @ts-nocheck
/** memberInstanceView (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createMemberInstanceView(getHost: () => Host): any {
function memberInstanceView(instance: Awaited<ReturnType<typeof host.describeInstances>>[number], person?: string | null) {
  const host = getHost();

  const { cli: _cli, cliDefault: _cliDefault, cliCandidates: _cliCandidates, install: _install, authentication: _authentication, claudeAccount: _claudeAccount, freeUpSpace: _freeUpSpace, managed: _managed, ...rest } = instance as typeof instance & Record<string, unknown>;
  const { account: _account, authenticated: _authenticated, chatgptPlan: _chatgptPlan, authenticationUnavailableReason: _reason, update: _update, ...snapshot } = (instance.snapshot ?? {}) as Record<string, unknown>;
  // #1533: never an address as an engine's name for a member
  // #1533 (2026-10-28): an engine the organization's key runs says so
  const displayName = typeof rest.displayName === "string" ? host.engineNameForPerson(instance.instanceId, rest.displayName, instance.driverKind, person) : rest.displayName;
  return { ...rest, displayName, snapshot };

}
  return memberInstanceView;
}
