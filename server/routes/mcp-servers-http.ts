/**
 * Custom MCP servers HTTP routes (#1388 wave 2 P5):
 * GET/POST /api/mcp/servers, import, OAuth, test, PUT/PATCH/DELETE :name.
 *
 * Rename lives in mcp-server-rename.ts; this module PASSes /rename.
 * Never imports server/index.ts.
 */
import type { IncomingMessage } from "node:http";
import { z } from "zod";

import type { McpServerSpec } from "../contracts.ts";
import {
  DEFAULT_MCP_ACCOUNT,
  isMcpAccountId,
} from "../mcp/mcp-oauth.ts";
import {
  ambiguousPersonalHeaderRefusal,
  personalHeaderRefusal,
  skipPersonalInSharedProbe,
} from "../mcp/mcp-personal-shared-guard.ts";
import { probeMcpServer } from "../mcp/mcp-probe.ts";
import {
  isRemoteMcpServer,
  MAX_DISABLED_TOOLS,
  MAX_MCP_SERVERS,
  parseMcpServerMutation,
  parseMcpServersImport,
  parseStoredMcpServer,
  type StoredMcpServer,
  type StoredRemoteMcpServer,
} from "../mcp/mcp-registry.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

const OAUTH_PATH = /^\/api\/mcp\/servers\/([a-z][a-z0-9_-]{0,31})\/oauth\/(start|disconnect|probe|status)$/;
const TEST_PATH = /^\/api\/mcp\/servers\/([a-z][a-z0-9_-]{0,31})\/test$/;
const SERVER_PATH = /^\/api\/mcp\/servers\/([a-z][a-z0-9_-]{0,31})$/;

/** PATCH /api/mcp/servers/:name: the on/off switch and the disabled tools. */
const mcpServerPatchSchema = z.object({
  enabled: z.boolean().optional(),
  // eslint-disable-next-line no-control-regex
  disabledTools: z.array(z.string().regex(/^[^*\x00-\x1f\x7f]{1,256}$/)).max(MAX_DISABLED_TOOLS).optional(),
}).strict();

export interface McpOAuthHttp {
  status(name: string, server: StoredRemoteMcpServer, account?: string): unknown;
  pendingFor(name: string, account?: string): boolean;
  probe(name: string, server: StoredRemoteMcpServer, signal?: AbortSignal): Promise<unknown>;
  disconnect(name: string, server: StoredRemoteMcpServer, outer?: AbortSignal, account?: string): Promise<void>;
  forget(name: string): Promise<void>;
  refresh(name: string, server: StoredRemoteMcpServer, force?: boolean, outer?: AbortSignal): Promise<boolean>;
  withAuthHeaders<T extends Record<string, McpServerSpec>>(servers: T): T;
  vault: { accounts(name: string): string[] };
}

export interface McpServersHttpBot {
  id: string;
  mcpAccounts?: Record<string, string>;
}

/** True when the probe has already finished (every server known): it then
 * settles within a turn of the event loop, a network probe never does. */
function settledSoon(probe: Promise<void>): Promise<boolean> {
  return Promise.race([
    probe.then(() => true, () => true),
    new Promise<boolean>((resolve) => setImmediate(() => resolve(false))),
  ]);
}

