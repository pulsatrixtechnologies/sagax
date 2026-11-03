// A group's shared memory as its people see it (server/memory/group-memory.ts):
//
//   GET /api/groups/<id>/memory   every person of the group reads it
//   PUT /api/groups/<id>/memory   the group's owner edits it or switches it
//                                 off: { text?, expectedHash?, enabled? }
//
// The auth gate in server/index.ts already answers 404 to anyone who may
// not read the group (pathSubject), so a removed member loses this at once;
// `canRead` repeats it here so the module stands on its own. Bots write
// through the internal group_memory_update route, never here.
import { z } from "zod";

import {
  groupMemoryDoc,
  groupMemoryEnabled,
  groupMemorySupported,
  saveGroupMemory,
  type GroupMemoryGroup,
} from "../memory/group-memory.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface GroupMemoryRouteDeps {
  group(id: string): (GroupMemoryGroup & { name: string }) | undefined;
  /** channel.read on the group for this caller. */
  canRead(auth: RequestAuth, group: GroupMemoryGroup): boolean;
  /** The group's owner (its creator), or the operator at this computer. */
  isOwner(auth: RequestAuth, group: GroupMemoryGroup): boolean;
  setEnabled(groupId: string, enabled: boolean): void;
}

const putSchema = z.object({
  text: z.string().optional(),
  expectedHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  enabled: z.boolean().optional(),
}).strict();

export function createGroupMemoryRoutes(deps: GroupMemoryRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = path.match(/^\/api\/groups\/([\w-]+)\/memory$/);
    if (!m || (method !== "GET" && method !== "PUT")) return PASS;
    const group = deps.group(m[1]!);
    if (!group || !deps.canRead(auth, group)) return json(res, 404, { error: "no such channel" });
    if (!groupMemorySupported(group)) return json(res, 404, { error: "this conversation has no group memory", code: "unsupported" });
    const view = () => {
      const doc = groupMemoryDoc(group.id);
      return { enabled: groupMemoryEnabled(deps.group(group.id) ?? group), canEdit: deps.isOwner(auth, group), text: doc.text, hash: doc.hash, capacity: doc.capacity };
    };
    if (method === "GET") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, view());
    }
    if (!deps.isOwner(auth, group)) {
      return json(res, 403, { error: "Only the owner of this group can change its memory.", code: "not_owner" });
    }
    const parsed = putSchema.safeParse(await readBody(req));
    if (!parsed.success || (parsed.data.text === undefined && parsed.data.enabled === undefined)) {
      return json(res, 400, { error: "send { text, expectedHash } to edit, or { enabled } to switch the group memory on or off" });
    }
    if (parsed.data.text !== undefined) {
      const saved = saveGroupMemory(group.id, parsed.data.text, parsed.data.expectedHash);
      if (!saved.ok && saved.code === "conflict") {
        return json(res, 409, { error: saved.error, code: "conflict", currentHash: saved.current.hash, current: saved.current.text });
      }
      if (!saved.ok) return json(res, 413, { error: saved.error, code: saved.code });
    }
    if (parsed.data.enabled !== undefined) deps.setEnabled(group.id, parsed.data.enabled);
    return json(res, 200, view());
  };
}
