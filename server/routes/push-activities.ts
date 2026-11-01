// Live Activity push tokens (server/push/activity-devices.ts):
//
//   POST   /api/push/activities  register an ActivityKit update token
//                                (botId required) or a push-to-start token
//                                (kind: "start", iOS 17.2+)
//   DELETE /api/push/activities  { token }  forget one token
//   GET    /api/push/activities  this person's tokens, masked
//
// A person only ever reads or changes their own tokens.
import { z } from "zod";

import { apnsEnvironment, maskSecret, type ApnsEnvironment } from "../push/config.ts";
import {
  ACTIVITY_TOKEN,
  activityRegistrationSchema,
  type LiveActivityToken,
  type LiveActivityTokenStore,
} from "../push/activity-devices.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const PUSH_ACTIVITIES_PATH = "/api/push/activities";

export interface PushActivityRouteDeps {
  person(auth: RequestAuth): string | undefined;
  store: LiveActivityTokenStore;
  configured(): boolean;
  defaultEnvironment(): ApnsEnvironment;
}

const removeBody = z.object({
  token: z.string().trim().toLowerCase().regex(ACTIVITY_TOKEN),
}).strict();

const publicToken = (entry: LiveActivityToken) => ({
  token: maskSecret(entry.token),
  kind: entry.kind,
  environment: entry.environment,
  ...(entry.botId ? { botId: entry.botId } : {}),
  ...(entry.activityId ? { activityId: entry.activityId } : {}),
  ...(entry.frequentUpdates !== undefined ? { frequentUpdates: entry.frequentUpdates } : {}),
  appVersion: entry.appVersion,
  deviceName: entry.deviceName,
  updatedAt: entry.updatedAt,
});

export function createPushActivityRoutes(deps: PushActivityRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PUSH_ACTIVITIES_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    const person = deps.person(auth);
    if (!person) {
      return json(res, 403, {
        error: "Only a signed-in person registers a Live Activity push token.",
        code: "session_required",
      });
    }
    if (method === "GET") {
      return json(res, 200, {
        configured: deps.configured(),
        tokens: deps.store.list(person).map(publicToken),
      });
    }
    if (method === "POST") {
      const body = await readBody(req);
      const parsed = activityRegistrationSchema.safeParse(body);
      if (!parsed.success) {
        return json(res, 400, {
          error: "send { token (hex), kind?: \"update\" | \"start\", botId (required for update), activityId?, environment?, deviceToken?, frequentUpdates?, appVersion?, deviceName? }",
        });
      }
      const environment = parsed.data.environment ?? apnsEnvironment(undefined, deps.defaultEnvironment());
      const entry = deps.store.register(person, { ...parsed.data, environment });
      return json(res, 200, { ok: true, configured: deps.configured(), token: publicToken(entry) });
    }
    if (method === "DELETE") {
      const body = await readBody(req);
      const parsed = removeBody.safeParse(body);
      if (!parsed.success) return json(res, 400, { error: "send { token }" });
      return json(res, 200, { ok: true, removed: deps.store.remove(person, parsed.data.token) });
    }
    return json(res, 405, { error: "GET, POST or DELETE" });
  };
}
