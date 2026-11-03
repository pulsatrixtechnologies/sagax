// Who "you" are in the UI: the sidebar profile row, greetings, the name on
// your own messages. The operator at this computer (and a device they paired)
// is the operator, described by their profile as before. Anyone else who
// signed in is described from their own principal and sign-in email, and
// never sees the operator's private profile fields.
import type { OrgRole } from "../rooms/channel-membership.ts";
import type { ViewerCapabilities } from "../../shared/viewer-capabilities.ts";

export interface ViewerIdentity {
  /** The operator at this computer, or a device they paired. */
  operator: boolean;
  /** The person's principal (server/auth/principals.ts), when known. */
  principalId: string | null;
  /** Their own sign-in email; "" when unknown. */
  email: string;
  /** Their display name: a known name, else the email's local part. */
  name: string;
  role: OrgRole | null;
  /** Whether this server lets them create a bot (POST /api/bots). */
  canCreateBots: boolean;
  /** Organization server: a Perspicax admin made this person read-only in
   * Sagax (`sagax_bots: use`). They use the bots shared with them and
   * create, edit or own none. Absent otherwise. */
  botsReadOnly?: true;
  /** Why (2026-10-09): `permission` when their profile lacks bots.create;
   * absent when the person sheet says use only. */
  botsReadOnlyReason?: "permission";
  /** The operator's display name, for lines the operator sent without a
   * named sender. Only set for someone who is not the operator. */
  operatorName?: string;
  /** Organization server: Perspicax owns this person's name and email, which
   * are read-only here (server/auth/oidc-login.ts profileManagement). Absent on a
   * solo server and for the operator at the server's own console. */
  profileManagedBy?: "perspicax";
  /** Where to change them: the issuer console's profile page. */
  profileManageUrl?: string;
  /** Their Perspicax avatar as this server serves it (personAvatarUrl). */
  avatarUrl?: string;
  /** Which installation screens this viewer may change. Absent on a server
   * that predates the field; the client then hides them only for role member. */
  capabilities?: ViewerCapabilities;
  /** Organization server (2026-10-09): the permissions this person holds
   * (shared/permissions.ts), every key for an admin. The app hides or
   * disables with them; the server enforces them. Absent elsewhere. */
  permissions?: string[];
  /** Where they came from: admin, perspicax (their profiles) or defaults. */
  permissionsSource?: "admin" | "perspicax" | "defaults";
}

/** "zara.q@example.test" becomes "zara.q". Anything without an "@" stays itself. */
export function displayNameFromEmail(email: string | undefined): string {
  const trimmed = email?.trim() ?? "";
  const at = trimmed.indexOf("@");
  return (at > 0 ? trimmed.slice(0, at) : trimmed).slice(0, 100);
}

/** How a person reads everywhere they are shown (the "You" row, room
 * members, sharing pickers, message authors, mentions): their display name
 * from Perspicax, else their address's local part, else their login. A name
 * that is only the login (Perspicax's directory falls back to it) does not
 * count as a display name. */
export function personDisplayName(person: { name?: string; email?: string; login?: string } | null | undefined): string {
  const name = person?.name?.trim() ?? "";
  const login = person?.login?.trim() ?? "";
  if (name && name !== login) return name.slice(0, 200);
  return displayNameFromEmail(person?.email) || login || name;
}

/** The URL this server serves a person's Perspicax avatar at, versioned so a
 * changed image is a new URL; undefined when they have none. */
export function personAvatarUrl(person: { id: string; subject?: unknown; avatar?: string } | null | undefined): string | undefined {
  if (!person?.subject || !person.avatar) return undefined;
  return `/api/people/${encodeURIComponent(person.id)}/avatar?v=${encodeURIComponent(person.avatar)}`;
}

/** Whether a session is the operator: its principal is the local operator's,
 * or (a session from before principals) it signed in with the operator's own
 * email, or it is a device paired with no person behind it where that has
 * always meant the operator (an admin code, or any code while no
 * organization exists). */
export function sessionIsOperator(input: {
  principalId?: string;
  email?: string;
  admin: boolean;
  localPrincipalId: string;
  operatorEmail?: string;
  orgExists: boolean;
}): boolean {
  const principalId = input.principalId?.trim();
  if (principalId) return principalId === input.localPrincipalId;
  const email = input.email?.trim().toLowerCase();
  if (email) return Boolean(input.operatorEmail) && email === input.operatorEmail!.trim().toLowerCase();
  return input.admin || !input.orgExists;
}

/** A config status as this viewer may see it: someone who is not the
 * operator gets their own identity in `profile` (no operator email, no
 * about-me, their own avatar, which is none yet), and everyone gets a
 * `viewer` block. */
export function configForViewer<T extends { profile: { name: string; email: string; aboutMe?: string; avatarUrl?: string } }>(
  status: T,
  viewer: ViewerIdentity | null,
): T & { viewer?: ViewerIdentity } {
  if (!viewer) return status;
  if (viewer.operator) return { ...status, viewer };
  return { ...status, profile: { name: viewer.name, email: viewer.email, aboutMe: "", avatarUrl: viewer.avatarUrl ?? "" }, viewer };
}
