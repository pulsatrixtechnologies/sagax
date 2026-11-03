// A person leaves a group chat they were added to (#1480), on their own,
// without an admin: only their own membership, judged from their session.
//
// - They leave the group's people (every id they are listed under: their
//   principal id and, on an older group, their email).
// - Their private bots (owned by them and shared with nobody) leave with
//   them; a bot of theirs that others can use stays.
// - The owner leaving hands the group to the person listed longest (the
//   first one left in `humanIds`, never a team). With nobody left, the group
//   is archived: kept, listed to no one.
// - Their past messages stay. They can be added back like anyone.
// - The others see one neutral line, kind "roster" (WireMessage.roster).

export interface LeavingGroup {
  dm?: boolean;
  peopleDm?: boolean;
  createdBy?: string;
  humanIds?: readonly string[];
  memberIds: readonly string[];
  archivedAt?: number;
}

export interface GroupLeaver {
  /** Principal id of the person leaving. */
  id: string;
  email?: string;
}

export type GroupLeavePlan =
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }
  | {
    ok: true;
    humanIds: string[];
    memberIds: string[];
    /** The new owner when the owner left; absent when ownership stays. */
    createdBy?: string;
    /** Nobody is left: archive the group. */
    archive: boolean;
    /** The private bots that left with the person. */
    removedBotIds: string[];
  };

const norm = (value: string) => value.trim().toLowerCase();

function leaverIds(leaver: GroupLeaver): string[] {
  return [leaver.id, leaver.email ?? ""].map(norm).filter(Boolean);
}

/** The owner as group-ownership.ts reads it: `createdBy`, else the first
 * person listed. */
function ownerOf(group: Pick<LeavingGroup, "createdBy" | "humanIds">): string | null {
  const recorded = typeof group.createdBy === "string" ? norm(group.createdBy) : "";
  if (recorded) return recorded;
  return (group.humanIds ?? []).map(norm).find((entry) => entry && !entry.startsWith("team:")) ?? null;
}

/** Whether this person is listed in the group in their own name (not
 * through a team): only then do they have a membership to leave. */
export function listedInGroup(group: Pick<LeavingGroup, "createdBy" | "humanIds">, leaver: GroupLeaver): boolean {
  const mine = leaverIds(leaver);
  if (!mine.length) return false;
  if ((group.humanIds ?? []).some((entry) => mine.includes(norm(entry)))) return true;
  const owner = ownerOf(group);
  return owner !== null && mine.includes(owner);
}

export function planGroupLeave(
  group: LeavingGroup,
  leaver: GroupLeaver,
  bots: {
    /** The bot's owner id, or undefined when unknown. */
    ownerOf: (botId: string) => string | undefined;
    /** Whether the bot is shared with anyone besides its owner. */
    shared: (botId: string) => boolean;
  },
): GroupLeavePlan {
  if (group.dm) return { ok: false, status: 400, code: "not_a_group", error: "a conversation between two bots has no people to leave" };
  if (group.peopleDm) return { ok: false, status: 400, code: "not_a_group", error: "a conversation between two people cannot be left; hide it instead" };
  if (group.archivedAt) return { ok: false, status: 404, code: "archived", error: "this group is archived" };
  const mine = leaverIds(leaver);
  if (!listedInGroup(group, leaver)) {
    return { ok: false, status: 409, code: "not_listed", error: "you are not listed in this group in your own name" };
  }
  const humanIds = (group.humanIds ?? []).filter((entry) => !mine.includes(norm(entry)));
  const removedBotIds = group.memberIds.filter((botId) => {
    const owner = bots.ownerOf(botId);
    return owner !== undefined && mine.includes(norm(owner)) && !bots.shared(botId);
  });
  const memberIds = group.memberIds.filter((botId) => !removedBotIds.includes(botId));
  const owner = ownerOf(group);
  const wasOwner = owner !== null && mine.includes(owner);
  // the person listed longest: humanIds keeps the order people were added
  const successor = wasOwner ? humanIds.find((entry) => entry.trim() && !norm(entry).startsWith("team:")) : undefined;
  const archive = !humanIds.some((entry) => entry.trim() && !norm(entry).startsWith("team:"));
  return {
    ok: true,
    humanIds,
    memberIds,
    ...(wasOwner && successor ? { createdBy: successor } : {}),
    archive,
    removedBotIds,
  };
}

/** The neutral line the others read. `text` is the fallback for a client
 * that does not know the kind. */
export function groupLeftLine(personId: string, name: string, at: number): {
  role: "bot";
  kind: "roster";
  at: number;
  text: string;
  roster: { event: "left"; personId: string; name: string };
} {
  const shown = name.trim().slice(0, 120) || "Someone";
  return { role: "bot", kind: "roster", at, text: `${shown} left the group`, roster: { event: "left", personId, name: shown } };
}

/** The frame telling the person's own devices they left: only their
 * streams receive it (they no longer see the group's frames). */
export function groupLeftFrameAllowed(payload: { audience?: unknown }, viewerId: string | undefined, localPrincipalId: string | undefined): boolean {
  const audience = typeof payload.audience === "string" ? norm(payload.audience) : "";
  if (!audience) return false;
  const viewer = viewerId ? norm(viewerId) : localPrincipalId ? norm(localPrincipalId) : "";
  return viewer === audience;
}
