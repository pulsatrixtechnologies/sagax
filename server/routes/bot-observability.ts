import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord, Store } from "../store.ts";
import type { OutboundCounts } from "../outbound/outbound-counts.ts";
import { readBotActivity } from "../activity/activity.ts";
import { DEFAULT_OUTBOUND_POLICY } from "../../shared/outbound.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface BotObservabilityRouteDeps {
  store: Pick<Store, "bot" | "tasks">;
  DATA_DIR: string;
  EVENTS_DIR: string;
  ownerOrAdminOf: (auth: RequestAuth, bot: BotRecord) => boolean;
  computerOwner: (auth: RequestAuth) => boolean;
  outboundCounts: Pick<OutboundCounts, "today">;
}

export function createBotObservabilityRoutes(deps: BotObservabilityRouteDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    const { store, DATA_DIR, EVENTS_DIR, ownerOrAdminOf, computerOwner, outboundCounts } = deps;
    // ── a bot's activity: what it did, with the outcome ──
    // Read-only over the same two logs as the inspector and the decision
    // route above. The bot's own threads (its DM and every task) carry the
    // tool runs; the decision log carries the bot's requests wherever they
    // happened, since those rows name the bot.
    const m = path.match(/^\/api\/bots\/([\w-]+)\/activity$/);
    if (m && method === "GET") {
      const bot = store.bot(m[1]);
      if (!bot) {
        json(res, 404, { error: "no such bot" });
        return;
      }
      const rawLimit = url.searchParams.get("limit");
      const parsedLimit = rawLimit === null ? undefined : Number(rawLimit);
      if (parsedLimit !== undefined && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
        json(res, 400, { error: "limit must be a positive whole number" });
        return;
      }
      const threadIds = [...new Set([bot.threadId, ...store.tasks(bot.id).map((task) => task.threadId)])];
      json(res, 200, {
        rows: readBotActivity({ dataDir: DATA_DIR, eventsDir: EVENTS_DIR, botId: bot.id, threadIds, limit: parsedLimit ?? 300 })
      });
      return;
    }

    // ── a bot's outbound allowance: the policy, and how much of it is spent ──
    const outbound = path.match(/^\/api\/bots\/([\w-]+)\/outbound$/);
    if (outbound && method === "GET") {
      const bot = store.bot(outbound[1]);
      if (!bot) {
        json(res, 404, { error: "no such bot" });
        return;
      }
      // #1098: a client session (a member's served app or phone) reads it
      // for a bot it owns or may edit, as it sets the policy (bots.tools).
      if (!ownerOrAdminOf(auth, bot) && !computerOwner(auth)) {
        json(res, 403, { error: "forbidden: only the bot owner or an admin can read its outbound allowance", code: "bot_outbound_owner_only" });
        return;
      }
      json(res, 200, { policy: bot.outbound ?? DEFAULT_OUTBOUND_POLICY, today: outboundCounts.today(bot.id) });
      return;
    }


    return PASS;
  };
}
