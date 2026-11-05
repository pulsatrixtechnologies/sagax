// The Perspicax console's bot sheet (`GET bots/{id}/capabilities`,
// server/org/org-admin-bots.ts): what a bot receives, resolved for the bot's
// OWNER (#2029). A routine of the bot runs as its owner, so their MCP
// servers, Roles, "Me" plugins and the organization's Flow are what the bot
// receives; the console person looking (an admin, a manager in reach) only
// lends their rights: `mayChange` stays theirs, never their own servers.
import type { BotCapabilities } from "../../shared/capabilities.ts";

export type ConsoleBotLevel = "owner" | "manage" | string | null;

export interface ConsoleCapabilitiesViewer {
  /** the principal the list is resolved for (the bot's owner) */
  principal: string;
  /** what the console person could change in Sagax */
  mayChange: boolean;
  /** set when the owner is not the person looking */
  computedFor?: { principalId: string; name: string };
}

export interface ConsoleCapabilitiesDeps<Bot> {
  bot(id: string): Bot | undefined;
  /** effectiveBotOwner */
  owner(bot: Bot): string;
  /** the console person's level on this bot (botLevel), null when none */
  level(looking: string, orgAdmin: boolean, bot: Bot): ConsoleBotLevel;
  /** a person's readable name ("" when unknown), never an id */
  name(principalId: string): string;
  resolve(bot: Bot, viewer: ConsoleCapabilitiesViewer): BotCapabilities | null;
}

export function consoleBotCapabilities<Bot>(
  deps: ConsoleCapabilitiesDeps<Bot>,
  botId: string,
  viewer: { principalId: string; orgAdmin: boolean },
): BotCapabilities | null {
  const bot = deps.bot(botId);
  if (!bot) return null;
  const looking = viewer.principalId.trim().toLowerCase();
  const owner = deps.owner(bot).trim().toLowerCase();
  const level = deps.level(looking, viewer.orgAdmin, bot);
  return deps.resolve(bot, {
    principal: owner,
    mayChange: viewer.orgAdmin || level === "owner" || level === "manage",
    ...(owner !== looking ? { computedFor: { principalId: owner, name: readable(deps.name(owner), owner) } } : {}),
  });
}

/** A name that is the id itself is no name. */
function readable(name: string, id: string): string {
  const trimmed = name.trim();
  return trimmed && trimmed.toLowerCase() !== id ? trimmed : "";
}
