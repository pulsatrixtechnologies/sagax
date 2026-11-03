// One approval level per bot (2026-10-26): the owner's "permission
// mode" (Approval, Automatic approval, Bypass) was a second setting beside
// the approval level (Ask for approval, Auto-accept edits, Approve for me,
// Full access). It is gone; a mode someone chose is carried into the level
// once, at startup, then dropped from owner-approvals.json.
//
// Correspondence (the closest level to what the person chose):
//   Approval            -> the level stays as it is
//   Automatic approval  -> Approve for me, when the level was below it
//                          (Ask, Auto-accept edits); unchanged otherwise
//   Bypass              -> Full access, when the bot's engine runs Full;
//                          else Approve for me (when the level was below it)
// Custom (Codex config.toml) is never touched. A mode chosen by a previous
// owner of the bot is dropped without changing anything, as it already read
// as Approval for the current owner.
import type { ApprovalMode } from "../../shared/approval-mode.ts";

export type LegacyPermissionMode = "approval" | "auto" | "bypass";

const RANK: Partial<Record<ApprovalMode, number>> = { ask: 0, edits: 1, auto: 2, full: 3 };

/** The level one stored level becomes under a legacy mode, or null when it
 * stays as it is. */
export function migratedApprovalLevel(level: ApprovalMode, legacy: LegacyPermissionMode, fullSupported: boolean): ApprovalMode | null {
  if (legacy === "approval" || level === "custom") return null;
  const target: ApprovalMode = legacy === "bypass" && fullSupported ? "full" : "auto";
  return (RANK[target] ?? 0) > (RANK[level] ?? 0) ? target : null;
}

export interface MigrationBot {
  id: string;
  ownerId: string;
  level: ApprovalMode;
  /** The bot's engine runs Full access. */
  fullSupported: boolean;
  tasks: ReadonlyArray<{ threadId: string; level: ApprovalMode | undefined; fullSupported: boolean }>;
}

export interface MigrationPatch {
  botId: string;
  /** The bot's own default level, when it changes. */
  level?: ApprovalMode;
  /** Conversations with a level of their own that change. */
  tasks: Array<{ threadId: string; level: ApprovalMode }>;
}

/** What to change for every stored mode. A row whose bot is gone, or whose
 * owner is no longer the bot's owner, changes nothing. */
export function planPermissionModeMigration(
  modes: Readonly<Record<string, { mode: LegacyPermissionMode; ownerId: string }>>,
  bots: ReadonlyArray<MigrationBot>,
): MigrationPatch[] {
  const patches: MigrationPatch[] = [];
  for (const [botId, row] of Object.entries(modes)) {
    const bot = bots.find((candidate) => candidate.id === botId);
    if (!bot) continue;
    // A row without an owner is from before owners were recorded: the bot's
    // current owner is the one who chose it.
    const rowOwner = typeof row.ownerId === "string" ? row.ownerId.trim().toLowerCase() : "";
    if (rowOwner && (bot.ownerId ?? "").trim().toLowerCase() !== rowOwner) continue;
    const level = migratedApprovalLevel(bot.level, row.mode, bot.fullSupported);
    const tasks = bot.tasks.flatMap((task) => {
      if (task.level === undefined) return [];
      const next = migratedApprovalLevel(task.level, row.mode, task.fullSupported);
      return next ? [{ threadId: task.threadId, level: next }] : [];
    });
    if (level || tasks.length) patches.push({ botId, ...(level ? { level } : {}), tasks });
  }
  return patches;
}

export interface PermissionModeMigrationDeps {
  legacyModes: Readonly<Record<string, { mode: LegacyPermissionMode; ownerId: string }>>;
  /** Read only when a mode is stored, so a fresh install reads nothing. */
  bots: () => ReadonlyArray<MigrationBot>;
  patchBot: (botId: string, level: ApprovalMode) => void;
  patchTask: (botId: string, threadId: string, level: ApprovalMode) => void;
  dropLegacyModes: () => void;
  log: (message: string) => void;
}

/** Carries every stored mode into its approval level, then drops the modes.
 * Throws before dropping when a patch fails, so a retry loses nothing. */
export function runPermissionModeMigration(deps: PermissionModeMigrationDeps): void {
  if (!Object.keys(deps.legacyModes).length) return;
  for (const patch of planPermissionModeMigration(deps.legacyModes, deps.bots())) {
    if (patch.level) deps.patchBot(patch.botId, patch.level);
    for (const task of patch.tasks) deps.patchTask(patch.botId, task.threadId, task.level);
    deps.log(`[approval] permission mode carried into the approval level of one bot (${patch.level ?? "conversations only"})`);
  }
  deps.dropLegacyModes();
}