export interface McpServersHttpDeps {
  mcpServers(): Record<string, unknown> | undefined;
  mcpViewer(auth: RequestAuth): string | null;
  mcpServerResponse(viewer?: string | null): unknown;
  mcpServerNamesResponse(viewer?: string | null): unknown;
  probeMcpOAuth(names?: string[], force?: boolean): Promise<void>;
  mcpOAuth: McpOAuthHttp;
  remoteMcpServers(names?: string[]): Record<string, StoredRemoteMcpServer>;
  managedPolicy: { mcpAllowed(name: string, url?: string): boolean };
  mcpPolicyRefusal(name: string, server: object): string | undefined;
  persistMcpServers(next: Record<string, unknown>): void;
  /** Whether each command server starts for each bot: checked again when one is added, changed or turned on. */
  health?: { changed(name: string): void };
  bots(): McpServersHttpBot[];
  patchBot(id: string, patch: { mcpAccounts?: Record<string, string> | undefined }): McpServersHttpBot | null | undefined;
  broadcast(event: { kind: "bot"; bot: unknown }): void;
  wireBot(bot: McpServersHttpBot): unknown;
  startMcpSignIn(
    req: IncomingMessage,
    auth: RequestAuth,
    name: string,
    server: StoredRemoteMcpServer,
    body: unknown,
  ): Promise<{ status: number; body: unknown }>;
  personalMcpNamesForGuard(): Set<string>;
  /** false when another writer holds the MCP config lock. */
  acquireMcpConfig(): boolean;
  releaseMcpConfig(): void;
  /** Current in-flight probe count. */
  mcpProbesInFlight(): number;
  beginMcpProbe(): void;
  endMcpProbe(): void;
  MAX_CONCURRENT_MCP_PROBES: number;
  mcpServerBody(body: unknown): Record<string, unknown>;
  identityKind(): string;
  ORG_HOST_COMMAND_REFUSAL: string;
  sharedMcpPersonalRefusal(name: string, server: StoredMcpServer, personalNames?: Set<string>): string | null;
  sessionsIsLive(sessionId: string): boolean;
  callerCan(auth: RequestAuth, key: string): boolean;
}

