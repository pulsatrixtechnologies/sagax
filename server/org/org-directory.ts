import type { OrgRole } from "../../shared/org-role.ts";

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export type { OrgRole };
export interface OrgInvite {
  token: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  usedAt?: number;
  revokedAt?: number;
}
export function inviteStatus(invite: OrgInvite, now: number): "open" | "expired" | "used" | "revoked" {
  if (invite.revokedAt !== undefined) return "revoked";
  if (invite.usedAt !== undefined) return "used";
  if (now >= invite.expiresAt) return "expired";
  return "open";
}
export function acceptInvite(invite: OrgInvite, now: number) {
  const status = inviteStatus(invite, now);
  if (status !== "open") return { ok: false as const, status };
  return { ok: true as const, invite: { ...invite, usedAt: now } };
}
function actorKey(id: string): string {
  return id.trim().toLowerCase();
}
export function roleOf(input: { ownerUserId: string; admins: string[]; members: string[]; userId: string; email?: string }): OrgRole | null {
  const userId = actorKey(input.userId);
  if (!userId) return null;
  if (userId === actorKey(input.ownerUserId)) return "owner";
  // Lists are sign-in emails. A principal is matched by its email; a legacy
  // email-shaped id still matches itself until the migration has run.
  const key = input.email !== undefined ? actorKey(input.email) : userId;
  if (!key) return null;
  if (input.admins.some((id) => actorKey(id) === key)) return "admin";
  if (input.members.some((id) => actorKey(id) === key)) return "member";
  return null;
}
/** Open invites may sign in. They are not members until accept adds the address. */
export function signInListWithOpenInvites(input: {
  admins: string[];
  members: string[];
  invites: OrgInvite[];
  now: number;
}): { admins: string[]; members: string[] } {
  const members = input.members.map((id) => actorKey(id)).filter(Boolean);
  const extra: string[] = [];
  for (const invite of input.invites) {
    if (inviteStatus(invite, input.now) !== "open") continue;
    const email = actorKey(invite.email);
    if (!email || members.includes(email) || extra.includes(email)) continue;
    extra.push(email);
  }
  return {
    admins: input.admins.map((id) => actorKey(id)).filter(Boolean),
    members: [...members, ...extra],
  };
}
