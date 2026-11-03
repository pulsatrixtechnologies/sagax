// Organization server: a group's settings belong to its owner. The owner is
// the person who created it (`createdBy`, recorded since the user-sandbox
// work); an older group falls back to the first person it lists. A group
// with neither has no person behind it (made by the server itself or its
// operator): its organization admins act as its owner.
//
// Only the owner changes the name, instructions, working folder, default
// responder and members, and deletes the group. Anyone else listed may
// still leave it (remove only themselves from its people) and bring their
// own bots in or take them out, never another person's. An organization
// admin gets no override on content; deleting stays open to them for
// moderation (channel.moderate on a room, server/auth/authz.ts).

type OwnedGroup = {
  createdBy?: string;
  humanIds?: readonly string[];
  name?: string;
  bulletin?: string;
  cwd?: string;
  defaultResponder?: unknown;
  memberIds?: readonly string[];
  mentionAll?: boolean;
};

const norm = (value: string) => value.trim().toLowerCase();

/** The owner's id (a principal id, or an email on a group from before
 * principals), or null when the group has no person behind it. */
export function groupOwnerId(group: Pick<OwnedGroup, "createdBy" | "humanIds">): string | null {
  const recorded = typeof group.createdBy === "string" ? norm(group.createdBy) : "";
  if (recorded) return recorded;
  const first = (group.humanIds ?? []).map(norm).find((entry) => entry && !entry.startsWith("team:"));
  return first ?? null;
}

export type GroupActor = {
  /** Principal id; empty for nobody. */
  id: string;
  email?: string;
  /** Organization admin (Perspicax role). */
  orgAdmin: boolean;
};

const actorIds = (actor: GroupActor) => [actor.id, actor.email ?? ""].map(norm).filter(Boolean);

/** Whether this actor owns the group's settings. */
export function ownsGroup(group: Pick<OwnedGroup, "createdBy" | "humanIds">, actor: GroupActor): boolean {
  const owner = groupOwnerId(group);
  if (owner === null) return actor.orgAdmin;
  return actorIds(actor).includes(owner);
}

/** The fields only the owner may change. */
export const OWNER_ONLY_GROUP_FIELDS = ["name", "bulletin", "cwd", "defaultResponder", "memberIds", "humanIds", "mentionAll"] as const;

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function changes(group: OwnedGroup, field: (typeof OWNER_ONLY_GROUP_FIELDS)[number], value: unknown): boolean {
  switch (field) {
    case "name": return typeof value !== "string" || value.trim() !== (group.name ?? "");
    case "bulletin": return value !== (group.bulletin ?? "");
    case "cwd": return (typeof value === "string" ? value.trim() || null : value ?? null) !== (group.cwd ?? null);
    case "defaultResponder": return !same(value, group.defaultResponder);
    case "mentionAll": return (value === true) !== (group.mentionAll === true);
    case "memberIds": return !same(value, group.memberIds ?? []);
    case "humanIds": {
      if (!Array.isArray(value)) return true;
      const before = new Set((group.humanIds ?? []).map(norm));
      const after = new Set(value.map((entry) => (typeof entry === "string" ? norm(entry) : "")));
      return before.size !== after.size || [...after].some((entry) => !before.has(entry));
    }
  }
}

/** A patch that only takes the actor out of the group's people. */
export function isSelfLeave(group: Pick<OwnedGroup, "humanIds">, humanIds: unknown, actor: GroupActor): boolean {
  if (!Array.isArray(humanIds) || humanIds.some((entry) => typeof entry !== "string")) return false;
  const mine = actorIds(actor);
  if (!mine.length) return false;
  const before = (group.humanIds ?? []).map(norm);
  const after = new Set((humanIds as string[]).map(norm));
  if ([...after].some((entry) => !before.includes(entry))) return false;
  const removed = before.filter((entry) => !after.has(entry));
  return removed.length > 0 && removed.every((entry) => mine.includes(entry));
}

/** A roster change that only adds or removes bots the actor owns. A pure
 * reorder is not one: the order is the owner's. */
export function isOwnBotsChange(
  group: Pick<OwnedGroup, "memberIds">,
  memberIds: unknown,
  actor: GroupActor,
  botOwner: (botId: string) => string | undefined,
): boolean {
  if (!Array.isArray(memberIds) || memberIds.some((id) => typeof id !== "string")) return false;
  const mine = actorIds(actor);
  if (!mine.length) return false;
  const before = new Set(group.memberIds ?? []);
  const after = new Set(memberIds as string[]);
  const touched = [...[...after].filter((id) => !before.has(id)), ...[...before].filter((id) => !after.has(id))];
  if (!touched.length) return false;
  return touched.every((id) => {
    const owner = botOwner(id);
    return owner !== undefined && mine.includes(norm(owner));
  });
}

export const GROUP_OWNER_ONLY_ERROR = "forbidden: only the group's owner can change its settings";

/** Null when the patch is allowed; else the refusal. Fields outside
 * OWNER_ONLY_GROUP_FIELDS (unread, pin, section) are not judged here. */
export function groupPatchOwnerRefusal(
  group: OwnedGroup,
  body: unknown,
  actor: GroupActor,
  botOwner: (botId: string) => string | undefined = () => undefined,
): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (ownsGroup(group, actor)) return null;
  const patch = body as Record<string, unknown>;
  for (const field of OWNER_ONLY_GROUP_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    if (!changes(group, field, patch[field])) continue;
    if (field === "humanIds" && isSelfLeave(group, patch.humanIds, actor)) continue;
    if (field === "memberIds" && isOwnBotsChange(group, patch.memberIds, actor, botOwner)) continue;
    return GROUP_OWNER_ONLY_ERROR;
  }
  return null;
}

/** The owner deletes a group; an organization admin may too (moderation). */
export function mayDeleteGroup(group: Pick<OwnedGroup, "createdBy" | "humanIds">, actor: GroupActor): boolean {
  return actor.orgAdmin || ownsGroup(group, actor);
}
