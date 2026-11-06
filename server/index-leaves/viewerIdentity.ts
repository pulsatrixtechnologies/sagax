// @ts-nocheck
/** viewerIdentity (#1388). Pure move from server/index.ts. */
import { capabilitiesForAuth } from "../auth/request-auth.ts";
export type Host = Record<string, any>;

export function createViewerIdentity(getHost: () => Host): any {
function viewerIdentity(auth: RequestAuth) {
  const host = getHost();
  const { can, personAvatarUrl, personDisplayName } = host;

  if (auth.kind === "loopback" && auth.trust === "service") return null;
  const role = host.channelActorRole(auth);
  const canCreateBots = host.botCreationAllowed(auth);
  const managed = host.profileManagedFor(auth) ? host.PROFILE_MANAGEMENT! : {};
  const effective = host.IDENTITY.kind === "perspicax" ? host.callerPermissions(auth) ?? host.effectivePermissions({ admin: true, fromDirectory: null }) : null;
  const capabilities = capabilitiesForAuth(auth, {
    orgPairing: host.IDENTITY.kind === "perspicax", viewUsage: effective ? can(effective, "usage.view") : false,
    // 2026-10-19: the screens a delegated admin key opens (shared/permissions.ts)
    editConfig: effective ? can(effective, "server.settings") : false,
    manageComputers: effective ? can(effective, "host.shell") : false,
    manageBackups: effective ? can(effective, "backup.workspace") : false
  });
  const permissionFields = effective ? { permissions: host.permissionList(effective), permissionsSource: effective.source } : {};
  if (host.viewerIsOperator(auth)) {
    return {
      operator: true, principalId: host.localPrincipalId(), email: host.cfg.profile?.email?.trim() ?? "",
      name: host.cfg.profile?.name?.trim() ?? "", role, canCreateBots, capabilities, ...permissionFields, ...managed
    };
  }
  const session = (auth as Extract<RequestAuth, { kind: "session" }>).session;
  const principalId = session.principalId?.trim() || null;
  const person = principalId ? host.principals.byId(principalId) : undefined;
  const email = session.email?.trim() || person?.email?.trim() || "";
  const avatarUrl = personAvatarUrl(person);
  return {
    // the name Perspicax sent (refreshed on each sign-in and directory
    // sync), else the address, else the login
    operator: false, principalId, email, name: personDisplayName({ ...person, email }), role, canCreateBots, capabilities, ...permissionFields,
    ...(host.personBotsReadOnly(principalId) ? { botsReadOnly: true as const, ...(principalId && !host.personSheetBotsUseOnly(principalId) ? { botsReadOnlyReason: "permission" as const } : {}) } : {}),
    operatorName: host.cfg.profile?.name?.trim() || "",
    ...managed,
    ...(avatarUrl ? { avatarUrl } : {})
  };

}
  return viewerIdentity;
}
