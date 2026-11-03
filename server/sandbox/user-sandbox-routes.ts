// Settings > Organization > "Your server environment": the signed-in
// person's own environment only. There is no route that names another
// person's environment, and none that names a bot.
//
//   GET  /api/me/server-environment         status, resources, last used
//   POST /api/me/server-environment/reset   recreate it ({ confirm: true })
//   POST /api/me/server-environment/update  rebuild it from the current image, keeping /workspace
//   POST /api/me/server-environment/power   { action: start|shutdown|pause|resume,
//                                             confirm? } (the Computer tab)
//   GET  /api/me/server-environment/stats   CPU, memory, disk, OS (usage panel)
import { PASS, type RouteHandler } from "../routes/table.ts";
import type { UserSandboxManager } from "./user-sandbox-manager.ts";
import { UserSandboxUnavailable } from "./user-sandbox-manager.ts";

const PATHS = new Set(["/api/me/server-environment", "/api/me/server-environment/reset", "/api/me/server-environment/update", "/api/me/server-environment/power", "/api/me/server-environment/stats"]);
const POWER_ACTIONS = new Set(["start", "shutdown", "pause", "resume"]);

export function createUserSandboxRoutes(deps: {
  /** Null on a server without the provisioner: the card says it is off. */
  manager: () => UserSandboxManager | null;
  organization: boolean;
  /** A bot turn works in this person's environment right now. */
  turnRunning?: (principalId: string) => boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!PATHS.has(path)) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.organization) return json(res, 404, { error: "not found" });
    const principalId = auth.kind === "session" ? auth.session.principalId?.trim() : undefined;
    if (!principalId) return json(res, 403, { error: "Sign in with Pulsatrix to use a server environment.", code: "identity_perspicax" });
    const manager = deps.manager();
    if (path === "/api/me/server-environment") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!manager) return json(res, 200, { configured: false });
      return json(res, 200, { configured: true, ...(await manager.status(principalId)) });
    }
    if (path === "/api/me/server-environment/stats") {
      if (method !== "GET") return json(res, 405, { error: "method not allowed" });
      if (!manager) return json(res, 409, { error: "This server has no server environments.", code: "not_configured" });
      try {
        return json(res, 200, await manager.stats(principalId));
      } catch (error) {
        return json(res, 502, { error: "The server environment could not be reached.", code: error instanceof UserSandboxUnavailable ? error.code : "unavailable" });
      }
    }
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!manager) return json(res, 409, { error: "This server has no server environments.", code: "not_configured" });
    if (path === "/api/me/server-environment/update") {
      try {
        return json(res, 200, { configured: true, ...(await manager.update(principalId)) });
      } catch (error) {
        if (error instanceof UserSandboxUnavailable) return json(res, 409, { error: error.message, code: error.code });
        return json(res, 502, { error: "The server environment could not be updated.", code: "unavailable" });
      }
    }
    if (path === "/api/me/server-environment/power") {
      const body = await readBody(req) as Record<string, unknown> | null;
      const action = typeof body?.action === "string" && POWER_ACTIONS.has(body.action) ? body.action as "start" | "shutdown" | "pause" | "resume" : null;
      if (!action) return json(res, 400, { error: "action must be start, shutdown, pause or resume", code: "bad_action" });
      // Shutting down or freezing it under a running turn cuts that work
      // short: the person confirms first.
      if ((action === "shutdown" || action === "pause") && body?.confirm !== true
        && ((deps.turnRunning?.(principalId) ?? false) || (await manager.busy(principalId)) > 0)) {
        return json(res, 409, { error: "A bot is working in your server environment right now. Confirm to stop it anyway.", code: "confirm_running" });
      }
      try {
        return json(res, 200, { configured: true, ...(await manager.power(principalId, action)) });
      } catch (error) {
        if (error instanceof UserSandboxUnavailable) return json(res, error.code === "capacity" ? 429 : 409, { error: error.message, code: error.code });
        return json(res, 502, { error: "The server environment could not be changed.", code: "unavailable" });
      }
    }
    const body = await readBody(req) as Record<string, unknown> | null;
    if (body?.confirm !== true) return json(res, 400, { error: "Confirm the reset: it erases /workspace.", code: "confirm" });
    try {
      return json(res, 200, { configured: true, ...(await manager.reset(principalId)) });
    } catch (error) {
      if (error instanceof UserSandboxUnavailable) return json(res, 409, { error: error.message, code: error.code });
      return json(res, 502, { error: "The server environment could not be reset.", code: "unavailable" });
    }
  };
}
