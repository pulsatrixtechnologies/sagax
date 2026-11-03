// Any bot of a person creates bots (2026-10-17): "allow non primary bot
// to create other bots". The rules only, with no store and no clock of their
// own; server/index.ts applies them on /api/internal/create-bot and the
// catalog (server/drivers/agents-catalog.ts) offers create_bot by them.
//
// A Primary Bot keeps exactly the path it had. Any other bot of the person
// takes the same path (same owner, same audience, same card or direct
// creation, same locked-down new bot) and, because it widens who can create,
// these extra limits:
//
//   - The turn is the owner's own request: never another bot's hop, a
//     routine, a webhook or trigger, an email, any automation, a room without
//     a known person, another person (a Team Bot's other users), or a
//     session that speaks for someone else (an AI client or relay acting on
//     behalf of another person). The person's own AI client, signed in as
//     them, is them.
//   - Depth: a bot made by a bot (create_bot, team setup) never creates
//     another, unless the person makes it their Primary Bot. A temporary
//     agent (create_agent) never creates one either.
//   - Rate: at most BOT_CREATIONS_PER_HOUR bots made by bots per person in
//     the last hour, on top of the per-turn ceiling every creator has.
//   - Nobody asked: a suggestion (create_bot suggestion: true) stays the
//     Primary Bot's.
//   - A working folder only when the person may choose one for a bot of
//     theirs (organization permission folders.botWorkingFolder).
//
// A confidential thread creates no bot at all, Primary Bot included
// (server/threads/confidential-threads.ts REFUSED_INTERNAL_ROUTES).

/** A bot made by a bot: which one, how deep, when. Server-private. */
export interface BotCreatedBy {
  botId: string;
  /** 1 for a bot a person's bot made; one more for each bot-made level. */
  depth: number;
  at: number;
}

/** A bot made by a bot never makes another (unless it becomes the Primary Bot). */
export const BOT_CREATION_MAX_DEPTH = 1;
/** Bots made by bots, per person, in any rolling hour (non-Primary creators). */
export const BOT_CREATIONS_PER_HOUR = 6;
export const BOT_CREATION_WINDOW_MS = 3_600_000;

const BOT_ID = /^[\w-]{1,128}$/;

/** A stored mark as a valid one, or null when it is malformed. */
export function cleanBotCreatedBy(value: unknown): BotCreatedBy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.botId !== "string" || !BOT_ID.test(v.botId)) return null;
  if (typeof v.depth !== "number" || !Number.isInteger(v.depth) || v.depth < 1 || v.depth > 1_000) return null;
  if (typeof v.at !== "number" || !Number.isFinite(v.at) || v.at < 0) return null;
  return { botId: v.botId, depth: v.depth, at: v.at };
}

/** How deep a bot is: 0 for a bot a person made. A mark that cannot be read
 * fails closed (too deep), never open. */
export function botCreationDepth(bot: { createdByBot?: unknown }): number {
  if (bot.createdByBot === undefined) return 0;
  return cleanBotCreatedBy(bot.createdByBot)?.depth ?? Number.POSITIVE_INFINITY;
}

/** The mark a bot made by `creator` carries. */
export function createdByBotMark(creator: { id: string; createdByBot?: unknown }, now: number): BotCreatedBy {
  const depth = botCreationDepth(creator);
  return { botId: creator.id, depth: Number.isFinite(depth) ? depth + 1 : BOT_CREATION_MAX_DEPTH + 1, at: now };
}

/** Bots made by bots for this person since `now - BOT_CREATION_WINDOW_MS`. */
export function recentBotCreations(
  bots: ReadonlyArray<{ createdByBot?: unknown }>,
  sameOwner: (bot: { createdByBot?: unknown }) => boolean,
  now: number,
): number {
  let count = 0;
  for (const bot of bots) {
    const mark = bot.createdByBot === undefined ? null : cleanBotCreatedBy(bot.createdByBot);
    if (mark && now - mark.at < BOT_CREATION_WINDOW_MS && sameOwner(bot)) count += 1;
  }
  return count;
}

/** Whether create_bot is offered to a bot that is not a Primary Bot: what
 * the bot itself is, before any turn. The route checks everything again. */
export function botCreationOffered(bot: { chiefOfStaff?: boolean; hidden?: boolean; temporary?: unknown; createdByBot?: unknown }, ownerReadOnly: boolean): boolean {
  if (bot.chiefOfStaff === true) return false;
  return !bot.hidden && bot.temporary === undefined && !ownerReadOnly && botCreationDepth(bot) < BOT_CREATION_MAX_DEPTH;
}

export type BotCreationCode = "temporary_agent" | "too_deep" | "not_owner_turn" | "suggestion_primary_only" | "permission_missing" | "rate_limited";
export interface BotCreationRefusal { status: 403 | 409 | 429; code: BotCreationCode; error: string }

/** Why a bot that is not a Primary Bot may not create a bot now, or null.
 * A Primary Bot is not judged here: its path is unchanged. */
export function botCreationRefusal(input: {
  temporary: boolean;
  depth: number;
  /** "owner" only when the bot's owner wrote this turn's request themselves. */
  turnOrigin: "owner" | "other";
  suggestion: boolean;
  /** A working folder was named. */
  cwd: boolean;
  /** The owner may choose a bot's working folder. */
  cwdAllowed: boolean;
  /** Bots made by bots for this owner in the last hour. */
  recent: number;
}): BotCreationRefusal | null {
  if (input.temporary) {
    return { status: 409, code: "temporary_agent", error: "A temporary agent cannot create bots. Do the work here, or ask the bot that created you." };
  }
  if (!(input.depth < BOT_CREATION_MAX_DEPTH)) {
    return { status: 409, code: "too_deep", error: "A bot that another bot created cannot create bots. Do the work here, or ask the person to create the bot or make you their Primary Bot." };
  }
  if (input.turnOrigin !== "owner") {
    return { status: 403, code: "not_owner_turn", error: "Only your owner's own request can create a bot: not another bot, a routine, a webhook, an email, another person or a session acting for someone else. Tell the person what bot you would create and let them ask you." };
  }
  if (input.suggestion) {
    return { status: 403, code: "suggestion_primary_only", error: "Only a Primary Bot suggests a specialist nobody asked for. Create a bot only when the person asks for one." };
  }
  if (input.cwd && !input.cwdAllowed) {
    return { status: 403, code: "permission_missing", error: "Your owner may not choose a bot's working folder. Leave cwd out: the new bot works in its private workspace." };
  }
  if (input.recent >= BOT_CREATIONS_PER_HOUR) {
    return { status: 429, code: "rate_limited", error: `Bots have created ${BOT_CREATIONS_PER_HOUR} bots for this person in the last hour. Use the team you have, or ask the person to create more.` };
  }
  return null;
}
