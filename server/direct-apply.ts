// Which of a bot's proposed changes apply without a person. One rule for
// routines, skills, profile and default model, on the desktop, a server and
// a Cloud home alike:
// - Full access applies everything it always has, with no new limits;
// - at any other level a bot's change to ITSELF, or to another bot of the
//   same person, applies directly (routines, skills, profile, model), and
//   the person sees a one-line receipt with Undo. A change for a bot of
//   another person keeps its card.
// The one exception is a Cloud home's guest-driven turn, which keeps today's
// card for everything (`blocked`). Team setup about the person's own bots
// applies at Full access and at Approve for me on their own turn
// (teamSetupDirectSource, 2026-10-26); peer approvals keep their card.
// Team memory keeps its card (Sagax choice, omb #3014 adapted).

/** Why a change applied without a person. Also the decision log's source. */
/** "primary-bot" (2026-10-20): the person asked their own Primary Bot for
 * this change in this turn's message; it applies like Full access.
 * "level" (omb #3014): any non-Full level that still applies without a card. */
export type DirectApply = "full-access" | "self" | "primary-bot" | "level";

/** Server-owned and decided per request, never from request input. */
export type DirectApplyCheck = (botId: string, threadId: string, targetBotId: string) => DirectApply | null;

/** What Undo says, applying nothing, once the thing changed since. */
export const UNDO_STALE = "Changed since, so it can't be undone here.";

/** Null only where the owner confirms on a card (a guest turn, or a rule that
 * still asks). Full access reports as "full-access"; every other allowed
 * level reports as "level". */
export function appliesNow(args: { fullAccess: boolean; ownerMustConfirm: boolean }): DirectApply | null {
  if (args.ownerMustConfirm) return null;
  return args.fullAccess ? "full-access" : "level";
}

/** 2026-11-08 (owner decision: no confirmation card while the bot runs at
 * Full access): a quote that did not prove the person's ask
 * takes back the quote's own fast path and the bot's self grant, never Full
 * access. Under Full the person already authorized the work in their own
 * environment; a refused quote is journaled, not turned into a card. */
export function grantAfterQuote(grant: DirectApply | null, quoteRefused: boolean | undefined): DirectApply | null {
  if (!quoteRefused) return grant;
  return grant === "full-access" ? grant : null;
}

/** #2610 + 2026-11-08: a new skill the automatic review draws from a
 * finished task is a card for the person, except under Full access, where it
 * applies with its receipt and Undo like every other change of the bot's own. */
export function reviewedSkillNeedsCard(action: "create" | "update", grant: DirectApply | null): boolean {
  return action === "create" && grant !== "full-access";
}

/** A bot applying its own routines directly keeps at most this many
 * enabled; past it, a create or resume shows today's card instead. */
export const SELF_ROUTINE_CAP = 20;

/** The person a bot belongs to, normalized; undefined or empty when the
 * bot is unknown or has no owner on record. */
export type BotOwnerOf = (botId: string) => string | undefined;

/** Whether `targetBotId` is the requesting bot itself or another bot of the
 * same person. An unknown or ownerless side never matches, so a bot of
 * another person (or one nobody owns) keeps its card. */
export function samePersonBot(botId: string, targetBotId: string, ownerOf?: BotOwnerOf): boolean {
  if (targetBotId === botId) return true;
  if (!ownerOf) return false;
  const owner = ownerOf(botId)?.trim().toLowerCase();
  const targetOwner = ownerOf(targetBotId)?.trim().toLowerCase();
  return !!owner && owner === targetOwner;
}

export function directApply(args: {
  fullAccess: boolean;
  botId: string;
  targetBotId: string;
  blocked: boolean;
  /** Owner lookup: with it, a change to another bot of the same person
   * applies as "self". Without it only the bot itself does. */
  ownerOf?: BotOwnerOf;
}): DirectApply | null {
  if (args.fullAccess) return "full-access";
  if (args.blocked) return null;
  return samePersonBot(args.botId, args.targetBotId, args.ownerOf) ? "self" : null;
}
