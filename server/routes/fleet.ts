import type { fleetAvailable, fleetRequest, fleetSocketPath } from "../fleet/fleet-client.ts";
import type { entitled } from "../enterprise.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface FleetRouteDeps {
  entitled: typeof entitled;
  fleetSocketPath: typeof fleetSocketPath;
  fleetAvailable: typeof fleetAvailable;
  fleetRequest: typeof fleetRequest;
}

export function createFleetRoutes(deps: FleetRouteDeps): RouteHandler {
  return async ({ req, res, path, method, json, readBody }) => {
    const { entitled, fleetSocketPath, fleetAvailable, fleetRequest } = deps;
    const fleetRoute = /^\/api\/fleet(?:\/(workspaces(?:\/([a-z0-9-]+)(?:\/(users|suspend|resume))?)?|upgrade))?$/.exec(path);
    if (fleetRoute) {
      // Admin scope by default (server/auth/request-auth.ts), checked before this
      // point; the socket's own permissions decide whether this workspace may
      // drive the agent at all. The `admin` feature is always on in the
      // open-source edition: only an enterprise layer that withholds it ends here.
      if (!entitled("admin")) {
        json(res, 403, { error: "Installations are off: the enterprise layer on this server does not grant its admin feature." });
        return;
      }
      const socket = fleetSocketPath();
      if (!fleetAvailable(socket)) {
        json(res, 404, { error: "No fleet agent on this server. Run `openmausbot fleet init --domain … --operator <this user>` as root." });
        return;
      }
      const [, resource, slug, sub] = fleetRoute;
      let forward: { method: string; path: string; body?: unknown } | null = null;
      if (method === "GET" && !resource) forward = { method: "GET", path: "/workspaces" };
      else if (method === "POST" && resource === "workspaces") forward = { method: "POST", path: "/workspaces", body: await readBody(req, 256 * 1024) };
      else if (method === "POST" && resource === "upgrade") forward = { method: "POST", path: "/upgrade" };
      else if (slug && method === "POST" && (sub === "users" || sub === "suspend" || sub === "resume")) forward = { method: "POST", path: `/workspaces/${slug}/${sub}`, ...(sub === "users" ? { body: await readBody(req, 8192) } : {}) };
      else if (slug && method === "DELETE" && !sub) forward = { method: "DELETE", path: `/workspaces/${slug}`, body: await readBody(req, 8192) };
      if (!forward) {
        json(res, 405, { error: "no such fleet operation" });
        return;
      }
      res.setHeader("cache-control", "no-store");
      try {
        const reply = await fleetRequest(socket, forward.method, forward.path, forward.body);
        json(res, reply.status, reply.body ?? {});
        return;
      } catch (error) {
        json(res, 502, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }


    return PASS;
  };
}
