// Folders organize one owner's threads: a bot's, or a group's (a person
// conversation's, server/people-dms.ts). They never own settings,
// transcripts or working directories. The request rules are the same for
// both owners, so they live here once; the routes only pick the owner.
import { isProjectEmoji } from "../store.ts";

export type FolderBodyResult =
  | { ok: true; patch: { name?: string; emoji?: string | null } }
  | { ok: false; error: string };

/** The body of a folder create (POST, a name is required) or edit (PATCH). */
export function parseFolderBody(body: unknown, creating: boolean): FolderBodyResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "body must be a JSON object" };
  const fields = body as { name?: unknown; emoji?: unknown };
  if (Object.keys(fields).some((key) => key !== "name" && key !== "emoji")) {
    return { ok: false, error: "unsupported folder setting" };
  }
  if ((creating || fields.name !== undefined) &&
    (typeof fields.name !== "string" || !fields.name.trim() || fields.name.trim().length > 80)) {
    return { ok: false, error: "folder name must be between 1 and 80 characters" };
  }
  if (fields.emoji !== undefined && fields.emoji !== null && !isProjectEmoji(fields.emoji)) {
    return { ok: false, error: "folder emoji must be one emoji, or null to reset it" };
  }
  const patch: { name?: string; emoji?: string | null } = {};
  if (typeof fields.name === "string") patch.name = fields.name.trim();
  if (fields.emoji !== undefined) patch.emoji = fields.emoji as string | null;
  return { ok: true, patch };
}

/** The body of a folder reorder: `{ projectIds }`, every folder once. */
export function parseFolderOrder(body: unknown): { ok: true; projectIds: string[] } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => key !== "projectIds")) {
    return { ok: false, error: "projectIds must be an array of folder IDs" };
  }
  const ids = (body as { projectIds?: unknown }).projectIds;
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string")) {
    return { ok: false, error: "projectIds must be an array of folder IDs" };
  }
  return { ok: true, projectIds: ids as string[] };
}

export type ThreadOrganizationPatch = {
  archivedAt?: number | undefined;
  snoozedUntil?: number | undefined;
  pinned?: true | undefined;
  projectId?: string | undefined;
};

/** The organization fields of a thread PATCH, the same for a bot thread and
 * a group thread: archive, snooze, pin and folder. Only the fields present
 * in the body are returned; null clears one. `ownsFolder` says whether a
 * folder id is the owner's. */
export function parseThreadOrganization(
  body: Record<string, unknown>,
  ownsFolder: (projectId: string) => boolean,
  folderError = "projectId must be one of this conversation's folders, or null to ungroup the thread",
): { ok: true; patch: ThreadOrganizationPatch } | { ok: false; error: string } {
  const patch: ThreadOrganizationPatch = {};
  if (body.projectId !== undefined) {
    if (body.projectId === null) patch.projectId = undefined;
    else if (typeof body.projectId === "string" && ownsFolder(body.projectId)) patch.projectId = body.projectId;
    else return { ok: false, error: folderError };
  }
  if (body.archivedAt !== undefined) {
    if (body.archivedAt === null) patch.archivedAt = undefined;
    else if (typeof body.archivedAt === "number" && Number.isFinite(body.archivedAt) && body.archivedAt >= 0) patch.archivedAt = body.archivedAt;
    else return { ok: false, error: "archivedAt must be a timestamp, or null to unarchive" };
  }
  if (body.pinned !== undefined) {
    if (typeof body.pinned !== "boolean") return { ok: false, error: "pinned must be a boolean" };
    patch.pinned = body.pinned ? true : undefined;
  }
  if (body.snoozedUntil !== undefined) {
    if (body.snoozedUntil === null) patch.snoozedUntil = undefined;
    else if (typeof body.snoozedUntil === "number" && Number.isFinite(body.snoozedUntil) && body.snoozedUntil >= 0) patch.snoozedUntil = body.snoozedUntil;
    else return { ok: false, error: "snoozedUntil must be a timestamp, 0 to snooze until activity, or null to wake now" };
  }
  return { ok: true, patch };
}
