// Bot ownership helpers shared by the route slices that leave server/index.ts
// (#1388). Pass the local operator id explicitly so this leaf never reaches
// for principals or index.ts.
import { ownerUserIdForPlacement } from "./channel-membership.ts";

/** The owner id recorded on the bot, lowercased, or undefined when absent. */
export function recordedBotOwner(bot: { ownerUserId?: unknown }): string | undefined {
  return typeof bot.ownerUserId === "string" && bot.ownerUserId.trim()
    ? bot.ownerUserId.trim().toLowerCase()
    : undefined;
}

/** Who owns the bot for placement and access: a recorded owner, else the
 * local operator at this computer. */
export function effectiveBotOwner(
  bot: { ownerUserId?: unknown },
  localOperatorId: string,
): string {
  return ownerUserIdForPlacement({
    recordedOwnerUserId: recordedBotOwner(bot),
    localOperatorId,
  });
}
