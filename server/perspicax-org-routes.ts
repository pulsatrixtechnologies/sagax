// The organization routes of a server signed in with Perspicax (slice 3):
//
//   GET   /api/org            the organization, the link to Perspicax, the
//                             viewer's role and the settings (no people, no
//                             invitations: Perspicax owns both)
//   GET   /api/org/directory  the people a bot owner may share with (client)
//   PATCH /api/org/settings   { interimAttachDays?, allowFullAccess?,
//                             memberEnvironmentAutonomy?, confidentialThreadsByDefault?,
//                             memberAutoApproval?, allowVaultExport?,
//                             pluginMarketplaces?, githubClientId? }
//                             (organization admin). The organization's
//                             GitHub credentials are in the one list
//                             (server/routes/github-credentials.ts).
//   GET   /api/org/approvals  approvals waiting for an organization admin
//                             (server commands of members' bots)
//   GET   /api/org/routine-delegation
//                             the caller's own routine delegation (slice 6),
//                             read-only: since 2026-10-08 it is issued
//                             automatically, with no consent and no revoke
//
// Registered before the interim organization routes, which answer only in
// solo mode (server/org-routes.ts).
import type { OrgBotSecretPublic } from "../shared/org-bot-secrets.ts";
import type { DirectoryPerson, DirectoryState } from "./perspicax-link.ts";
import { OrgBotSecretsError, parseOrgBotSecretChange, type OrgBotSecretChange } from "./org-bot-secrets.ts";
import type { OrgFlowPluginsStatus } from "./org-flow-plugins.ts";
import type { Principal } from "./principals.ts";
import type { RequestAuth } from "./request-auth.ts";
import { PASS, type RouteHandler } from "./routes/table.ts";
import { personAvatarUrl, personDisplayName } from "./viewer-identity.ts";

export interface OrgSettings {
  /** The server has a key for at least one engine (Settings > Connections):
   * the organization's key, used after the speaker's own subscription and
   * key (2026-10-01; the old memberBotsUseOrgKey switch is gone). */
  orgKeyConfigured: boolean;
  /** Slice 8: the window to attach people from before Perspicax. `until`
   * is null when it never opened or is closed; `people` still waiting. */
  interimAttach?: { until: number | null; people: number };
  /** Whether bots may run with Full access (server/org-full-access.ts):
   * on by default, an admin turns it off. */
  allowFullAccess: boolean;
  /** 2026-10-16: a bot a member owns runs commands in its owner's own
   * isolated environment without a card (server/member-environment.ts):
   * on by default, an admin turns it off. */
  memberEnvironmentAutonomy: boolean;
  /** 2026-10-16: new threads start confidential unless the person says
   * otherwise (server/confidential-threads.ts): off by default. */
  confidentialThreadsByDefault?: boolean;
  /** 2026-10-16: a bot a member owns runs its Auto and Auto-accept edits
   * levels as such (server/member-auto-approval.ts): on by default, an
   * admin turns it off. */
  memberAutoApproval: boolean;
  /** 2026-10-18: whether people may export their credential vault in clear
   * (server/routes/credential-vault.ts): on by default, an admin turns it
   * off. */
  allowVaultExport?: boolean;
  /** Where bots' Claude Code plugins may come from (server/bot-plugins.ts):
   * any marketplace by default, or the admin's list. */
  pluginMarketplaces?: { mode: "any" } | { mode: "list"; allow: string[] };
  /** lot 4: "perspicax" when Perspicax owns the rule (written there). */
  pluginMarketplacesOwner?: "perspicax" | "local";
  /** 2026-10-18: Pulsatrix Flow's default plugins as this server installed
   * them (server/org-flow-plugins.ts); read only, declared in Perspicax. */
  flowPlugins?: OrgFlowPluginsStatus;
  /** The organization's GitHub OAuth App for "Connecter GitHub" (a public
   * client id; null: people paste a token). `fromEnvironment` when it comes
   * from SAGAX_GITHUB_CLIENT_ID. */
  github?: { clientId: string | null; fromEnvironment: boolean };
}

export interface OrgDirectoryEntry {
  principalId: string;
  name: string;
  login: string;
  email?: string;
  role: "admin" | "member";
  disabled: boolean;
  /** Slice 4: the teams this person is in. */
  teams?: { id: string; manager: boolean }[];
  /** Their Perspicax avatar as this server serves it, when they have one. */
  avatarUrl?: string;
  /** A Perspicax service account (`kind: "service"`): never a person to
   * write to (server/people-dms.ts). */
  service?: true;
  /** Admins only: this person's page in the Perspicax console
   * (`<issuer>/console/users/<sub>`). Never sent to a member. */
  manageUrl?: string;
  /** Their custom label, Sagax's own (server/routes/person-labels.ts). */
  label?: string;
}

