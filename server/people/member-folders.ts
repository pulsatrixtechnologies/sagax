// Which folders of the server's disk a member may name as a working folder
// (#1098, 2026-10-28). On an organization server a member manages the
// working folder of their own bots and groups, but the server's disk is
// shared: pointing a bot at someone else's folder, or at a system folder,
// would let their bot read other people's data and the server's own. So a
// member's folder stays inside their own roots: their person folder on the
// server, the workspaces of their own bots, and the folders an admin opened
// to them (`organization.memberFolders`). Both sides are resolved to their
// real location first (symlinks, `..`). An admin, the operator and a solo
// server keep the current rule (any existing folder). A bot's own computer
// (a connected remote session) is checked on that computer, never here; a
// per-person sandbox always works in its own /workspace, whatever this
// field says.
import { createHash } from "node:crypto";
import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";

export const MEMBER_FOLDER_REFUSED = {
  error: "That folder is outside your own folders on this server. Choose a folder in your own space or your bots' workspaces, or ask an admin to open it to you.",
  code: "folder_outside_own_space",
} as const;

/** The person's own folder on the server's disk, created on first use. */
export function personFolder(dataDir: string, principalId: string): string {
  const key = createHash("sha256").update(principalId.trim().toLowerCase()).digest("hex").slice(0, 32);
  const dir = join(dataDir, "person-folders", key);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function real(path: string): string | null {
  try { return realpathSync(path); } catch { return null; }
}

/** Whether `folder`, symlinks and `..` resolved, is one of `roots` or inside one. */
export function insideFolderRoots(folder: string, roots: readonly string[]): boolean {
  if (!isAbsolute(folder)) return false;
  const target = real(folder);
  if (!target) return false;
  return roots.some((root) => {
    if (!root || !isAbsolute(root)) return false;
    const base = real(root);
    if (!base) return false;
    const rel = relative(base, target);
    return rel === "" || (!isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`));
  });
}

/** The folders an admin opened to this person (`organization.memberFolders`,
 * keyed by principal id, or `*` for every member). */
export function openedMemberFolders(config: unknown, principalId: string): string[] {
  if (!config || typeof config !== "object" || Array.isArray(config)) return [];
  const map = config as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(map[key]) ? (map[key] as unknown[]).filter((item): item is string => typeof item === "string") : []);
  return [...list(principalId.trim().toLowerCase()), ...list("*")];
}
