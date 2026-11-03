// Who may press "Apply setup" on a team setup card from a signed-in
// session (2026-10-26, #1058).
//
// An organization admin applies any setup. A member applies every setup
// about their own bots: the requesting Primary Bot, every bot the plan
// changes and the bot it deletes are theirs. That covers new bots (their
// right to create bots), a new team, the Primary Bot role among their own
// bots, a deletion of their own bot and every field a member sets on a
// bot they own (2026-10-26: a member manages what is theirs without an
// admin; the organization switch that refused Auto for members' bots is
// gone, server/approvals/member-auto-approval.ts). Stays out of reach: a bot that is not theirs (another person's things),
// and a working folder on the server's disk (folders.botWorkingFolder: it
// reaches other people's files there).

import type { PermissionKey } from "../../shared/permissions.ts";
import { TEAM_SETUP_ADMIN_REQUIRED, type TeamSetupRequest } from "../../shared/team-setup.ts";

export { TEAM_SETUP_ADMIN_REQUIRED, TEAM_SETUP_DESKTOP_ONLY } from "../../shared/team-setup.ts";

export const TEAM_SETUP_DESKTOP_MESSAGE =
  "Approve team setup or deletion from the desktop app or a paired Full-access device. In a local browser, wait until every bot is idle.";
export const TEAM_SETUP_ADMIN_MESSAGE =
  "This setup changes or deletes a bot that is not yours. Only that bot's owner or an organization admin can apply it.";

export interface MemberSetupContext {
  /** The signed-in person, lowercased. */
  callerId: string;
  /** The effective owner of a bot, lowercased; undefined when it is gone. */
  ownerOf(botId: string): string | undefined;
  /** The bot's team as it stands (trimmed, "" for General). */
  sectionOf(botId: string): string | undefined;
  /** The person may create bots on this server. */
  mayCreateBots: boolean;
  /** Whether the person holds this permission. */
  can(permission: PermissionKey): boolean;
  /** #1098: whether this working folder is in the person's own roots on the
   * server (server/member-folders.ts). Absent: any folder. */
  folderAllowed?(folder: string): boolean;
}

export type MemberSetupRefusal = { code: typeof TEAM_SETUP_ADMIN_REQUIRED; error: string; permission?: PermissionKey };

const MEMBER_FIELDS = new Set(["name", "title", "description", "soul", "modelSelection", "chiefOfStaff"]);
const FIELD_PERMISSIONS: Record<string, PermissionKey> = { section: "sharing.visibility", cwd: "folders.botWorkingFolder" };

const admin = (): MemberSetupRefusal => ({ code: TEAM_SETUP_ADMIN_REQUIRED, error: TEAM_SETUP_ADMIN_MESSAGE });
const missing = (permission: PermissionKey): MemberSetupRefusal => ({ code: TEAM_SETUP_ADMIN_REQUIRED, error: TEAM_SETUP_ADMIN_MESSAGE, permission });
const team = (value: string | undefined) => (value ?? "").trim();

/** Why a member may not apply this setup, or null when they may. */
export function memberTeamSetupRefusal(request: TeamSetupRequest, context: MemberSetupContext): MemberSetupRefusal | null {
  const caller = context.callerId.trim().toLowerCase();
  if (!caller || context.ownerOf(request.botId) !== caller) return admin();
  if (request.deletion && context.ownerOf(request.deletion.botId) !== caller) return admin();
  const requesterSection = context.sectionOf(request.botId);
  for (const operation of request.operations) {
    if (operation.action === "update" && context.ownerOf(operation.botId) !== caller) return admin();
    if (operation.action === "create") {
      if (!context.mayCreateBots) return missing("bots.create");
    }
    const current = operation.action === "update" ? context.sectionOf(operation.botId) : requesterSection;
    for (const [field, value] of Object.entries(operation.fields)) {
      if (value === undefined || MEMBER_FIELDS.has(field)) continue;
      // the bot stays in the team it is in (a new one beside its Primary Bot)
      if (field === "section" && team(value as string) === team(current)) continue;
      if (field === "cwd" && value === "") continue;
      const permission = FIELD_PERMISSIONS[field];
      if (!permission) return admin();
      if (!context.can(permission)) return missing(permission);
      if (field === "cwd" && typeof value === "string" && context.folderAllowed && !context.folderAllowed(value)) return admin();
    }
  }
  return null;
}
