// A bot's per-turn anti-loop limits (#1098, 2026-10-27). One turn of a bot
// may post to rooms, open threads and create rooms only a handful of times:
// past that the turn has stopped reporting and started fanning out. The
// values below stay the defaults; the bot's owner changes them for their own
// bot in the bot editor (server/routes/bot-runtime-settings.ts), without an
// admin. Shared by the server (server/index.ts) and the app
// (src/components/bot-settings/BotTurnLimitsSettings.tsx).

export type TurnLimitKey = "roomPosts" | "threadsOpened" | "roomsCreated";
export type BotTurnLimits = Partial<Record<TurnLimitKey, number>>;

export const TURN_LIMIT_KEYS: readonly TurnLimitKey[] = ["roomPosts", "threadsOpened", "roomsCreated"];

/** post_to_room calls, start_thread calls and rooms created in one turn. */
export const DEFAULT_TURN_LIMITS: Readonly<Record<TurnLimitKey, number>> = { roomPosts: 3, threadsOpened: 5, roomsCreated: 4 };

/** The highest value an owner may choose for one limit. */
export const MAX_TURN_LIMIT = 50;

/** The choices the bot editor offers. */
export const TURN_LIMIT_CHOICES: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10, 15, 20, 30, 50];

/** The limit this bot applies now: its owner's value, else the default. */
export function botTurnLimit(bot: { turnLimits?: BotTurnLimits } | null | undefined, key: TurnLimitKey): number {
  const value = bot?.turnLimits?.[key];
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_TURN_LIMIT ? value : DEFAULT_TURN_LIMITS[key];
}

/** The longest brief coordinate_bots carries to a teammate (characters).
 * 4 000 cut real QA briefs short (2026-11-09): a review request with its
 * acceptance list ran past it and the hand-off failed. */
export const COORDINATE_MESSAGE_MAX_CHARS = 16_000;
