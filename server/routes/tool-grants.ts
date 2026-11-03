// B3a (docs/tool-policy.md §6): the grants behind the securable tool layer,
// for the settings page that reviews and revokes them. Admin scope only: the
// paths are not in request-auth.ts's lists, so the gate already requires
// admin; the handler checks again so a move there can't open it. Agent tools
// never reach these routes (their policy rows are admin, not default-enabled):
// a bot cannot grant itself anything.
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { ToolGrantStore } from "../tool-grants.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface ToolGrantRouteDeps {
  grants: Pick<ToolGrantStore, "all" | "grant" | "revoke">;
  /** Bots that exist, so a grant can't name a stranger. */
  botExists(id: string): boolean;
  /** Record a grant change in the admin activity log. */
  audit(action: "tool_grants.grant" | "tool_grants.revoke", auth: RequestAuth, req: IncomingMessage, detail: Record<string, unknown>): void;
  now?: () => number;
}

const MAX_ADMIN_DAYS = 30;
const grantBody = z.object({
  subject: z.object({ kind: z.enum(["bot", "user"]), id: z.string().min(1).max(128) }),
  scope: z.string().regex(/^[a-z0-9-]+:(read|write|admin)$/),
  expiresAt: z.number().int().positive().optional(),
}).strict();

function actor(auth: RequestAuth): string {
  return auth.kind === "session" ? auth.session.principalId ?? `session:${auth.session.id}` : "loopback";
}

export function createToolGrantRoutes(deps: ToolGrantRouteDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  return async ({ req, res, path, method, auth, json, readBody, url }) => {
    if (path !== "/api/tool-grants" && !path.startsWith("/api/tool-grants/")) return PASS;
    if (!auth.scopes.includes("admin")) return json(res, 403, { error: "admin only" });
    if (path === "/api/tool-grants" && method === "GET") {
      const kind = url.searchParams.get("kind");
      const id = url.searchParams.get("id");
      const at = now();
      const grants = deps.grants.all()
        .filter((g) => (!kind || g.subject.kind === kind) && (!id || g.subject.id === id))
        .map((g) => ({ ...g, state: g.revokedAt !== undefined ? "revoked" : g.expiresAt !== undefined && g.expiresAt <= at ? "expired" : "active" }));
      return json(res, 200, { grants });
    }
    if (path === "/api/tool-grants" && method === "POST") {
      const parsed = grantBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "subject {kind,id} and scope <area>:<read|write|admin> required" });
      const { subject, scope, expiresAt } = parsed.data;
      if (subject.kind === "bot" && !deps.botExists(subject.id)) return json(res, 404, { error: "no such bot" });
      if (expiresAt !== undefined && expiresAt <= now()) return json(res, 400, { error: "expiresAt is in the past" });
      // design §6: an admin-tier grant always ends, within 30 days
      if (scope.endsWith(":admin") && (expiresAt === undefined || expiresAt - now() > MAX_ADMIN_DAYS * 86_400_000)) {
        return json(res, 400, { error: `an admin grant needs an expiry within ${MAX_ADMIN_DAYS} days`, code: "admin_expiry" });
      }
      const row = deps.grants.grant(subject, scope, actor(auth), expiresAt);
      deps.audit("tool_grants.grant", auth, req, { id: row.id, subject, scope, ...(expiresAt ? { expiresAt } : {}) });
      return json(res, 201, { grant: row });
    }
    const m = path.match(/^\/api\/tool-grants\/(tg_[\w-]+)\/revoke$/);
    if (m && method === "POST") {
      if (!deps.grants.revoke(m[1]!, actor(auth))) return json(res, 404, { error: "no active grant with that id" });
      deps.audit("tool_grants.revoke", auth, req, { id: m[1] });
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: "not found" });
  };
}
