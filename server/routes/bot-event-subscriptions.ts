// #2700: a bot's outbound event subscriptions (server/bot-events/bot-event-subscriptions.ts).
//   GET    /api/bots/:id/event-subscriptions             list (never a secret)
//   POST   /api/bots/:id/event-subscriptions             { events, target } -> { subscription, secret }
//   DELETE /api/bots/:id/event-subscriptions/:subId
//   POST   /api/bots/:id/event-subscriptions/:subId/test  send a ping now
//
// Access: the bot's owner, a manage or edit grant holder or an org admin
// (seesAll), the same as its webhooks; anyone else gets 404. A routine target
// needs the same on the routine's bot.
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  isBotEventType,
  validBotEventUrl,
  type BotEventTarget,
  type BotEventType,
} from "../../shared/bot-event-subscriptions.ts";
import type { BotEventSubscriptions, SubscriptionRoutine } from "../bot-events/bot-event-subscriptions.ts";
import { PASS, type RouteHandler } from "./table.ts";

const LIST = /^\/api\/bots\/([\w-]+)\/event-subscriptions$/;
const ONE = /^\/api\/bots\/([\w-]+)\/event-subscriptions\/([\w-]+)(\/test)?$/;

export interface BotEventSubscriptionRouteDeps<B extends { id: string }> {
  bot: (id: string) => B | undefined;
  sees: (auth: RequestAuth, bot: B) => boolean;
  seesAll: (auth: RequestAuth, bot: B) => boolean;
  ownerId: (auth: RequestAuth) => string;
  routine: (id: string) => SubscriptionRoutine | undefined;
  store: Pick<BotEventSubscriptions, "list" | "create" | "remove" | "test" | "get">;
  /** Throws when the URL must not be called from this server. */
  checkDestination?: (url: URL) => Promise<void>;
}

export function createBotEventSubscriptionRoutes<B extends { id: string }>(deps: BotEventSubscriptionRouteDeps<B>): RouteHandler {
  const allowed = (auth: RequestAuth, id: string): B | undefined => {
    const bot = deps.bot(id);
    return bot && deps.sees(auth, bot) && deps.seesAll(auth, bot) ? bot : undefined;
  };
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const list = LIST.exec(path);
    const one = list ? null : ONE.exec(path);
    if (!list && !one) return PASS;
    const bot = allowed(auth, (list ?? one)![1]!);
    if (!bot) return json(res, 404, { error: "bot not found" });

    if (list) {
      if (method === "GET") return json(res, 200, { subscriptions: deps.store.list(bot.id) });
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const body = (await readBody(req).catch(() => null)) as { events?: unknown; target?: unknown } | null;
      const events = Array.isArray(body?.events) ? body!.events.filter(isBotEventType) as BotEventType[] : [];
      if (events.length === 0) return json(res, 400, { error: "choose at least one event" });
      const raw = body?.target as { kind?: unknown; url?: unknown; routineId?: unknown } | undefined;
      let target: BotEventTarget;
      if (raw?.kind === "url" && typeof raw.url === "string") {
        const url = validBotEventUrl(raw.url);
        if (!url) return json(res, 400, { error: "enter an http or https URL" });
        try {
          await deps.checkDestination?.(url);
        } catch {
          return json(res, 400, { error: "this server cannot send to a private or local address" });
        }
        target = { kind: "url", url: url.toString() };
      } else if (raw?.kind === "routine" && typeof raw.routineId === "string") {
        const routine = deps.routine(raw.routineId);
        const routineBot = routine ? allowed(auth, routine.botId) : undefined;
        if (!routine || !routineBot) return json(res, 400, { error: "routine not found" });
        target = { kind: "routine", botId: routine.botId, routineId: routine.id };
      } else {
        return json(res, 400, { error: "target must be a URL or a routine" });
      }
      try {
        return json(res, 201, deps.store.create({ botId: bot.id, ownerId: deps.ownerId(auth), events, target }));
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return json(res, status, { error: error instanceof Error ? error.message : "could not subscribe" });
      }
    }

    const subId = one![2]!;
    if (one![3]) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const delivery = await deps.store.test(bot.id, subId);
      if (!delivery) return json(res, 404, { error: "subscription not found" });
      return json(res, 200, { delivery, subscription: deps.store.get(bot.id, subId) });
    }
    if (method !== "DELETE") return json(res, 405, { error: "method not allowed" });
    if (!deps.store.remove(bot.id, subId)) return json(res, 404, { error: "subscription not found" });
    return json(res, 200, { ok: true });
  };
}
