// Rename a saved MCP server whose name Sagax now reserves (2026-10-17,
// follow-up of #695). An older build may have saved a server as `mcp`,
// `sagax-...`, `perspicax_...`, `claude_ai_...`, `openmausbot_...` or with
// `__` in its name; such a server is never mounted (server/config.ts
// customMcpServers). The MCP settings show it with this rename.
//
//   POST /api/mcp/servers/:name/rename   { to }   -> the MCP server list
//
// Only a reserved name moves here. The entry is re-read under its new name,
// saved off (the person turns it on again), its sign-ins are forgotten, the
// bots that listed the old name list the new one and drop their account
// choice for it. Admin scope (server/auth/request-auth.ts: not a client path).
import type { RequestAuth } from "../auth/request-auth.ts";
import { renameReservedMcpServer, type StoredMcpServer } from "../mcp/mcp-registry.ts";
import { PASS, type RouteHandler } from "./table.ts";

const RENAME_PATH = /^\/api\/mcp\/servers\/([a-z][a-z0-9_-]{0,31})\/rename$/;

export interface McpServerRenameDeps {
  /** The saved servers (config.json `mcpServers`). */
  servers: () => Record<string, unknown>;
  /** One MCP config writer at a time: false when another holds it. */
  acquire: () => boolean;
  release: () => void;
  /** Organization policy or host-command refusal for the entry under its new name. */
  refusal: (name: string, server: StoredMcpServer) => { error: string; code: string } | undefined;
  persist: (next: Record<string, unknown>) => void;
  forgetSignIn: (name: string) => Promise<void>;
  /** Bots that listed `from` list `to`; their account choice for it is dropped. */
  renameInBots: (from: string, to: string) => void;
  /** After the save (a remote server is asked whether it wants a sign-in). */
  afterRename: (to: string, server: StoredMcpServer) => Promise<void>;
  /** The listing, as the person who asked sees it. */
  response: (auth: RequestAuth) => unknown;
  log?: (line: string) => void;
}

export function createMcpServerRenameRoutes(deps: McpServerRenameDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const match = RENAME_PATH.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    if (!deps.acquire()) return json(res, 409, { error: "MCP servers are already being updated." });
    try {
      const from = match[1]!;
      const body = await readBody(req) as unknown;
      const to = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).to : undefined;
      const renamed = renameReservedMcpServer(deps.servers(), from, to);
      if (!renamed.ok) return json(res, renamed.status, { error: renamed.error });
      const name = to as string;
      const refusal = deps.refusal(name, renamed.server);
      if (refusal) return json(res, 403, refusal);
      deps.persist(renamed.next);
      // a new name is a new resource: no sign-in follows it either way
      await deps.forgetSignIn(from).catch(() => undefined);
      await deps.forgetSignIn(name).catch(() => undefined);
      deps.renameInBots(from, name);
      (deps.log ?? console.log)(`MCP server ${JSON.stringify(from)} renamed to ${JSON.stringify(name)} (reserved name); saved off until turned on`);
      await deps.afterRename(name, renamed.server).catch(() => undefined);
      return json(res, 200, { ...(deps.response(auth) as object), renamed: { from, to: name } });
    } finally {
      deps.release();
    }
  };
}
