import type { OrgRole } from "../../shared/org-role.ts";

export type { OrgRole };

/** True only when the actor owns the bot. An admin is not an exception. */
export function canPlaceBot(input: { actorId: string; ownerUserId: string }): boolean {
  return input.actorId.trim().toLowerCase() === input.ownerUserId.trim().toLowerCase();
}

/** The id canPlaceBot compares against. A recorded owner wins, then a
 * given organization owner, else the local operator. This never
 * substitutes the caller's id. */
export function ownerUserIdForPlacement(input: {
  recordedOwnerUserId?: string;
  orgOwnerUserId?: string;
  localOperatorId: string;
}): string {
  if (input.recordedOwnerUserId) return input.recordedOwnerUserId;
  if (input.orgOwnerUserId) return input.orgOwnerUserId;
  return input.localOperatorId;
}

/** Owner and admin may change who is in a channel. A member may not. */
export function canEditHumans(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/** Humans sit beside bots. A bot-to-bot dm has no human list. */
export function applyHumanIds(input: { dm?: boolean; humanIds: string[] }): { ok: true; humanIds: string[] } | { ok: false; error: "dm-has-no-humans" } {
  if (input.dm) return { ok: false, error: "dm-has-no-humans" };
  return { ok: true, humanIds: input.humanIds };
}

/** A member who owns a room adds people the organization directory shows
 * them (`visible` answers for a principal id) and the organization's teams
 * (`team:<id>`, checked against the directory by the caller; 2026-10-26:
 * a member fills their own group without an admin). Returns the first
 * refused entry, or null. Entries already in the room and the actor
 * themself pass. */
export function firstUnseenPerson(input: {
  actorId: string;
  before: readonly string[];
  after: readonly unknown[];
  visible: (principalId: string) => boolean;
}): string | null {
  const actor = input.actorId.trim().toLowerCase();
  const already = new Set(input.before.map((entry) => entry.trim().toLowerCase()));
  for (const entry of input.after) {
    const id = typeof entry === "string" ? entry.trim().toLowerCase() : "";
    if (!id || id === actor || already.has(id)) continue;
    if (id.startsWith("team:")) continue;
    if (!input.visible(id)) return id || String(entry);
  }
  return null;
}
