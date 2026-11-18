// The phone's Push to Talk channel (server/push/ptt.ts):
//
//   POST   /api/push/ptt  { token, channelId, botId, environment?, appVersion? }
//                         the ephemeral PTT token of the joined channel and its bot
//   DELETE /api/push/ptt  the person left the channel
//   GET    /api/push/ptt  { channel: { botId, channelId, updatedAt } | null }, token never echoed
import type { RequestAuth } from "../auth/request-auth.ts";
import { apnsEnvironment, type ApnsEnvironment } from "../push/config.ts";
import { pttRegistrationSchema, type PttChannelStore } from "../push/ptt.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PTT_CHANNEL_PATH = "/api/push/ptt";

export interface PttChannelRouteDeps {
  person(auth: RequestAuth): string | undefined;
  store: PttChannelStore;
  /** The person may talk to this bot. */
  mayUseBot(person: string, botId: string): boolean;
  defaultEnvironment(): ApnsEnvironment;
}

export function createPttChannelRoutes(deps: PttChannelRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PTT_CHANNEL_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Only a signed-in person joins a Push to Talk channel.", code: "session_required" });
    if (method === "GET") {
      const channel = deps.store.get(person);
      return json(res, 200, { channel: channel ? { botId: channel.botId, channelId: channel.channelId, updatedAt: channel.updatedAt } : null });
    }
    if (method === "DELETE") return json(res, 200, { ok: true, removed: deps.store.remove(person) });
    if (method !== "POST") return json(res, 405, { error: "POST, GET or DELETE" });
    const parsed = pttRegistrationSchema.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "send { token (hex), channelId (uuid), botId, environment?, appVersion? }" });
    if (!deps.mayUseBot(person, parsed.data.botId)) return json(res, 403, { error: "That bot is not one of yours to talk to." });
    const environment = parsed.data.environment ?? apnsEnvironment(undefined, deps.defaultEnvironment());
    deps.store.set(person, { token: parsed.data.token, channelId: parsed.data.channelId, botId: parsed.data.botId, environment, appVersion: parsed.data.appVersion });
    return json(res, 200, { ok: true });
  };
}
