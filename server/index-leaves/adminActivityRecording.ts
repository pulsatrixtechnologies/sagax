// @ts-nocheck
/** adminActivityRecording (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createAdminActivityRecording(getHost: () => Host): any {
function adminActivityRecording() {
  const host = getHost();
  const { sharedSignIn } = host;

  // Slice 7: always on for an organization server (the console's Audit page).
  if (host.IDENTITY.kind === "perspicax") return true;
  if (host.DESKTOP_MANAGED) return false;
  if (host.HOSTED_WORKSPACE) return true;
  const chatOnly = (scopes: readonly string[]) => !scopes.includes("admin");
  return sharedSignIn(host.signInAllowList()) || host.sessions.list().some((session) => chatOnly(session.scopes)) ||
    host.sessions.openPairings().some((pairing) => chatOnly(pairing.scopes));

}
  return adminActivityRecording;
}
