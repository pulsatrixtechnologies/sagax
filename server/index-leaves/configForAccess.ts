// @ts-nocheck
/** configForAccess (#1388). Pure move from server/index.ts. */
export type Host = Record<string, any>;

export function createConfigForAccess(getHost: () => Host): any {
function configForAccess(status: ReturnType<typeof configStatus>, admin: boolean) {
  void getHost();
  if (admin) return status;
  // Configured-or-not is fine; an SSH alias, an email, a browser partition
  // id, and the sign-in list are not a client's business. Preserve the
  // source objects.
  return {
    ...status,
    ...("signIn" in status ? { signIn: { admins: [], members: [] } } : {}),
    vps: { configured: status.vps.configured, sshAlias: "" },
    opencodeGo: { configured: status.opencodeGo.configured, providerKeys: [] },
    profile: { name: status.profile.name, email: "" },
    browserProfiles: status.browserProfiles.map((profile) => Object.fromEntries(Object.entries(profile).filter(([key]) => key !== "partitionId")))
  };
}
  return configForAccess;
}
