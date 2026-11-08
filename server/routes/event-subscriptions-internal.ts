// POST /api/internal/event-subscriptions: the event_subscriptions tool (#2700).
// A bot lists, creates, tests and deletes its own outbound event
// subscriptions (server/bot-events/bot-event-subscriptions.ts) from its
// conversation, the same store as GET/POST/DELETE
// /api/bots/:id/event-subscriptions in its settings.
//
// The bot acts for the person it speaks for: a subscription is theirs
// (ownerId), and a routine target is a routine of this bot or of another
// bot of the same owner. Behind the agents capability (internal-route.ts).
import {
  BOT_EVENT_TYPES,
  isBotEventType,
  validBotEventUrl,
  type BotEventTarget,
  type BotEventType,
} from "../../shared/bot-event-subscriptions.ts";
import type { BotEventSubscriptions, SubscriptionRoutine } from "../bot-events/bot-event-subscriptions.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface EventSubscriptionsInternalDeps {
  /** The source conversation belongs to the calling bot. */
  ownsThread(botId: string, threadId: string): boolean;
  /** The person this turn speaks for, if any. */
  speaker(threadId: string): string | undefined;
  /** The bot's owner, the subscription's owner when nobody speaks. */
  botOwner(botId: string): string | undefined;
  routine(id: string): SubscriptionRoutine | undefined;
  store: Pick<BotEventSubscriptions, "list" | "create" | "remove" | "test" | "get">;
  /** Throws when the URL must not be called from this server. */
  checkDestination?: (url: URL) => Promise<void>;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

export function createEventSubscriptionsInternalRoutes(deps: EventSubscriptionsInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/event-subscriptions")) return PASS;
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    const botId = capability.botId;
    const body = await readBody();
    const action = text(body.action) || "list";

    if (action === "list") return json(res, 200, { subscriptions: deps.store.list(botId), events: BOT_EVENT_TYPES });

    if (action === "delete" || action === "test") {
      const id = text(body.subscriptionId);
      if (!id) return json(res, 400, { error: `${action} needs subscription_id (from action list).` });
      if (action === "delete") {
        if (!deps.store.remove(botId, id)) return json(res, 404, { error: "subscription not found on this bot" });
        return json(res, 200, { ok: true, deleted: id });
      }
      const delivery = await deps.store.test(botId, id);
      if (!delivery) return json(res, 404, { error: "subscription not found on this bot" });
      return json(res, 200, { delivery, subscription: deps.store.get(botId, id) });
    }

    if (action !== "create") return json(res, 400, { error: "action is list, create, test or delete." });
    const events = Array.isArray(body.events) ? (body.events.filter(isBotEventType) as BotEventType[]) : [];
    if (events.length === 0) return json(res, 400, { error: `choose at least one event: ${BOT_EVENT_TYPES.join(", ")}` });
    const owner = deps.speaker(capability.threadId)?.trim() || deps.botOwner(botId)?.trim() || "local";
    let target: BotEventTarget;
    const rawUrl = text(body.url);
    const routineId = text(body.routineId);
    if (Boolean(rawUrl) === Boolean(routineId)) {
      return json(res, 400, { error: "give exactly one target: url (a webhook) or routine_id (a routine that runs on each event)." });
    }
    if (rawUrl) {
      const url = validBotEventUrl(rawUrl);
      if (!url) return json(res, 400, { error: "enter an http or https URL" });
      try {
        await deps.checkDestination?.(url);
      } catch {
        return json(res, 400, { error: "this server cannot send to a private or local address" });
      }
      target = { kind: "url", url: url.toString() };
    } else {
      const routine = deps.routine(routineId);
      // a routine of this bot, or of another bot of the same owner
      const reachable = routine && (routine.botId === botId
        || (deps.botOwner(routine.botId) ?? "") === (deps.botOwner(botId) ?? "-"));
      if (!routine || !reachable) return json(res, 404, { error: "routine not found (list_routines gives its id)" });
      target = { kind: "routine", botId: routine.botId, routineId: routine.id };
    }
    try {
      return json(res, 201, deps.store.create({ botId, ownerId: owner, events, target }));
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return json(res, status, { error: error instanceof Error ? error.message : "could not subscribe" });
    }
  };
}
