// sidebarListedBots (extracted from Sidebar.tsx, #1383).
import type { Bot, Group } from "@/state/store";

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

/** #2045: on an organization server (a group carries `ownerId`) a room filed
 * in a team that is not one of the viewer's own teams sits in Unassigned:
 * another person's team name never shows in this sidebar. A solo server sends
 * no `ownerId`, and its rooms keep their section as they are. */
export function sidebarListedGroups(groups: Group[], sections: readonly string[]): Group[] {
  return groups.map((group) => (group.ownerId !== undefined && group.section && !sections.includes(group.section) ? { ...group, section: undefined } : group));
}