export interface OrgDirectoryTeam {
  id: string;
  name: string;
  managers: string[];
  members: string[];
}

export interface OrgDirectoryViewer {
  principalId: string | null;
  orgRole: "admin" | "member";
  perspicaxRole?: "admin" | "manager" | "employee";
  managedTeamIds: string[];
}

export interface PendingAdminApproval {
  botId: string;
  botName: string;
  threadId: string;
  requestId: string;
  ownerPrincipalId: string;
  /** The bot owner's name, and the person whose turn asked, when known. */
  ownerName?: string;
  requestedBy?: string;
  tool?: string;
  summary?: string;
  at: number;
}

export interface PerspicaxOrgRouteDeps {
  issuer: string;
  orgName: string;
  /** The directory's state and people, or null when no link file is set. */
  directory(): { state(): DirectoryState; people(): DirectoryPerson[]; serverId(): string | undefined } | null;
  bySubject(iss: string, sub: string): Principal | null;
  viewerRole(auth: RequestAuth): "admin" | "member";
  /** 2026-10-19: a delegated admin key the caller holds (shared/permissions.ts):
   * server.settings opens the organization settings (never the interim
   * attach window), host.shell the admin approvals queue. */
  delegated?(auth: RequestAuth, key: "server.settings" | "host.shell"): boolean;
  settings(): OrgSettings;
  /** Slice 8: set the interim attach window (0..90 days from when it
   * opened; 0 closes it now); throws when it could not be written. */
  saveInterimAttachDays?(days: number, auth: RequestAuth): void;
  /** Allow or refuse Full access for the organization's bots; throws when
   * it could not be written. */
  saveAllowFullAccess?(allowed: boolean, auth: RequestAuth): void;
  saveMemberEnvironmentAutonomy?(allowed: boolean, auth: RequestAuth): void;
  saveConfidentialThreadsByDefault?(on: boolean, auth: RequestAuth): void;
  saveMemberAutoApproval?(allowed: boolean, auth: RequestAuth): void;
  saveAllowVaultExport?(allowed: boolean, auth: RequestAuth): void;
  /** Set the marketplace list (or any); throws a 400-worthy Error on a bad entry. */
  savePluginMarketplaces?(policy: unknown, auth: RequestAuth): void;
  /** Set (or with null clear) the GitHub OAuth App client id. */
  saveGithubClientId?(clientId: string | null, auth: RequestAuth): void;
  /** Team secrets (admin only). list() has no values. change() writes one. */
  botSecrets?: {
    list(): OrgBotSecretPublic[];
    change(change: OrgBotSecretChange): OrgBotSecretPublic[];
    /** A team bot of this organization. A private bot is refused. */
    teamBot(botId: string): boolean;
  };
  pendingAdminApprovals(): PendingAdminApproval[];
  /** Slice 4: the teams with their people (principal ids). */
  teams?(): OrgDirectoryTeam[];
  /** Slice 4: who is asking. */
  viewer?(auth: RequestAuth): OrgDirectoryViewer;
  /** Slice 6: the caller's routine delegation. */
  routineDelegation?: RoutineDelegationRouteDeps;
}

export interface RoutineDelegationRouteDeps {
  status(principalId: string): { state: "active"; consentedAt: number; renewedAt: number; expiresAt: number } | { state: "none" };
  /** The caller's enabled routines that are suspended now. */
  suspendedCount(principalId: string): number;
}

/** `<issuer>/console/users/<sub>`: a person's page in the Perspicax console,
 * where an admin manages them. */
export function perspicaxUserManageUrl(issuer: string, sub: string): string {
  return `${issuer.replace(/\/+$/, "")}/console/users/${encodeURIComponent(sub)}`;
}

/** The directory as principals, sorted by name then login. Only people the
 * directory lists are returned; each carries the principal it upserted.
 * `forAdmin` adds each person's console page (manageUrl). */
