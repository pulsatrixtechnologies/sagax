// Folders of a person conversation's threads (server/people/people-dms.ts), the
// same requests a bot's folders take (server/threads/thread-folders.ts):
//
//   POST   /api/groups/:id/projects            { name, emoji? }
//   PATCH  /api/groups/:id/projects/:folder    { name?, emoji? }
//   DELETE /api/groups/:id/projects/:folder    (its threads stay, unfiled)
//   PATCH  /api/groups/:id/projects/order      { projectIds }
//
// The folders are the pair's: both people see and change the same ones. The
// auth gate in front already narrowed a person conversation to its two
// people. A room or a bot-to-bot channel has no folders (400).
import { parseFolderBody, parseFolderOrder } from "../threads/thread-folders.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

interface FolderLike { id: string; name: string; emoji?: string }

export interface GroupFolderRouteDeps {
  group(groupId: string): { id: string; peopleDm?: boolean } | undefined;
  folder(groupId: string, projectId: string): FolderLike | undefined;
  create(groupId: string, name: string, emoji?: string | null): FolderLike | null;
  patch(groupId: string, projectId: string, patch: { name?: string; emoji?: string | null }): FolderLike | null;
  reorder(groupId: string, projectIds: string[]): FolderLike[] | null;
  remove(groupId: string, projectId: string): boolean;
  /** The conversation as the caller sees it, after the change. */
  project(groupId: string, auth: RequestAuth): unknown;
}

export function createGroupFolderRoutes(deps: GroupFolderRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/groups\/([\w-]+)\/projects(?:\/([\w-]+))?$/);
    if (!m) return PASS;
    const [, groupId, folderId] = m as unknown as [string, string, string | undefined];
    const reordering = folderId === "order" && method === "PATCH";
    const known = reordering || (method === "POST" && !folderId) || ((method === "PATCH" || method === "DELETE") && Boolean(folderId));
    if (!known) return PASS;
    const group = deps.group(groupId);
    if (!group) return json(res, 404, { error: "no such conversation" });
    if (!group.peopleDm) return json(res, 400, { error: "folders organize the threads of a conversation between two people", code: "folders_people_only" });
    if (reordering) {
      const order = parseFolderOrder(await readBody(req));
      if (!order.ok) return json(res, 400, { error: order.error });
      const projects = deps.reorder(groupId, order.projectIds);
      if (!projects) return json(res, 400, { error: "projectIds must include each of this conversation's folders exactly once" });
      return json(res, 200, { projects, group: deps.project(groupId, auth) });
    }
    if (folderId && !deps.folder(groupId, folderId)) return json(res, 404, { error: "no such folder" });
    if (method === "DELETE") {
      deps.remove(groupId, folderId!);
      return json(res, 200, { group: deps.project(groupId, auth) });
    }
    const folder = parseFolderBody(await readBody(req), method === "POST");
    if (!folder.ok) return json(res, 400, { error: folder.error });
    const project = method === "POST"
      ? deps.create(groupId, folder.patch.name!, folder.patch.emoji)
      : deps.patch(groupId, folderId!, folder.patch);
    if (!project) return json(res, 400, { error: "couldn't save that folder" });
    return json(res, method === "POST" ? 201 : 200, { project, group: deps.project(groupId, auth) });
  };
}
