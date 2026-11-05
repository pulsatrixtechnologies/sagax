/**
 * Non-organization routine-delegation refusal (#1388).
 * Pure move out of server/index.ts; behaviour unchanged.
 */
import { PASS, type RouteHandler } from "./table.ts";

export function createRoutineDelegationStubRoutes(): RouteHandler {
  return async ({ res, path, json }) => path === "/api/org/routine-delegation"
    ? json(res, 403, { error: "This server does not sign people in with Pulsatrix.", code: "identity_perspicax" })
    : PASS;
}
