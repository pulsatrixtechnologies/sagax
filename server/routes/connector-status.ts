// GET /api/connector-status  { perspicax: { state, since } | null }
//
// #2013: whether this server reaches its Perspicax connector, for the calm
// notice in the person's app (server/perspicax/perspicax-reachability.ts).
// null on a server without Perspicax. Changes arrive live as a
// `connector.status` frame.
import type { ConnectorStatus } from "../perspicax/perspicax-reachability.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createConnectorStatusRoutes(deps: { perspicax: () => ConnectorStatus | null }): RouteHandler {
  return async ({ res, path, method, json }) => {
    if (path !== "/api/connector-status" || method !== "GET") return PASS;
    res.setHeader("cache-control", "no-store");
    return json(res, 200, { perspicax: deps.perspicax() });
  };
}
