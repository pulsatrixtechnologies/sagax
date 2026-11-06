// Per-person Linked Grok (#2193):
//
//   GET    /api/me/grok-bridge          link view (never the key)
//   PUT    /api/me/grok-bridge          { webhookUrl?, key?, enabled?, bots?, mayCallOwner?, mayTextOwner? }
//   DELETE /api/me/grok-bridge          clear the link and key
//   POST   /api/me/grok-bridge/test     signed test envelope
//   GET    /api/me/grok-bridge/dead     dead letters (metadata only)
//   GET    /api/me/grok-bridge/leases   live claim leases
//
// The person manages their own link: no admin. Org kill switch is separate
// (organization.allowGrokBridge).
import type { RequestAuth } from "../auth/request-auth.ts";
import type { GrokBridgeService } from "../grok-bridge/service.ts";
import type { GrokBridgeStore } from "../grok-bridge/store.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const GROK_BRIDGE_PATH = "/api/me/grok-bridge";

export interface GrokBridgeRouteDeps {
  service: GrokBridgeService;
  store: GrokBridgeStore;
  principal(auth: RequestAuth): string | null;
}

export function createGrokBridgeRoutes(deps: GrokBridgeRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // String literals keep these routes in scripts/tool-policy/route-inventory.ts.
    const base = path === "/api/me/grok-bridge" || path.startsWith("/api/me/grok-bridge/");
    if (!base) return PASS;
    res.setHeader("cache-control", "no-store");
    const personId = deps.principal(auth);
    if (!personId) return json(res, 404, { error: "Your Grok bridge link is kept on an organization server." });

    if (path === "/api/me/grok-bridge/test") {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      try {
        const result = await deps.service.test(personId);
        if (!result.ok) return json(res, result.status, { error: result.error });
        return json(res, 200, { ok: true, jobId: result.jobId });
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return json(res, status, { error: error instanceof Error ? error.message : "Test failed." });
      }
    }

    if (path === "/api/me/grok-bridge/dead") {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      return json(res, 200, { deadLetters: deps.store.deadLetters(personId) });
    }

    if (path === "/api/me/grok-bridge/leases") {
      if (method !== "GET") return json(res, 405, { error: "GET" });
      return json(res, 200, { leases: deps.store.listLeases(personId) });
    }

    if (path !== "/api/me/grok-bridge") return PASS;

    if (method === "GET") return json(res, 200, deps.service.view(personId));

    if (method === "DELETE") {
      try {
        return json(res, 200, deps.service.saveLink(personId, { clear: true }));
      } catch (error) {
        const status = (error as { status?: number }).status ?? 500;
        return json(res, status, { error: error instanceof Error ? error.message : "Could not clear." });
      }
    }

    if (method !== "PUT") return json(res, 405, { error: "GET, PUT or DELETE" });
    const body = await readBody(req).catch(() => undefined);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return json(res, 400, { error: "Send { webhookUrl, key?, enabled?, bots?, mayCallOwner?, mayTextOwner? }." });
    }
    try {
      return json(res, 200, deps.service.saveLink(personId, body as Record<string, unknown>));
    } catch (error) {
      const status = (error as { status?: number }).status ?? 500;
      return json(res, status, { error: error instanceof Error ? error.message : "Could not save." });
    }
  };
}
