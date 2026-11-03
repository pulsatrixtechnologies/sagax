import type { OidcTeamClaim } from "../auth/oidc-rp.ts";
export type ConsoleRole = "admin" | "manager" | "employee";

/** Who the assertion names, as the admin API sees them. */
export interface OrgAdminViewer {
  principalId: string;
  sub: string;
  name: string;
  role: ConsoleRole;
  orgAdmin: boolean;
  teams: OidcTeamClaim[];
}

/** What a manager's reach is checked against for one bot. */
export interface AdminBotReach {
  ownerPrincipalId: string;
  /** `user:<pid>` / `team:<id>` of its grants. */
  grantTargets: string[];
  /** Member targets of the shared sections it sits in. */
  sectionMemberTargets: string[];
}
