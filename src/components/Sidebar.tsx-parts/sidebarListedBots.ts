// sidebarListedBots (extracted from Sidebar.tsx, #1383).
import type { Bot } from "@/state/store";

function isExternalBot(bot: Bot, viewerId: string): boolean {
  const owner = bot.ownerUserId?.trim().toLowerCase();
  if (!owner || owner === "local-owner") return false;
  return owner !== viewerId.trim().toLowerCase();
}

/** The bots the sidebar lists. On a shared workspace a bot someone else
 * owns reaches you only through a room, so it stays out of the list. In an
 * organization the server lists only bots you may open (yours and the ones
 * shared with you), so all of them show; a shared bot filed in a section of
 * its owner that you do not see goes to Unassigned. */
export function sidebarListedBots(bots: Bot[], viewerId: string, orgMode: boolean, sections: readonly string[] = []): Bot[] {
  if (!orgMode) return bots.filter((bot) => !isExternalBot(bot, viewerId));
  return bots.map((bot) => (isExternalBot(bot, viewerId) && bot.section && !sections.includes(bot.section) ? { ...bot, section: undefined } : bot));
}
