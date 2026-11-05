// Per-bot runtime settings (2026-10-15). Three cards of Settings > General
// > Advanced became settings of each bot, edited in the bot editor:
//
// - Parallel conversations: `maxConcurrentThreads` (conversations of this bot
//   working at once), `maxParallelPerPerson` (parallel tasks one person may
//   have running on it) and `busySend` (what a message sent while it works
//   does by default).
// - Automatic recovery: `automaticRecovery` ({ enabled, backup }), used with
//   the bot's own `fallback` chain when one is set.
// - Tool access: the bot's grants in server/tools/tool-grants.ts (subject
//   { kind: "bot", id }), through server/routes/bot-runtime-settings.ts.
//
// - Turn limits (#1098, 2026-10-27): `turnLimits`, the bot's per-turn
//   anti-loop limits (room posts, threads opened, rooms created,
//   shared/turn-limits.ts). Absent: the defaults.
//
// The global values of config.json (`threads.maxConcurrentPerBot`,
// `threads.maxParallelPerPerson`, `automaticRecovery`) are no longer edited
// in the app. They stay readable as the server default for a bot that has
// no value of its own (a bot made before the migration ran, or by a path
// that sets none). The migration below copies them onto every existing bot
// once, so a later change of the global value never moves an existing bot.
import { z } from "zod";

import { isModelVariant, type ModelSelection } from "../contracts.ts";
import { DEFAULT_MAX_PARALLEL_PER_PERSON, maxParallelPerPersonFor, SOLO_MAX_PARALLEL_PER_PERSON, type BusySendPreference } from "../../shared/parallel-tasks.ts";
import { MAX_TURN_LIMIT, type BotTurnLimits } from "../../shared/turn-limits.ts";
import { isSharedHost } from "../host-kind.ts";
import { EFFORT_LEVELS } from "../../shared/wire.ts";

/** Same bounds as config.ts (DEFAULT_ / MAX_CONCURRENT_BOT_THREADS). */
export const DEFAULT_BOT_CONCURRENT_THREADS = 3;
export const MAX_BOT_CONCURRENT_THREADS = 16;

/** Marker file in the data directory: the one-time copy has run. */
export const RUNTIME_SETTINGS_MIGRATION_MARKER = "bot-runtime-settings.v1";

export interface BotAutomaticRecovery { enabled: boolean; backup?: ModelSelection }

export interface BotRuntimeSettings {
  maxConcurrentThreads?: number;
  maxParallelPerPerson?: number;
  busySend?: BusySendPreference;
  automaticRecovery?: BotAutomaticRecovery;
  turnLimits?: BotTurnLimits;
}

/** The global values as config.json keeps them. */
export interface GlobalRuntimeSettings {
  threads?: { maxConcurrentPerBot?: number; maxParallelPerPerson?: number };
  automaticRecovery?: BotAutomaticRecovery;
}

const backupSchema = z.object({
  instanceId: z.string().trim().min(1).max(200).regex(/^[\w.-]+$/),
  model: z.string().trim().min(1).max(500),
  effort: z.enum(EFFORT_LEVELS).optional(),
  variant: z.string().refine(isModelVariant, "invalid model variant").optional(),
}).strict().refine((selection) => selection.variant === undefined || selection.effort === undefined,
  "choose either a model variant or an effort level");

export const botAutomaticRecoverySchema = z.object({
  enabled: z.boolean(),
  backup: backupSchema.optional(),
}).strict().refine((recovery) => !recovery.enabled || recovery.backup !== undefined,
  { message: "Choose a backup model before turning on automatic recovery", path: ["backup"] });

export const busySendSchema = z.enum(["ask", "steer", "parallel", "after"]);

const turnLimit = z.number().int().min(1).max(MAX_TURN_LIMIT);
export const botTurnLimitsSchema = z.object({
  roomPosts: turnLimit.optional(),
  threadsOpened: turnLimit.optional(),
  roomsCreated: turnLimit.optional(),
}).strict();

/** The fields as a bot template (New bot defaults) or a patch may carry them. */
export const botRuntimeSettingsShape = {
  maxConcurrentThreads: z.number().int().min(1).max(MAX_BOT_CONCURRENT_THREADS).optional(),
  // #1098: up to the solo ceiling here; an organization server keeps its
  // own (the route refuses more, botMaxParallelPerPerson clamps).
  maxParallelPerPerson: z.number().int().min(1).max(SOLO_MAX_PARALLEL_PER_PERSON).optional(),
  busySend: busySendSchema.optional(),
  automaticRecovery: botAutomaticRecoverySchema.optional(),
  turnLimits: botTurnLimitsSchema.optional(),
};