export function orgDirectoryEntries(issuer: string, people: DirectoryPerson[], bySubject: (iss: string, sub: string) => Principal | null, forAdmin = false): OrgDirectoryEntry[] {
  const entries: OrgDirectoryEntry[] = [];
  for (const person of people) {
    const principal = bySubject(issuer, person.sub);
    if (!principal) continue;
    const email = principal.email ?? person.email ?? undefined;
    const avatarUrl = personAvatarUrl(principal);
    entries.push({
      principalId: principal.id,
      // the display name, else the address, else the login
      name: personDisplayName({ name: person.name, login: person.login, ...(email ? { email } : {}) }) || person.login,
      login: person.login,
      ...(avatarUrl ? { avatarUrl } : {}),
      ...(email ? { email } : {}),
      ...(principal.label ? { label: principal.label } : {}),
      role: person.role === "admin" ? "admin" : "member",
      disabled: person.status === "disabled",
      ...(person.kind === "service" || person.type === "service" ? { service: true as const } : {}),
      teams: (principal.teams ?? []).map((team) => ({ id: team.id, manager: team.manager })),
      ...(forAdmin ? { manageUrl: perspicaxUserManageUrl(issuer, person.sub) } : {}),
    });
  }
  const text = (value: string) => value.toLocaleLowerCase();
  return entries.sort((a, b) => text(a.name).localeCompare(text(b.name)) || text(a.login).localeCompare(text(b.login)) || a.principalId.localeCompare(b.principalId));
}

