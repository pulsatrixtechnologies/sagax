// GET /api/bots/:id/team-work?since=<the reader's local midnight>: the work
// an orchestrator bot runs through its team, for the Coding section of its
// panel (#3461, lot 1 of #3451; shared/team-work.ts). Read only. Built by
// server/team-work/team-work.ts with the reader's rights: a bot the reader
// cannot see reads as no bot, and inside, a step is listed only when the
// reader may read its thread and the conversation it was handed out from.
//
// POST /api/bots/:id/team-work/clear?since=… { keys?: string[], finished?: true }
// (#4421): the person clears rows of that list themselves, no administrator
// and no approval: each named row, or every row nothing runs in any more
// ("Clear finished"). Only the rows this reader reads are touched (the same
// read); each of their hand-overs carries the end, so the row leaves the
// list until a new step of the same work is handed out. Answers the list.
import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamWork, TeamWorkClear } from "../../shared/team-work.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotTeamWorkRouteDeps {
  /** The bot, only when this reader may see it. */
  bot(id: string, auth: RequestAuth): { id: string } | null | undefined;
  /** Who is asking (channelFilterViewerId): undefined for the operator or a solo server. */
  viewerId(auth: RequestAuth): string | undefined;
  read(botId: string, viewerId: string | undefined, since: number): TeamWork;
  /** Clear rows of that reader's list (#4421); answers how many hand-overs took the end. */
  clear?(botId: string, viewerId: string | undefined, since: number, clear: TeamWorkClear): number;
  now?: () => number;
}

/** The clear the body asks for; null when it names nothing. */
export function teamWorkClearBody(body: unknown): TeamWorkClear | null {
  const record = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const keys = Array.isArray(record.keys) ? record.keys.filter((key): key is string => typeof key === "string" && key.length > 0 && key.length <= 512).slice(0, 200) : [];
  const finished = record.finished === true;
  if (!keys.length && !finished) return null;
  return { ...(keys.length ? { keys } : {}), ...(finished ? { finished: true } : {}) };
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
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const clearing = path.match(/^\/api\/bots\/([\w-]+)\/team-work\/clear$/);
    if (clearing) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      res.setHeader("cache-control", "private, no-store");
      const bot = deps.bot(clearing[1]!, auth);
      if (!bot || !deps.clear) return json(res, 404, { error: "no such bot" });
      const clear = teamWorkClearBody(await readBody(req, 64_000));
      if (!clear) return json(res, 400, { error: "name the rows to clear (keys) or clear the finished ones (finished: true)" });
      const viewerId = deps.viewerId(auth);
      const since = teamWorkSince(url.searchParams.get("since"), now());
      deps.clear(bot.id, viewerId, since, clear);
      return json(res, 200, deps.read(bot.id, viewerId, since));
    }
    const match = path.match(/^\/api\/bots\/([\w-]+)\/team-work$/);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    res.setHeader("cache-control", "private, no-store");
    const bot = deps.bot(match[1]!, auth);
    if (!bot) return json(res, 404, { error: "no such bot" });
    return json(res, 200, deps.read(bot.id, deps.viewerId(auth), teamWorkSince(url.searchParams.get("since"), now())));
  };
}
