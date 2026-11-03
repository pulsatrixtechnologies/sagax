// Organization server: only a group's owner changes its settings or deletes
// it (server/groups/group-ownership.ts); an organization admin may delete it for
// moderation. A solo server sends no `ownerId` and nothing changes there.
import type { ConfigStatus, Group } from "@/state/store";
import { viewerActorId } from "./viewer";

/** Organization admin (or the server's operator). */
export function viewerIsOrgAdmin(config: ConfigStatus | null | undefined): boolean {
  const role = config?.viewer?.role;
  return role === "admin" || role === "owner";
}

/** Whether you may change this group's settings. */
export function viewerOwnsGroup(group: Pick<Group, "ownerId">, config: ConfigStatus | null | undefined): boolean {
  if (group.ownerId === undefined) return true;
  if (group.ownerId === null) return viewerIsOrgAdmin(config);
  const owner = group.ownerId.trim().toLowerCase();
  const email = config?.viewer?.email?.trim().toLowerCase();
  return owner === viewerActorId(config) || (Boolean(email) && owner === email);
}

/** Whether you may delete this group: its owner, or an organization admin. */
export function viewerMayDeleteGroup(group: Pick<Group, "ownerId">, config: ConfigStatus | null | undefined): boolean {
  return viewerOwnsGroup(group, config) || (group.ownerId !== undefined && viewerIsOrgAdmin(config));
}