export function createPerspicaxOrgRoutes(deps: PerspicaxOrgRouteDeps): RouteHandler {
  const settingsFor = (_auth: RequestAuth): OrgSettings => deps.settings();
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/org" && !path.startsWith("/api/org/")) return PASS;
    const directory = deps.directory();
    if (method === "GET" && path === "/api/org") {
      const serverId = directory?.serverId();
      return json(res, 200, {
        org: { name: deps.orgName, identity: { kind: "perspicax", issuer: deps.issuer, ...(serverId ? { serverId } : {}) } },
        link: directory ? directory.state() : { state: "missing" },
        viewerRole: deps.viewerRole(auth),
        settings: settingsFor(auth),
      });
    }
    if (method === "GET" && path === "/api/org/directory") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, {
        people: directory ? orgDirectoryEntries(deps.issuer, directory.people(), deps.bySubject, deps.viewerRole(auth) === "admin") : [],
        ...(deps.teams ? { teams: deps.teams() } : {}),
        ...(deps.viewer ? { viewer: deps.viewer(auth) } : {}),
      });
    }
    if (method === "PATCH" && path === "/api/org/settings") {
      const admin = deps.viewerRole(auth) === "admin";
      if (!admin && !deps.delegated?.(auth, "server.settings")) return json(res, 403, { error: "Only an organization admin can change these settings." });
      const body = await readBody(req);
      const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : null;
      // the interim attach window feeds identity merges: an admin's alone
      if (!admin && keys?.includes("interimAttachDays")) return json(res, 403, { error: "Only an organization admin can change the interim attach window.", code: "admin_only_field", field: "interimAttachDays" });
      // memberBotsUseOrgKey is gone (2026-10-01): the organization's key
      // serves whenever an admin set one, so it is refused like any other.
      const days = keys?.includes("interimAttachDays");
      const fullAccess = keys?.includes("allowFullAccess");
      const memberEnvironment = keys?.includes("memberEnvironmentAutonomy");
      const confidentialDefault = keys?.includes("confidentialThreadsByDefault");
      const memberAuto = keys?.includes("memberAutoApproval");
      const vaultExport = keys?.includes("allowVaultExport");
      const marketplaces = keys?.includes("pluginMarketplaces");
      const githubClient = keys?.includes("githubClientId");
      const known = new Set(["interimAttachDays", "allowFullAccess", "memberEnvironmentAutonomy", "confidentialThreadsByDefault", "memberAutoApproval", "allowVaultExport", "pluginMarketplaces", "githubClientId"]);
      if (!keys || !keys.length || keys.some((key) => !known.has(key)) ||
        (days && (!deps.saveInterimAttachDays || !Number.isInteger(body.interimAttachDays) || body.interimAttachDays < 0 || body.interimAttachDays > 90)) ||
        (fullAccess && (!deps.saveAllowFullAccess || typeof body.allowFullAccess !== "boolean")) ||
        (memberEnvironment && (!deps.saveMemberEnvironmentAutonomy || typeof body.memberEnvironmentAutonomy !== "boolean")) ||
        (confidentialDefault && (!deps.saveConfidentialThreadsByDefault || typeof body.confidentialThreadsByDefault !== "boolean")) ||
        (memberAuto && (!deps.saveMemberAutoApproval || typeof body.memberAutoApproval !== "boolean")) ||
        (vaultExport && (!deps.saveAllowVaultExport || typeof body.allowVaultExport !== "boolean")) ||
        (marketplaces && !deps.savePluginMarketplaces) ||
        (githubClient && (!deps.saveGithubClientId || (body.githubClientId !== null && (typeof body.githubClientId !== "string" || !/^[\x21-\x7e]{1,128}$/.test(body.githubClientId.trim())))))) {
        return json(res, 400, { error: "send { interimAttachDays: 0 to 90 }, { allowFullAccess: true | false }, { memberEnvironmentAutonomy: true | false }, { confidentialThreadsByDefault: true | false }, { memberAutoApproval: true | false }, { allowVaultExport: true | false }, { pluginMarketplaces: { mode: \"any\" } | { mode: \"list\", allow: [...] } } or { githubClientId: string | null }" });
      }
      try {
        if (marketplaces) deps.savePluginMarketplaces!(body.pluginMarketplaces, auth);
      } catch (error) {
        // lot 4: Perspicax owns the rule; this server keeps no second copy
        const owned = (error as { code?: unknown } | null)?.code === "org_setting_in_perspicax";
        if (owned) return json(res, 409, { error: (error as Error).message, code: "org_setting_in_perspicax" });
        return json(res, 400, { error: error instanceof Error ? error.message : "That marketplace list is not valid.", code: "invalid_policy" });
      }
      try {
        if (days) deps.saveInterimAttachDays!(body.interimAttachDays, auth);
        if (fullAccess) deps.saveAllowFullAccess!(body.allowFullAccess, auth);
        if (memberEnvironment) deps.saveMemberEnvironmentAutonomy!(body.memberEnvironmentAutonomy, auth);
        if (confidentialDefault) deps.saveConfidentialThreadsByDefault!(body.confidentialThreadsByDefault, auth);
        if (memberAuto) deps.saveMemberAutoApproval!(body.memberAutoApproval, auth);
        if (vaultExport) deps.saveAllowVaultExport!(body.allowVaultExport, auth);
        if (githubClient) deps.saveGithubClientId!(typeof body.githubClientId === "string" ? body.githubClientId.trim() : null, auth);
      } catch (error) {
        return json(res, 500, { error: `the organization settings could not be saved: ${error instanceof Error ? error.message : String(error)}` });
      }
      return json(res, 200, { settings: settingsFor(auth) });
    }
    if (method === "GET" && path === "/api/org/approvals") {
      if (deps.viewerRole(auth) !== "admin" && !deps.delegated?.(auth, "host.shell")) return json(res, 403, { error: "Only an organization admin can answer these approvals." });
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { approvals: deps.pendingAdminApprovals() });
    }
    if (path === "/api/org/bot-secrets" && (method === "GET" || method === "POST")) {
      res.setHeader("cache-control", "private, no-store");
      const admin = deps.viewerRole(auth) === "admin" || deps.delegated?.(auth, "server.settings") === true;
      if (!admin) return json(res, 403, { error: "Only an organization admin can see team secrets.", code: "admin_only" });
      if (!deps.botSecrets) return json(res, 404, { error: "not found" });
      if (method === "GET") {
        try {
          return json(res, 200, { secrets: deps.botSecrets.list() });
        } catch (error) {
          const known = error instanceof OrgBotSecretsError ? error : null;
          return json(res, known?.status ?? 503, { error: known?.message ?? "The team secrets could not be read.", code: known?.code ?? "store_unavailable" });
        }
      }
      const body = await readBody(req);
      let change: OrgBotSecretChange;
      try {
        change = parseOrgBotSecretChange(body, (botId) => deps.botSecrets!.teamBot(botId));
      } catch (error) {
        const known = error instanceof OrgBotSecretsError ? error : null;
        return json(res, known?.status ?? 400, { error: known?.message ?? "That secret change is not valid.", code: known?.code ?? "invalid_secret" });
      }
      try {
        return json(res, 200, { secrets: deps.botSecrets.change(change) });
      } catch (error) {
        const known = error instanceof OrgBotSecretsError ? error : null;
        return json(res, known?.status ?? 500, { error: known?.message ?? "The secret could not be saved.", code: known?.code ?? "store_unavailable" });
      }
    }
    if (path === "/api/org/routine-delegation" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      if (auth.kind !== "session") return json(res, 401, { error: "Sign in with Pulsatrix to see your routine access.", code: "session_required" });
      const principalId = auth.session.principalId?.trim();
      if (!principalId || !auth.session.idp || !deps.routineDelegation) {
        return json(res, 403, { error: "Routine delegation needs a person signed in with Pulsatrix.", code: "identity_perspicax" });
      }
      const routines = deps.routineDelegation;
      return json(res, 200, {
        ...routines.status(principalId),
        suspended: routines.suspendedCount(principalId),
        principalId,
      });
    }
    // The interim invitation and creation routes do not exist here.
    if (path === "/api/org" || path.startsWith("/api/org/invites")) {
      return json(res, 403, { error: "This server signs people in with Pulsatrix; the organization is managed in Perspicax.", code: "identity_perspicax" });
    }
    return json(res, 404, { error: "not found" });
  };
}
