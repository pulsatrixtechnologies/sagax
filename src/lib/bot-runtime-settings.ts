// A bot's own parallel conversations and automatic recovery
// (server/bots/bot-runtime-settings.ts, 2026-10-15). A bot without a value of
// its own reads the server default (Settings no longer edits it). busySend
// is still stored and exported for older builds; no client reads it since
// 2026-10-18 (the bot routes busy sends itself, server/busy-routing.ts).
import type { BusySendPreference } from "../../shared/parallel-tasks";
import { DEFAULT_MAX_PARALLEL_PER_PERSON } from "../../shared/parallel-tasks";
import type { Bot, ConfigStatus } from "@/state/store";
import type { TurnPayerMode } from "../../shared/turn-payer";

type RuntimeBot = Pick<Bot, "maxConcurrentThreads" | "maxParallelPerPerson" | "busySend" | "automaticRecovery">;
type TurnLimitsPatch = NonNullable<Bot["turnLimits"]>;
type RuntimeConfig = Pick<ConfigStatus, "threads" | "automaticRecovery"> | null | undefined;

export type BotRecovery = NonNullable<Bot["automaticRecovery"]>;

export interface BotRuntimePatch {
  maxConcurrentThreads?: number;
  maxParallelPerPerson?: number;
  busySend?: BusySendPreference;
  automaticRecovery?: BotRecovery;
  /** #1137: who pays for the bot's replies; null goes back to the default. */
  turnPayer?: TurnPayerMode | null;
  /** #1098: per-turn anti-loop limits (shared/turn-limits.ts), merged. */
  turnLimits?: TurnLimitsPatch;
}

/** #1137: who pays for this bot's replies now (its own choice, else the
 * server's default), or null on a solo server (the default is not sent). */
export function botTurnPayer(bot: Pick<Bot, "turnPayer" | "turnPayerDefault">): TurnPayerMode | null {
  if (!bot.turnPayerDefault) return null;
  return bot.turnPayer ?? bot.turnPayerDefault;
}

/** PUT /api/groups/:id/bot-payer (#1137). */
export function groupBotPayerPath(groupId: string): string {
  return `/api/groups/${encodeURIComponent(groupId)}/bot-payer`;
}

export const BOT_THREAD_LIMITS = Array.from({ length: 16 }, (_, i) => i + 1);

export function botThreadLimit(bot: RuntimeBot, config: RuntimeConfig): number {
  return bot.maxConcurrentThreads ?? config?.threads?.maxConcurrentPerBot ?? 3;
}

export function botParallelLimit(bot: RuntimeBot, config: RuntimeConfig): number {
  return bot.maxParallelPerPerson ?? config?.threads?.maxParallelPerPerson ?? DEFAULT_MAX_PARALLEL_PER_PERSON;
}

export function botRecovery(bot: RuntimeBot, config: RuntimeConfig): BotRecovery {
  return bot.automaticRecovery ?? config?.automaticRecovery ?? { enabled: false };
}

export function botRuntimeSettingsPath(botId: string): string {
  return `/api/bots/${encodeURIComponent(botId)}/runtime-settings`;
}

export function botToolGrantsPath(botId: string, grantId?: string): string {
  const base = `/api/bots/${encodeURIComponent(botId)}/tool-grants`;
  return grantId ? `${base}/${encodeURIComponent(grantId)}/revoke` : base;
}
