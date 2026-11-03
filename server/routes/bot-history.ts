// A bot's profile history and the undo of a SOUL.md change:
//
//   GET  /api/bots/:id/history?limit=&full=1   { rows, revision }
//   POST /api/bots/:id/history/rollback        { id, expectedRevision } -> { bot }
//
// 2026-10-26 (#1107): a member reads and undoes the history of their own
// bots. request-auth.ts lets a session through; the owner rule is here.
import { parseBotProfilePatch } from "../bot-profile.ts";
import { profileRevision, profileSnapshot } from "../profile-revision.ts";
import { flushProfileHistory, readHistory, recordProfileChange } from "../profile-versions.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

type HistoryBot = Parameters<typeof profileRevision>[0] & Parameters<typeof profileSnapshot>[0] & { id: string };

export interface BotHistoryRouteDeps<B extends HistoryBot, W> {
  bot: (id: string) => B | undefined;
  /** The bot's owner or an admin (or the owner at this computer). */
  mayManage: (auth: RequestAuth, bot: B) => boolean;
  setSoul: (id: string, soul: string) => B | undefined;
  wireBot: (bot: B) => W;
  broadcast: (event: { kind: "bot"; bot: W }) => void;
}

const ROUTE = /^\/api\/bots\/([\w-]+)\/history(\/rollback)?$/;

export function createBotHistoryRoutes<B extends HistoryBot, W>(deps: BotHistoryRouteDeps<B, W>): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    const m = ROUTE.exec(path);
    if (!m) return PASS;
    const rollback = m[2] !== undefined;
    if (method !== "GET" && method !== "POST") return PASS;
    const botId = m[1]!;
    const known = deps.bot(botId);
    if (known && !deps.mayManage(auth, known)) {
      return json(res, 403, { error: "forbidden: only the bot owner or an admin can read or undo its history", code: "bot_history_owner_only" });
    }
    if (!rollback && method === "GET") {
      if (!known) return json(res, 404, { error: "no such bot" });
      // Writes queue in profile-versions.ts and land asynchronously; a client
      // reading history right after causing a change must see its own row.
      await flushProfileHistory(botId);
      const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
      // A soul row's full before/after can be the entire standing
      // instructions (up to 24,000 bytes), fine for a rollback, which
      // reads the file server-side, but not for a client that only asked
      // to see what changed. Strip the bodies (keep the byte-count
      // summary) unless the caller explicitly wants them.
      const full = url.searchParams.get("full") === "1";
      const rows = readHistory(botId, limit).map((row) => {
        if (full || row.field !== "soul") return row;
        const rest: typeof row = { ...row };
        delete rest.before;
        delete rest.after;
        return rest;
      });
      const bot = deps.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      return json(res, 200, { rows, revision: profileRevision(bot) });
    }
    if (rollback && method === "POST") {
      const body = await readBody(req);
      // Same flush as the GET route: the row this rollback targets may have
      // been recorded moments ago and not yet reached disk.
      await flushProfileHistory(botId);
      const bot = deps.bot(botId);
      if (!bot) return json(res, 404, { error: "no such bot" });
      if (body?.expectedRevision !== profileRevision(bot)) {
        return json(res, 409, { error: "This bot's profile changed; reload history before undoing" });
      }
      const row = typeof body?.id === "string"
        ? readHistory(bot.id, Number.MAX_SAFE_INTEGER).find((r) => r.id === body.id && r.field === "soul")
        : undefined;
      if (!row || row.field !== "soul" || typeof row.before !== "string") {
        return json(res, 400, { error: "rollback is available for SOUL.md entries only" });
      }
      if (!row.canRestore) {
        return json(res, 400, { error: row.restoreUnavailableReason });
      }
      const parsed = parseBotProfilePatch({ soul: row.before });
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      const before = profileSnapshot(bot);
      const updated = deps.setSoul(bot.id, parsed.patch.soul ?? "");
      if (!updated) return json(res, 404, { error: "no such bot" });
      recordProfileChange(bot.id, "user", "rollback", before, profileSnapshot(updated));
      const visible = deps.wireBot(updated);
      deps.broadcast({ kind: "bot", bot: visible });
      return json(res, 200, { bot: visible });
    }
    // Any other method on these paths falls through to index.ts exactly as before.
    return PASS;
  };
}
