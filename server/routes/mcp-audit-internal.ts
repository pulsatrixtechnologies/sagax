// POST /api/internal/mcp-audit: one permission audit record from the agents
// proxy (docs/mcp/permissions.md, Audit), written to the activity log. Only
// the whitelisted fields of mcpAuditRow are kept. Behind the agents
// capability (see internal-route.ts); the bot is the capability's.
import { mcpAuditRow, type McpAuditRecord } from "../mcp/mcp-permissions.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export interface McpAuditInternalDeps {
  append(row: ReturnType<typeof mcpAuditRow>): void;
  /** A confidential thread (server/confidential-threads.ts): its rows keep
   * the tool, permission and decision, never the resource a call named. */
  confidential?(threadId: string): boolean;
}

const SCOPES = new Set(["self", "team", "org"]);

export function createMcpAuditInternalRoutes(deps: McpAuditInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === "/api/internal/mcp-audit")) return PASS;
    const body = (await readBody()) as Partial<McpAuditRecord>;
    const valid = typeof body.tool === "string" && typeof body.permission === "string" && typeof body.reason === "string"
      && (body.decision === "allowed" || body.decision === "denied") && SCOPES.has(String(body.scope));
    if (!valid) return json(res, 400, { error: "bad audit record" });
    const record = body as McpAuditRecord;
    if (deps.confidential?.(capability.threadId)) delete (record as { resource?: unknown }).resource;
    deps.append(mcpAuditRow(record, capability.botId));
    return json(res, 200, { ok: true });
  };
}
