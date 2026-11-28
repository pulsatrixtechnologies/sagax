// Paired (non-organization) workspace computer access (#4856): migrate the
// old folder-sharing grant onto the desktop bridge's always/ask/never
// execution access while keeping linked folders as a distinct read setting.

export type DeviceAccess = "always" | "ask" | "never";

export type LinkedFolder = {
  id: string;
  path: string;
  name: string;
  write: boolean;
};

/** A saved folder-sharing grant from computer-sharing.json (maintainer path). */
export type FolderSharingGrant = {
  enabled?: boolean;
  folders?: unknown;
  terminal?: boolean;
  computer?: boolean;
  sessionId?: string | null;
  environmentId?: string | null;
  id?: string;
  secret?: string;
  cloud?: unknown;
};

export type PairedWorkspaceAccess = {
  /** Execution on this computer for that paired workspace. */
  access: DeviceAccess;
  /** Linked folders kept as the read setting; never implies execute. */
  folders: LinkedFolder[];
  /** Binding to the paired session and workspace identity. */
  sessionId: string | null;
  environmentId: string | null;
};

const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

/** Keep only well-shaped folder rows; paths stay absolute. */
export function linkedFoldersOf(value: unknown): LinkedFolder[] {
  if (!Array.isArray(value)) return [];
  const out: LinkedFolder[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (!uuid(row.id) || typeof row.path !== "string" || !row.path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(row.path)) continue;
    if (typeof row.write !== "boolean") continue;
    const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 120) : row.path.replace(/^.*[/\\]/, "").slice(0, 120) || "Folder";
    if (out.some((folder) => folder.id === row.id || folder.path === row.path)) continue;
    out.push({ id: row.id, path: row.path, name, write: row.write });
  }
  return out.slice(0, 20);
}

/**
 * Map a previous folder-sharing grant to desktop-bridge execution access.
 * Read (folders) and execute (terminal / screen) stay distinct: a read-only
 * folder grant never becomes Always allow for commands.
 */
export function migrateFolderGrantToExecutionAccess(grant: FolderSharingGrant | null | undefined): PairedWorkspaceAccess {
  const folders = linkedFoldersOf(grant?.folders);
  const sessionId = uuid(grant?.sessionId) ? grant!.sessionId! : null;
  const environmentId = uuid(grant?.environmentId) ? grant!.environmentId! : null;
  if (!grant || grant.enabled !== true || grant.cloud) {
    return { access: "never", folders, sessionId, environmentId };
  }
  const canExecute = grant.terminal === true || grant.computer === true;
  // Execute permission → Always allow. Folders alone → Ask (read kept, no silent execute).
  const access: DeviceAccess = canExecute ? "always" : folders.length > 0 ? "ask" : "never";
  return { access, folders, sessionId, environmentId };
}

/** Whether a path sits under one of the linked folders (read setting). */
export function pathInLinkedFolders(pathValue: string, folders: readonly LinkedFolder[]): boolean {
  if (!folders.length) return false;
  const normalized = pathValue.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
  return folders.some((folder) => {
    const root = folder.path.replace(/\\/g, "/").replace(/\/+$/, "") || "/";
    return normalized === root || normalized.startsWith(`${root}/`);
  });
}
