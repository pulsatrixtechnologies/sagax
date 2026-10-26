/** Full, encrypted workspace snapshots are distinct from additive team copies. */
export interface WorkspaceBackupSummary {
  format: "openmaus.workspace-backup";
  version: 1;
  id: string;
  createdAt: string;
  appVersion: string;
  files: number;
  directories: number;
  bytes: number;
  bots: number;
  groups: number;
  threads: number;
  messages: number;
  exclusions: string[];
  warnings: string[];
  /** What to reconnect after a restore, by category: how many sign-ins,
   * keys or links the source held that the backup left out (JC,
   * 2026-10-18: no secret in a workspace backup). Counts only, never a
   * name or a value. Absent in archives made before it. */
  reconnect?: WorkspaceBackupReconnect;
}

/** The reconnect list's categories, in the order the app shows them. */
export const WORKSPACE_BACKUP_RECONNECT = [
  "engines", "providerKeys", "connections", "credentialVault", "mcp", "github",
  "cloudAgents", "triggers", "phones", "sharedLinks", "engineSettings", "files",
] as const;
export type WorkspaceBackupReconnectCategory = typeof WORKSPACE_BACKUP_RECONNECT[number];
/** `count`: sign-ins, keys, files or links; `people`: how many people they belong to, when they are a person's. */
export type WorkspaceBackupReconnect = Partial<Record<WorkspaceBackupReconnectCategory, { count: number; people?: number }>>;

export type WorkspaceBackupClientState = Record<string, string>;

export interface WorkspaceBackupPrivateMetadata {
  summary: WorkspaceBackupSummary;
  clientState: WorkspaceBackupClientState;
}
