// A person's own tool access (2026-10-26, docs/tool-policy.md): the grants
// whose subject is the signed-in person themselves (`{ kind: "user", id:
// <their principal> }`), which the tool guard checks as the "speaker" of a
// bot's turn (server/tools/tool-guard.ts). The person manages them without an
// admin for everything that stays in their own environment; a scope that
// reaches other people, the whole organization, the shared server or its
// billing stays an admin's (shared/grant-reach.ts), on /api/tool-grants.
//
//   GET  /api/me/tool-grants                 -> { grants, adminOnlyAreas, mayGrantAdmin }
//   POST /api/me/tool-grants { scope, expiresAt? } -> 201 { grant }
//   POST /api/me/tool-grants/<id>/revoke     -> { ok }
//
// Never a bot: an agent tool cannot reach these routes (their policy rows
// are `tool-grants:admin`, never default-enabled), and a bot's act copy of
// a session or an AI client is refused (`person` returns null), so no agent
// grants itself or its speaker anything. Every write is one row in the
// admin activity log, like the other grant routes.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { ToolGrantStore } from "../tools/tool-grants.ts";
import { grantStaysInOwnEnvironment, ORG_REACH_AREAS } from "../../shared/grant-reach.ts";
import { PASS, type RouteHandler } from "./table.ts";

const MAX_ADMIN_DAYS = 30;
const REVOKE = /^\/api\/me\/tool-grants\/(tg_[\w-]+)\/revoke$/;

export interface MyToolGrantRouteDeps {
  /** The signed-in person's principal id, or null when no person asks (a
   * local service, a bot's act session, an AI client). */
  person(auth: RequestAuth): string | null;
  isAdmin(auth: RequestAuth): boolean;
  grants: Pick<ToolGrantStore, "all" | "grant" | "revoke">;
  audit(action: "tool_grants.grant" | "tool_grants.revoke", auth: RequestAuth, req: IncomingMessage, detail: Record<string, unknown>): void;
  now?: () => number;
}

const grantBody = z.object({
  scope: z.string().regex(/^[a-z0-9-]+:(read|write|admin)$/),
  expiresAt: z.number().int().positive().optional(),
}).strict();

export function createMyToolGrantRoutes(deps: MyToolGrantRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const revoke = path.match(REVOKE);
    const list = path === "/api/me/tool-grants";
    if (!list && !revoke) return PASS;
    res.setHeader("cache-control", "no-store");
    const person = deps.person(auth);
    if (!person) return json(res, 403, { error: "Sign in to manage your own tool access.", code: "no_person" });
    const subject = { kind: "user" as const, id: person };
    const mine = (row: { subject: { kind: string; id: string } }) => row.subject.kind === "user" && row.subject.id === person;
    const admin = deps.isAdmin(auth);

    if (list && method === "GET") {
      const at = now();
      const rows = deps.grants.all().filter(mine)
        .map((g) => ({ ...g, state: g.revokedAt !== undefined ? "revoked" : g.expiresAt !== undefined && g.expiresAt <= at ? "expired" : "active" }));
      return json(res, 200, { grants: rows, mayGrantAdmin: true, adminOnlyAreas: admin ? [] : ORG_REACH_AREAS });
    }
    if (list && method === "POST") {
      const parsed = grantBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "scope <area>:<read|write|admin> required" });
      const { scope, expiresAt } = parsed.data;
      if (expiresAt !== undefined && expiresAt <= now()) return json(res, 400, { error: "expiresAt is in the past" });
      if (!admin && !grantStaysInOwnEnvironment(scope)) {
        return json(res, 403, { error: "this access reaches past your own environment: only an admin can grant it", code: "org_scope_admin_only" });
      }
      if (scope.endsWith(":admin") && (expiresAt === undefined || expiresAt - now() > MAX_ADMIN_DAYS * 86_400_000)) {
        return json(res, 400, { error: `an admin grant needs an expiry within ${MAX_ADMIN_DAYS} days`, code: "admin_expiry" });
      }
      const row = deps.grants.grant(subject, scope, person, expiresAt);
      deps.audit("tool_grants.grant", auth, req, { id: row.id, subject, scope, ...(expiresAt ? { expiresAt } : {}) });
      return json(res, 201, { grant: row });
    }
    if (revoke && method === "POST") {
      const grantId = revoke[1]!;
      const row = deps.grants.all().find((g) => g.id === grantId);
      // someone else's grant, or a bot's, is not reachable from here
      if (!row || !mine(row)) return json(res, 404, { error: "no active grant with that id" });
      if (!deps.grants.revoke(grantId, person)) return json(res, 404, { error: "no active grant with that id" });
      deps.audit("tool_grants.revoke", auth, req, { id: grantId, subject });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
