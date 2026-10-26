// POST /api/internal/approvals: sagax_approvals (server/primary-approvals.ts).
// A person's Primary Bot lists, answers or cancels the cards waiting on that
// person, at their request. Behind the agents capability (internal-route.ts).
import type { PrimaryResult } from "../primary-approvals.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface PrimaryApprovalsInternalDeps {
  handle(input: { args: Record<string, unknown>; botId: string; threadId: string; generation: string }): Promise<PrimaryResult>;
}

export function createPrimaryApprovalsInternalRoutes(deps: PrimaryApprovalsInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/approvals")) return PASS;
    const args = await readBody();
    const result = await deps.handle({ args, botId: capability.botId, threadId: capability.threadId, generation: capability.generation });
    return json(res, result.status, result.body);
  };
}
