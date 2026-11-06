// GET /api/people/:id/library (#2117): the Library tab of a person's panel.
// The files the signed-in person and this person have together: every file
// of the rooms they both belong to (listed by name, the direct conversation
// between them included), from every conversation of those rooms. Only rooms
// the viewer reads (groupVisible) count, so person isolation holds: a room
// the viewer is not in, or one only the other person is in, never shows.
// Each file carries its conversation, so the panel downloads and previews it
// through that conversation's own file route.
import type { ThreadFile } from "../threads/thread-files.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PersonLibraryRoom {
  id: string;
  name: string;
  threadId: string;
  humanIds?: string[];
  peopleDm?: boolean;
  dm?: boolean;
  archivedAt?: number;
}

export interface PersonLibraryFile extends ThreadFile {
  threadId: string;
  groupId: string;
  groupName: string;
}

export interface PersonLibraryRouteDeps<G extends PersonLibraryRoom> {
  /** The signed-in person's principal id; none for a caller without one. */
  viewerId(auth: RequestAuth): string | undefined;
  groups(): readonly G[];
  /** Whether this viewer reads the room (channel.read). */
  visible(group: G, viewerId: string): boolean;
  /** Every conversation of the room, its default one first. */
  threadsOf(group: G): readonly string[];
  /** One conversation's files, pins applied. */
  files(threadId: string): Promise<ThreadFile[]>;
}

const key = (id: string | undefined) => (id ?? "").trim().toLowerCase();

/** The rooms both people are listed in by name that the viewer reads. */
export function roomsInCommon<G extends PersonLibraryRoom>(groups: readonly G[], viewerId: string, personId: string, visible: (group: G, viewerId: string) => boolean): G[] {
  const viewer = key(viewerId);
  const person = key(personId);
  if (!viewer || !person || viewer === person) return [];
  return groups.filter((group) => {
    if (group.archivedAt || group.dm) return false;
    const humans = new Set((group.humanIds ?? []).map(key));
    return humans.has(viewer) && humans.has(person) && visible(group, viewerId);
  });
}

export function createPersonLibraryRoutes<G extends PersonLibraryRoom>(deps: PersonLibraryRouteDeps<G>): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    const m = path.match(/^\/api\/people\/([\w-]{1,80})\/library$/);
    if (!m || method !== "GET") return PASS;
    const viewerId = deps.viewerId(auth);
    if (!viewerId) return json(res, 200, { files: [] });
    const rooms = roomsInCommon(deps.groups(), viewerId, m[1]!, deps.visible);
    const out: PersonLibraryFile[] = [];
    const seen = new Set<string>();
    for (const room of rooms) {
      const threads = [...new Set([room.threadId, ...deps.threadsOf(room)])].filter(Boolean);
      for (const threadId of threads) {
        const files = await deps.files(threadId).catch(() => [] as ThreadFile[]);
        for (const file of files) {
          const id = `${threadId}:${file.id}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ ...file, threadId, groupId: room.id, groupName: room.name });
        }
      }
    }
    out.sort((a, b) => b.at - a.at);
    return json(res, 200, { files: out });
  };
}
