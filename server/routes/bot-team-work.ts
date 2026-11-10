// GET /api/bots/:id/team-work?since=<the reader's local midnight>: the work
// an orchestrator bot runs through its team, for the Coding section of its
// panel (#3461, lot 1 of #3451; shared/team-work.ts). Read only. Built by
// server/team-work/team-work.ts with the reader's rights: a bot the reader
// cannot see reads as no bot, and inside, a step is listed only when the
// reader may read its thread and the conversation it was handed out from.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamWork } from "../../shared/team-work.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotTeamWorkRouteDeps {
  /** The bot, only when this reader may see it. */
  bot(id: string, auth: RequestAuth): { id: string } | null | undefined;
  /** Who is asking (channelFilterViewerId): undefined for the operator or a solo server. */
  viewerId(auth: RequestAuth): string | undefined;
  read(botId: string, viewerId: string | undefined, since: number): TeamWork;
  now?: () => number;
}

const DAY_MS = 24 * 60 * 60_000;

/** The reader's midnight as the client sent it; absent or out of range,
 * the last 24 hours. */
export function teamWorkSince(raw: string | null, now: number): number {
  const since = Number(raw);
  return raw !== null && raw.trim() !== "" && Number.isFinite(since) && since <= now && since >= now - 2 * DAY_MS ? since : now - DAY_MS;
}

export function createBotTeamWorkRoutes(deps: BotTeamWorkRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ res, url, path, method, auth, json }) => {
    const match = path.match(/^\/api\/bots\/([\w-]+)\/team-work$/);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "private, no-store");
    const bot = deps.bot(match[1]!, auth);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, deps.read(bot.id, deps.viewerId(auth), teamWorkSince(url.searchParams.get("since"), now())));
  };
}
