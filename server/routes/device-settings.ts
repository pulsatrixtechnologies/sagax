// Device settings over HTTP (#1545, server/device-settings.ts):
//   GET  /api/me/device-settings/requests       the requests waiting on this person's open apps
//   POST /api/me/device-settings/requests/:id   { device, value? | unsupported | error }  one app's answer
//   POST /api/me/device-settings/apply          { op: get | set, key, value?, botName? }
//        what sagax_settings replays with the person's session (act refuses
//        it to a bot's own `act` call): asks the person's open apps and waits
//        for the first answer, a few seconds at most
//
// The person's own app only: never a bot (its act replay, a short-lived
// session copy, a service loopback), never another person. A bot asks
// through sagax_settings (server/settings-actions.ts), which waits for the
// answer inside its own turn.
import type { IncomingMessage } from "node:http";

import { z } from "zod";

import { DEVICE_NO_APP, DEVICE_TIMEOUT, DEVICE_UNSUPPORTED, deviceAnswerSchema } from "../../shared/device-settings.ts";
import type { DeviceSettingsBroker } from "../device-settings.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const applyBody = z.object({
  op: z.enum(["get", "set"]),
  key: z.string().min(1).max(128),
  value: z.string().max(16_000).optional(),
  botName: z.string().max(120).optional(),
}).strict();

const REQUEST_PATH = /^\/api\/me\/device-settings\/requests\/([\w-]{1,64})$/;

export interface DeviceSettingRouteDeps {
  broker(): DeviceSettingsBroker;
  /** The person's own app behind this request: the person and a stable id
   * for this app (its session), or null for a bot, a service or anyone who
   * is not a person. */
  app(req: IncomingMessage, auth: RequestAuth): { person: string; appId: string } | null;
  /** The person a read or change is for (their own session, a bot's act
   * replay of it included), or null. */
  person(auth: RequestAuth): string | null;
  /** A key the channel carries (DEVICE_REQUEST_KEYS). */
  isKey(key: string): boolean;
  /** No app open: a preference the server keeps for the person (organization
   * server) is saved there, so their apps take it when they open; false when
   * the server does not keep that key. */
  saveSynced?(person: string, key: string, value: string): boolean;
  waitMs?: number;
}

export function createDeviceSettingRoutes(deps: DeviceSettingRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // literal paths, so scripts/tool-policy reads them
    if (path !== "/api/me/device-settings/requests" && path !== "/api/me/device-settings/apply" && !REQUEST_PATH.test(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (path === "/api/me/device-settings/apply") {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      const person = deps.person(auth);
      if (!person) return json(res, 403, { error: "This request is not tied to a signed-in person." });
      const parsed = applyBody.safeParse(await readBody(req, 64_000));
      if (!parsed.success || (parsed.data.op === "set" && parsed.data.value === undefined)) return json(res, 400, { error: "send { op: get | set, key, value? }" });
      const { op, key, value, botName } = parsed.data;
      if (!deps.isKey(key)) return json(res, 400, { error: "That setting is not kept on the person's device." });
      const outcome = await deps.broker().ask(person, { op, key, ...(value !== undefined ? { value } : {}), botName: botName ?? "Sagax" }, deps.waitMs);
      if (outcome.status === "done") return json(res, 200, { key, value: outcome.value, device: outcome.device });
      if (outcome.status === "no-app" && op === "set" && value !== undefined && deps.saveSynced?.(person, key, value)) return json(res, 200, { key, value, device: "server" });
      if (outcome.status === "no-app") return json(res, 409, { error: DEVICE_NO_APP, code: "no_app" });
      if (outcome.status === "unsupported") return json(res, 422, { error: DEVICE_UNSUPPORTED, code: "unsupported" });
      if (outcome.status === "timeout") return json(res, 504, { error: DEVICE_TIMEOUT, code: "timeout" });
      return json(res, 400, { error: `The person's ${outcome.device === "ios" ? "iPhone" : outcome.device} app could not: ${outcome.error}`, code: "failed" });
    }
    const app = deps.app(req, auth);
    if (!app) return json(res, 403, { error: "Only the person's own Sagax app answers device settings.", code: "app_required" });
    if (path === "/api/me/device-settings/requests") {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      return json(res, 200, { requests: deps.broker().pendingFor(app.person, app.appId) });
    }
    const match = REQUEST_PATH.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "POST" });
    const parsed = deviceAnswerSchema.safeParse(await readBody(req, 64_000));
    if (!parsed.success) return json(res, 400, { error: "send { device: desktop | ios | web, value?, unsupported?, error? }" });
    const outcome = deps.broker().answer(app.person, app.appId, match[1]!, parsed.data);
    if (!outcome.ok) return json(res, outcome.status, { error: outcome.error });
    return json(res, 200, { ok: true });
  };
}
