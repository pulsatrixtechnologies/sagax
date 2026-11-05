// PUT /api/bots/:id/temporary-pin { pinned } (Perspicax #321): a person pins
// a temporary agent (server/temporary-agents.ts) so it never expires, or
// unpins it, which restarts its idle clock. Its owner or an organization
// admin only; never a bot or a local service.
import { mayPin, type TemporaryAgent } from "../temporary-agents.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const PIN = /^\/api\/bots\/([\w-]+)\/temporary-pin$/;

export interface TemporaryAgentRouteDeps {
  temporary(botId: string): TemporaryAgent | undefined;
  /** The person behind the request, lowercased; "" for none. */
  personId(auth: RequestAuth): string;
  orgAdmin(auth: RequestAuth): boolean;
  save(botId: string, next: TemporaryAgent): void;
  audit(botId: string, pinned: boolean, principalId: string): void;
  now?(): number;
}

export function createTemporaryAgentRoutes(deps: TemporaryAgentRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = PIN.exec(path);
    if (!m || method !== "PUT") return PASS;
    const botId = m[1]!;
    const temporary = deps.temporary(botId);
    if (!temporary) return void json(res, 404, { error: "no such temporary agent" });
    if (temporary.archived) return void json(res, 410, { error: "This agent was archived.", code: "agent_archived" });
    if (auth.kind === "loopback" && auth.trust === "service") return void json(res, 403, { error: "forbidden: a person pins a temporary agent", code: "temp_agent_person_only" });
    const principalId = deps.personId(auth);
    if (!principalId || !mayPin(temporary, { principalId, admin: deps.orgAdmin(auth) })) {
      return void json(res, 403, { error: "forbidden: only this agent's owner or an organization admin pins it", code: "forbidden_owner" });
    }
    const body = await readBody(req) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "pinned") || typeof body.pinned !== "boolean") {
      return void json(res, 400, { error: "Send { \"pinned\": true } or false" });
    }
    const at = deps.now?.() ?? Date.now();
    const { pinned: _was, ...rest } = temporary;
    const next: TemporaryAgent = body.pinned ? { ...rest, pinned: { principalId, at } } : { ...rest, lastActiveAt: at };
    deps.save(botId, next);
    deps.audit(botId, body.pinned, principalId);
    return void json(res, 200, { pinned: body.pinned });
  };
}
