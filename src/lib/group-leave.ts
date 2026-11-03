// Leaving a group chat you were added to (#1480, server/groups/group-leave.ts): on
// an organization server, a person listed in a group in their own name may
// leave it, owner included. The owner hands it to the person listed longest;
// the last person archives it.
import type { ConfigStatus, Group } from "@/state/store";
import { viewerActorId } from "./viewer";

type LeavableGroup = Pick<Group, "ownerId" | "humanIds" | "dm" | "peopleDm">;

const norm = (value: string) => value.trim().toLowerCase();

function viewerIds(config: ConfigStatus | null | undefined): string[] {
  return [viewerActorId(config) ?? "", config?.viewer?.email ?? ""].map(norm).filter(Boolean);
}

/** Listed in the group in their own name (not through a team), or its owner. */
export function viewerListedInGroup(group: LeavableGroup, config: ConfigStatus | null | undefined): boolean {
  const mine = viewerIds(config);
  if (!mine.length) return false;
  if ((group.humanIds ?? []).some((entry) => mine.includes(norm(entry)))) return true;
  return typeof group.ownerId === "string" && mine.includes(norm(group.ownerId));
}

/** Whether this viewer may leave the group from this client. */
export function canLeaveGroup(group: LeavableGroup, config: ConfigStatus | null | undefined, remoteClient = false): boolean {
  if (remoteClient || group.dm || group.peopleDm) return false;
  // a solo server sends no owner: there is nobody else to leave the group to
  if (group.ownerId === undefined) return false;
  return viewerListedInGroup(group, config);
}

export type LeaveOutcome = "member" | "owner" | "last";

/** What leaving does, as the server will decide it. */
export function leaveOutcome(group: LeavableGroup, config: ConfigStatus | null | undefined): LeaveOutcome {
  const mine = viewerIds(config);
  const others = (group.humanIds ?? []).filter((entry) => entry.trim() && !mine.includes(norm(entry)) && !norm(entry).startsWith("team:"));
  if (!others.length) return "last";
  return typeof group.ownerId === "string" && mine.includes(norm(group.ownerId)) ? "owner" : "member";
}