/** #1137: who pays for the bot's replies (shared/turn-payer.ts); null goes
 * back to the default. Not a New bot defaults field. */
export const turnPayerSchema = z.enum(["owner", "speaker"]).nullable();

/** PATCH /api/bots/:id/runtime-settings: at least one field. */
export const botRuntimeSettingsPatchSchema = z.object({ ...botRuntimeSettingsShape, turnPayer: turnPayerSchema.optional() }).strict()
  .refine((patch) => Object.keys(patch).length > 0, { message: "nothing to save" });

export type BotRuntimeSettingsPatch = z.infer<typeof botRuntimeSettingsPatchSchema>;

type BotLike = BotRuntimeSettings | null | undefined;

/** Conversations of this bot that may work at once. */
export function botMaxConcurrentThreads(bot: BotLike, global: GlobalRuntimeSettings): number {
  return bot?.maxConcurrentThreads ?? global.threads?.maxConcurrentPerBot ?? DEFAULT_BOT_CONCURRENT_THREADS;
}

/** Parallel tasks one person may have running on this bot at once. */
export function botMaxParallelPerPerson(bot: BotLike, global: GlobalRuntimeSettings, sharedHost = isSharedHost()): number {
  const value = bot?.maxParallelPerPerson ?? global.threads?.maxParallelPerPerson ?? DEFAULT_MAX_PARALLEL_PER_PERSON;
  return Math.min(value, maxParallelPerPersonFor(sharedHost));
}

/** Whether automatic recovery is on for this bot, and its backup model. */
export function botAutomaticRecovery(bot: BotLike, global: GlobalRuntimeSettings): BotAutomaticRecovery {
  return bot?.automaticRecovery ?? global.automaticRecovery ?? { enabled: false };
}

/** The models a failed start tries, in order: the bot's own fallback chain
 * when it has one, else its backup model; none while recovery is off. */
export function botRecoveryBackups(
  bot: (BotRuntimeSettings & { fallback?: ReadonlyArray<{ instanceId: string; model: string }> }) | null | undefined,
  global: GlobalRuntimeSettings,
): Array<{ instanceId: string; model: string }> {
  const recovery = botAutomaticRecovery(bot, global);
  if (!recovery.enabled) return [];
  if (bot?.fallback?.length) return [...bot.fallback];
  return recovery.backup ? [recovery.backup] : [];
}

/** The effective values a client reads (GET /api/bots/:id/runtime-settings). */
export function effectiveBotRuntimeSettings(bot: BotLike, global: GlobalRuntimeSettings): Required<Omit<BotRuntimeSettings, "busySend" | "turnLimits">> & { busySend: BusySendPreference | null } {
  return {
    maxConcurrentThreads: botMaxConcurrentThreads(bot, global),
    maxParallelPerPerson: botMaxParallelPerPerson(bot, global),
    // No server default: absent means each person's own default
    // (their earlier Settings choice, sagax.busySend.v1), "ask" otherwise.
    busySend: bot?.busySend ?? null,
    automaticRecovery: botAutomaticRecovery(bot, global),
  };
}

/** The one-time copy: each bot without a value of its own takes the global
 * one. A bot that already has a value keeps it. `busySend` was each
 * person's own choice on their device, not a server value: it is not copied
 * (absent keeps every person's earlier choice). */
export function planRuntimeSettingsMigration(
  bots: ReadonlyArray<{ id: string } & BotRuntimeSettings>,
  global: GlobalRuntimeSettings,
): Array<{ botId: string; patch: BotRuntimeSettings }> {
  const recovery = global.automaticRecovery ?? { enabled: false };
  const plan: Array<{ botId: string; patch: BotRuntimeSettings }> = [];
  for (const bot of bots) {
    const patch: BotRuntimeSettings = {};
    if (bot.maxConcurrentThreads === undefined) patch.maxConcurrentThreads = global.threads?.maxConcurrentPerBot ?? DEFAULT_BOT_CONCURRENT_THREADS;
    if (bot.maxParallelPerPerson === undefined) patch.maxParallelPerPerson = global.threads?.maxParallelPerPerson ?? DEFAULT_MAX_PARALLEL_PER_PERSON;
    if (bot.automaticRecovery === undefined) patch.automaticRecovery = structuredClone(recovery);
    if (Object.keys(patch).length) plan.push({ botId: bot.id, patch });
  }
  return plan;
}

/** A backup on an engine that was removed: recovery off, backup cleared. */
export function withoutRemovedBackup(recovery: BotAutomaticRecovery | undefined, removed: (instanceId: string) => boolean): BotAutomaticRecovery | undefined {
  if (!recovery?.backup || !removed(recovery.backup.instanceId)) return recovery;
  return { enabled: false };
}
