// GET  /api/me/usage-meter          { enabled, count }
// PUT  /api/me/usage-meter          { enabled: boolean }  the person's own switch
// POST /api/me/usage-meter/events   { name, props }       refused while the switch is off
//
// No admin right. Nothing is sent anywhere but this server, and an event
// has no person name (shared/usage-meter.ts).
import type { RequestAuth } from "../auth/request-auth.ts";
import { usageEvent } from "../../shared/usage-meter.ts";
import type { UsageMeter, UsageMeterScope } from "../usage/usage-meter.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PATH = "/api/me/usage-meter";
const EVENTS = `${PATH}/events`;

export function createUsageMeterRoutes(deps: {
  meter: UsageMeter;
  scope(auth: RequestAuth): UsageMeterScope | null;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== PATH && path !== EVENTS) return PASS;
    res.setHeader("cache-control", "no-store");
    const scope = deps.scope(auth);
    if (!scope) return json(res, 401, { error: "Usage measure belongs to one person: sign in first." });
    if (path === EVENTS) {
      if (method !== "POST") return PASS;
      const body = await readBody(req);
      const name = body && typeof body === "object" ? (body as { name?: unknown }).name : undefined;
      const props = body && typeof body === "object" ? (body as { props?: unknown }).props : undefined;
      if (!usageEvent(name, props)) return json(res, 400, { error: "That event is not in the usage schema." });
      if (!deps.meter.record(scope, name, props)) {
        return json(res, 409, { error: "Usage measure is off until you turn it on." });
      }
      return json(res, 202, { ok: true });
    }
    if (method === "GET") return json(res, 200, deps.meter.read(scope));
    if (method === "PUT") {
      const body = await readBody(req);
      const enabled = body && typeof body === "object" ? (body as { enabled?: unknown }).enabled : undefined;
      if (typeof enabled !== "boolean") return json(res, 400, { error: "enabled must be true or false" });
      return json(res, 200, deps.meter.setEnabled(scope, enabled));
    }
    return PASS;
  };
}