export function createMcpServersHttpRoutes(deps: McpServersHttpDeps): RouteHandler {
  return async ({ req, res, url, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/mcp/servers")) return PASS;
    // Rename is owned by mcp-server-rename.ts.
    if (path.endsWith("/rename")) return PASS;

    if (method === "GET" && path === "/api/mcp/servers") {
      const viewer = deps.mcpViewer(auth);
      if (auth.kind === "session" && !auth.scopes.includes("admin") && !deps.callerCan(auth, "host.shell")) {
        return json(res, 200, deps.mcpServerNamesResponse(viewer));
      }
      const probe = deps.probeMcpOAuth(undefined, url.searchParams.get("reprobe") === "1");
      // ?probe=background (the panels, #2273): the list answers at once from
      // what is known; a server still being asked (a first look after a
      // start can take the probe's 4 s) is marked, and the panel reads again
      // without it (the same probe, awaited) for its sign-in state.
      if (url.searchParams.get("probe") === "background" && !(await settledSoon(probe))) {
        void probe.catch(() => undefined);
        const listed = deps.mcpServerResponse(viewer);
        return json(res, 200, listed && typeof listed === "object" ? { ...listed, probing: true } : listed);
      }
      await probe;
      return json(res, 200, deps.mcpServerResponse(viewer));
    }

    const mcpOAuthRoute = OAUTH_PATH.exec(path);
    if (mcpOAuthRoute) {
      const [, name, action] = mcpOAuthRoute;
      const expected = action === "status" ? "GET" : "POST";
      if (method !== expected) return json(res, 405, { error: "method not allowed" });
      if (method === "POST" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      const server = deps.remoteMcpServers([name!])[name!];
      if (!server) return json(res, 404, { error: "Remote MCP server not found." });
      res.setHeader("cache-control", "no-store");
      if (action === "status") {
        const asked = url.searchParams.get("account");
        const account = isMcpAccountId(asked) ? asked : DEFAULT_MCP_ACCOUNT;
        const status = deps.mcpOAuth.status(name!, server, account);
        return json(res, 200, {
          ...((status && typeof status === "object" ? status : null) ?? { auth: account === DEFAULT_MCP_ACCOUNT ? "none" : "required" }),
          pending: deps.mcpOAuth.pendingFor(name!, asked === null ? undefined : account),
        });
      }
      const body = await readBody(req);
      if (action === "probe") {
        if (!deps.managedPolicy.mcpAllowed(name!, server.url)) {
          return json(res, 403, { error: deps.mcpPolicyRefusal(name!, server) ?? "Your organization has not approved this server.", code: "managed_policy" });
        }
        await deps.mcpOAuth.probe(name!, server, AbortSignal.timeout(10_000)).catch(() => undefined);
        return json(res, 200, deps.mcpServerResponse(deps.mcpViewer(auth)));
      }
      if (action === "disconnect") {
        const asked = body && typeof body === "object" ? (body as Record<string, unknown>).account : undefined;
        if (asked !== undefined && !isMcpAccountId(asked)) return json(res, 400, { error: "Unknown account." });
        await deps.mcpOAuth.disconnect(name!, server, undefined, asked ?? DEFAULT_MCP_ACCOUNT).catch(() => undefined);
        if (asked !== undefined && asked !== DEFAULT_MCP_ACCOUNT && !deps.mcpOAuth.vault.accounts(name!).includes(asked)) {
          for (const bot of deps.bots()) {
            if (bot.mcpAccounts?.[name!] !== asked) continue;
            const { [name!]: _removed, ...rest } = bot.mcpAccounts;
            const updated = deps.patchBot(bot.id, { mcpAccounts: Object.keys(rest).length ? rest : undefined });
            if (updated) deps.broadcast({ kind: "bot", bot: deps.wireBot(updated) });
          }
        }
        return json(res, 200, deps.mcpServerResponse(deps.mcpViewer(auth)));
      }
      if (!deps.managedPolicy.mcpAllowed(name!, server.url)) {
        return json(res, 403, { error: deps.mcpPolicyRefusal(name!, server) ?? "Your organization has not approved this server.", code: "managed_policy" });
      }
      const started = await deps.startMcpSignIn(req, auth, name!, server, body);
      return json(res, started.status, started.body);
    }

    const mcpTest = TEST_PATH.exec(path);
    if (method === "POST" && mcpTest) {
      const configured = deps.mcpServers() ?? {};
      const name = Object.keys(configured).find((entry) => entry === mcpTest[1]);
      const raw = name === undefined ? undefined : configured[name];
      if (name === undefined || raw === undefined) return json(res, 404, { error: "MCP server not found." });
      const parsed = parseStoredMcpServer(name, raw);
      if (!parsed.ok) return json(res, 400, { error: parsed.error });
      if (skipPersonalInSharedProbe(name, deps.personalMcpNamesForGuard())) {
        return json(res, 400, { error: "Test this server from your personal connections. It is not probed through the shared installation list." });
      }
      if (deps.mcpProbesInFlight() >= deps.MAX_CONCURRENT_MCP_PROBES) {
        return json(res, 429, { error: "Two MCP connection tests are already running." });
      }
      const controller = new AbortController();
      const disconnect = () => {
        if (!res.writableEnded) controller.abort();
      };
      res.once("close", disconnect);
      deps.beginMcpProbe();
      try {
        const server = parsed.server;
        if (!isRemoteMcpServer(server)) return json(res, 200, await probeMcpServer(server, undefined, controller.signal, name));
        await deps.mcpOAuth.refresh(name, server, false, controller.signal).catch(() => false);
        const withSignIn = { ...server, ...deps.mcpOAuth.withAuthHeaders({ [name]: server })[name] };
        let result = await probeMcpServer(withSignIn, undefined, controller.signal, name);
        if (!result.ok && /HTTP 401\b/.test(result.error) && await deps.mcpOAuth.refresh(name, server, true, controller.signal).catch(() => false)) {
          result = await probeMcpServer({ ...server, ...deps.mcpOAuth.withAuthHeaders({ [name]: server })[name] }, undefined, controller.signal, name);
        }
        // Record a sign-in the Test found. probeServer never drops tokens for a
        // credential-less probe; a Bearer we sent and the server refused still
        // goes through the refresh / expire path inside probe.
        if (!result.ok && (result.auth === "required" || /HTTP 40[13]\b/.test(result.error))) {
          await deps.mcpOAuth.probe(name, server, controller.signal).catch(() => undefined);
        }
        return json(res, 200, result);
      } finally {
        res.off("close", disconnect);
        deps.endMcpProbe();
      }
    }

    if (method === "POST" && path === "/api/mcp/servers") {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      if (!deps.acquireMcpConfig()) return json(res, 409, { error: "MCP servers are already being updated." });
      try {
        const body = await readBody(req) as Record<string, unknown> | null;
        const name = typeof body?.name === "string" ? body.name : "";
        const current = deps.mcpServers() ?? {};
        if (Object.hasOwn(current, name)) return json(res, 409, { error: "An MCP server with that name already exists." });
        if (Object.keys(current).length >= MAX_MCP_SERVERS) {
          return json(res, 400, { error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.` });
        }
        const parsed = parseMcpServerMutation(name, deps.mcpServerBody(body));
        if (!parsed.ok) return json(res, 400, { error: parsed.error });
        if (deps.identityKind() === "perspicax" && !isRemoteMcpServer(parsed.server)) {
          return json(res, 403, { error: deps.ORG_HOST_COMMAND_REFUSAL, code: "org_host_command" });
        }
        const personalRefusal = deps.sharedMcpPersonalRefusal(name, parsed.server);
        if (personalRefusal) return json(res, 400, { error: personalRefusal });
        const refusal = deps.mcpPolicyRefusal(name, parsed.server);
        if (refusal) return json(res, 403, { error: refusal, code: "managed_policy" });
        deps.persistMcpServers({ ...current, [name]: parsed.server });
        deps.health?.changed(name);
        await deps.mcpOAuth.forget(name).catch(() => undefined);
        await deps.probeMcpOAuth([name]);
        return json(res, 201, deps.mcpServerResponse(deps.mcpViewer(auth)));
      } finally {
        deps.releaseMcpConfig();
      }
    }

    if (method === "POST" && path === "/api/mcp/servers/import") {
      if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      if (!deps.acquireMcpConfig()) return json(res, 409, { error: "MCP servers are already being updated." });
      try {
        const body = await readBody(req) as Record<string, unknown> | null;
        const text = typeof body?.json === "string" ? body.json : "";
        if (auth.kind === "session" && !deps.sessionsIsLive(auth.session.id)) {
          return json(res, 401, { error: "unauthorized: this session has expired or was revoked" });
        }
        if (!text.trim()) return json(res, 400, { error: "Paste the JSON block first." });
        const parsed = parseMcpServersImport(text);
        if (!parsed.ok) return json(res, 400, { error: parsed.error });
        const current = deps.mcpServers() ?? {};
        const names = Object.keys(parsed.servers);
        const taken = names.filter((entry) => Object.hasOwn(current, entry));
        if (taken.length) {
          return json(res, 409, { error: `Already added: ${taken.join(", ")}. Remove or rename ${taken.length === 1 ? "it" : "them"} first.` });
        }
        if (Object.keys(current).length + names.length > MAX_MCP_SERVERS) {
          return json(res, 400, { error: `You can add at most ${MAX_MCP_SERVERS} MCP servers.` });
        }
        if (deps.identityKind() === "perspicax" && names.some((entry) => !isRemoteMcpServer(parsed.servers[entry] as McpServerSpec))) {
          return json(res, 403, { error: deps.ORG_HOST_COMMAND_REFUSAL, code: "org_host_command" });
        }
        const personalNames = deps.personalMcpNamesForGuard();
        const personalRefusal = names.map((serverName) => deps.sharedMcpPersonalRefusal(serverName, parsed.servers[serverName] as StoredMcpServer, personalNames)).find(Boolean);
        if (personalRefusal) return json(res, 400, { error: personalRefusal });
        const refused = names.filter((entry) => deps.mcpPolicyRefusal(entry, parsed.servers[entry] as object));
        if (refused.length) {
          return json(res, 403, {
            error: `${deps.mcpPolicyRefusal(refused[0]!, parsed.servers[refused[0]!] as object)} Not approved: ${refused.join(", ")}.`,
            code: "managed_policy",
          });
        }
        deps.persistMcpServers({ ...current, ...parsed.servers });
        for (const added of names) deps.health?.changed(added);
        for (const added of names) await deps.mcpOAuth.forget(added).catch(() => undefined);
        await deps.probeMcpOAuth(names);
        return json(res, 201, { ...(deps.mcpServerResponse(deps.mcpViewer(auth)) as object), added: names });
      } finally {
        deps.releaseMcpConfig();
      }
    }

    const mcpServerRoute = SERVER_PATH.exec(path);
    if (mcpServerRoute && ["PUT", "PATCH", "DELETE"].includes(method)) {
      if (method !== "DELETE" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
        return json(res, 415, { error: "content-type must be application/json" });
      }
      if (!deps.acquireMcpConfig()) return json(res, 409, { error: "MCP servers are already being updated." });
      try {
        const name = mcpServerRoute[1]!;
        const current = deps.mcpServers() ?? {};
        if (!Object.hasOwn(current, name)) return json(res, 404, { error: "MCP server not found." });
        if (method === "DELETE") {
          const next = { ...current };
          delete next[name];
          deps.persistMcpServers(next);
          await deps.mcpOAuth.forget(name).catch(() => undefined);
          return json(res, 200, deps.mcpServerResponse(deps.mcpViewer(auth)));
        }

        const existing = parseStoredMcpServer(name, current[name]);
        if (!existing.ok) return json(res, 400, { error: existing.error });
        const body = await readBody(req);
        if (method === "PATCH") {
          const patch = mcpServerPatchSchema.safeParse(body);
          if (!patch.success || Object.keys(patch.data).length === 0) {
            return json(res, 400, { error: "Only an enabled boolean or a disabledTools list can be changed here." });
          }
          const next: Record<string, unknown> = { ...existing.server };
          if (patch.data.enabled !== undefined) next.enabled = patch.data.enabled;
          if (patch.data.disabledTools !== undefined) {
            const tools = [...new Set(patch.data.disabledTools)].sort();
            if (tools.length) next.disabledTools = tools;
            else delete next.disabledTools;
          }
          deps.persistMcpServers({ ...current, [name]: next });
          if (patch.data.enabled !== undefined) deps.health?.changed(name);
          return json(res, 200, deps.mcpServerResponse(deps.mcpViewer(auth)));
        }

        const parsed = parseMcpServerMutation(name, body, existing.server);
        if (!parsed.ok) return json(res, 400, { error: parsed.error });
        if (deps.identityKind() === "perspicax" && !isRemoteMcpServer(parsed.server)) {
          return json(res, 403, { error: deps.ORG_HOST_COMMAND_REFUSAL, code: "org_host_command" });
        }
        const personalNames = deps.personalMcpNamesForGuard();
        const personalRefusal = ambiguousPersonalHeaderRefusal(name, parsed.server, personalNames)
          ?? personalHeaderRefusal(name, parsed.server, personalNames);
        if (personalRefusal) return json(res, 400, { error: personalRefusal });
        const refusal = deps.mcpPolicyRefusal(name, parsed.server);
        if (refusal) return json(res, 403, { error: refusal, code: "managed_policy" });
        deps.persistMcpServers({ ...current, [name]: parsed.server });
        deps.health?.changed(name);
        const previousUrl = isRemoteMcpServer(existing.server) ? existing.server.url : undefined;
        const nextUrl = isRemoteMcpServer(parsed.server) ? parsed.server.url : undefined;
        if (previousUrl !== nextUrl) await deps.mcpOAuth.forget(name).catch(() => undefined);
        if (nextUrl) await deps.probeMcpOAuth([name]);
        return json(res, 200, deps.mcpServerResponse(deps.mcpViewer(auth)));
      } finally {
        deps.releaseMcpConfig();
      }
    }

    return PASS;
  };
}
