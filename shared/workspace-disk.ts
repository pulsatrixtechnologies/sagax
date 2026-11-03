// How full a server environment's /workspace volume is, from its own
// filesystem figures (df). One rule for the bot's warning
// (server/sandbox/sandbox-bot-folder.ts), the phone's diskState
// (server/routes/computer-status.ts) and the Computer tab's banner.

export interface WorkspaceDisk {
  freeBytes: number;
  totalBytes: number;
}

export type WorkspaceDiskLevel = "normal" | "almostFull" | "full";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Full under 200 MiB or 2% free, almost full under 10% free (at most
 * 1 GiB asked): small volumes warn early, large ones not for nothing. */
export function workspaceDiskLevel(disk: WorkspaceDisk | null | undefined): WorkspaceDiskLevel {
  if (!disk || !(disk.totalBytes > 0) || !Number.isFinite(disk.freeBytes)) return "normal";
  if (disk.freeBytes < Math.max(200 * MiB, disk.totalBytes * 0.02)) return "full";
  if (disk.freeBytes < Math.min(GiB, disk.totalBytes * 0.1)) return "almostFull";
  return "normal";
}
