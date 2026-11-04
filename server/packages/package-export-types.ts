import type { BotPackageSkill } from "../bots/bot-package.ts";
export interface ExportablePackageSkill extends Omit<BotPackageSkill, "name" | "description"> {
  name: string;
  description: string;
  /** Whether the bot has it switched on. Only ranks what fits; never written to the file. */
  enabled?: boolean;
}

// ── v2: one whole team ──────────────────────────────────────────────────────

/** Why a part of the team stayed out of the file. Shown to the person as a
 * list after export; nothing here is an error. */
export type TeamExportSkipReason =
  | "picture_too_large"
  | "picture_invalid"
  | "stdio_server"
  | "insecure_address"
  | "files_not_shared"
  | "lead_not_in_group_chat"
  | "notes_too_large"
  | "skill_changed"
  | "skill_conflict"
  | "bot_skill_limit"
  | "team_skill_limit"
  | "preset_empty"
  | "preset_skill_conflict"
  | "trigger_not_portable";

export interface TeamExportSkip { part: string; reason: TeamExportSkipReason }
