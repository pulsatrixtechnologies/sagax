// A person's own connections on an organization server (Settings > Mes
// connexions; server/person-connections.ts, server/github-connect.ts).
//
//   GET    /api/me/capabilities   (lot 5 canonical person store)
//   GET    /api/me/connections    (alias until 2027-11-01, Deprecation header)
//          { github: GithubStatus, servers: [listing + auth], sandbox: boolean }
//   POST   /api/me/github/device              start the device flow: { userCode, verificationUri, expiresAt }
//   POST   /api/me/github/token  { token }    connect with a pasted token
//   DELETE /api/me/github                     forget it (here and in the server environment)
//   POST   /api/me/mcp/servers   { name, url, auth?, token?, headerName? } | { name, command, args?, env? }
//   PATCH  /api/me/mcp/servers/:name { enabled }
//   DELETE /api/me/mcp/servers/:name
//   POST   /api/me/mcp/servers/:name/oauth/start      { authorizationUrl, redirectUri }
//   POST   /api/me/mcp/servers/:name/oauth/disconnect
//
// A person without the Sagax permission `apps.ownIntegrations` gets that
// 403 on every change, except signing in again to a server they already
// have (`oauth/start`), so a token can be refreshed.
//
// Only a signed-in person, only for themselves (the session's principal,
// never an id from the request), only on an organization server. Member
// scope (request-auth.ts CLIENT_ALLOW). No answer carries a token.
import type { IncomingMessage } from "node:http";

import { setCapabilityDeprecationHeaders } from "../capability-route-deprecation.ts";
import type { GithubStatus } from "../github-connect.ts";
import type { PersonalMcpListing } from "../person-connections.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface PersonalServerAuth {
  auth: string;
  authError?: string;
  authPending?: boolean;
}

export interface PersonConnectionRouteDeps {
  organization: () => boolean;
  /** The 403 body when this caller lacks `apps.ownIntegrations`, else null.
   * Absent: never refused. */
  ownIntegrationsRefusal?: (auth: RequestAuth) => Record<string, unknown> | null;
  sandboxConfigured: () => boolean;
  github: {
    /** May probe GitHub /user so a dead token is never listed as Connected. */
    status: (principalId: string) => GithubStatus | Promise<GithubStatus>;
    startDevice: (principalId: string) => Promise<unknown>;
    connectToken: (principalId: string, token: string) => Promise<GithubStatus>;
    disconnect: (principalId: string) => Promise<void>;
  };
  servers: {
    list: (principalId: string) => Promise<Array<PersonalMcpListing & Partial<PersonalServerAuth>>>;
    add: (principalId: string, body: unknown) => Promise<void>;
    setEnabled: (principalId: string, name: string, enabled: boolean) => Promise<void>;
    remove: (principalId: string, name: string) => Promise<void>;
    oauthStart: (principalId: string, name: string, req: IncomingMessage, body: unknown, auth: RequestAuth) => Promise<{ status: number; body: Record<string, unknown> }>;
    oauthDisconnect: (principalId: string, name: string) => Promise<void>;
  };
}

/** An error a handler throws for the person to read: `status` and `code`. */
function refusal(error: unknown): { status: number; body: Record<string, unknown> } | null {
  const status = (error as { status?: unknown })?.status;
  const code = (error as { code?: unknown })?.code;
  if (typeof status !== "number" || status < 400 || status > 599) return null;
  return { status, body: { error: error instanceof Error ? error.message : "refused", ...(typeof code === "string" ? { code } : {}) } };
}

export function sessionPrincipal(auth: RequestAuth): string | null {
  const id = auth.kind === "session" ? auth.session.principalId?.trim().toLowerCase() : undefined;
  return id || null;
}

const SERVER_ROUTE = /^\/api\/me\/mcp\/servers\/([a-z][a-z0-9_-]{0,31})(?:\/oauth\/(start|disconnect))?$/;

export function createPersonConnectionRoutes(deps: PersonConnectionRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    // the credential list has its own route (server/routes/github-credentials.ts)
    if (path === "/api/me/github/credentials") return PASS;
    // Lot 5: /api/me/capabilities is the canonical person store route;
    // /api/me/connections and the mcp/github fragments stay as aliases.
    const mine = path === "/api/me/capabilities" || path === "/api/me/connections" || path === "/api/me/github" || path.startsWith("/api/me/github/") || path === "/api/me/mcp/servers" || path.startsWith("/api/me/mcp/servers/");
    if (!mine) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (path !== "/api/me/capabilities") setCapabilityDeprecationHeaders(res, "/api/me/capabilities");
    const principalId = sessionPrincipal(auth);
    if (!deps.organization() || !principalId) {
      return json(res, 404, { error: "Your own connections are kept on an organization server, for a signed-in person.", code: "not_organization" });
    }
    const jsonBody = async (): Promise<unknown> => {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw Object.assign(new Error("content-type must be application/json"), { status: 415 });
      return readBody(req);
    };
    try {
      if (path === "/api/me/connections" || path === "/api/me/capabilities") {
        if (method !== "GET") return json(res, 405, { error: "GET only" });
        return json(res, 200, { github: await deps.github.status(principalId), servers: await deps.servers.list(principalId), sandbox: deps.sandboxConfigured() });
      }
      // Everything below changes the person's connections. Signing in again
      // to a server they already have keeps it working.
      const integrationsRefusal = deps.ownIntegrationsRefusal?.(auth) ?? null;
      if (integrationsRefusal && !(method === "POST" && path.endsWith("/oauth/start"))) return json(res, 403, integrationsRefusal);
      if (path === "/api/me/github/device") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        return json(res, 200, await deps.github.startDevice(principalId) as Record<string, unknown>);
      }
      if (path === "/api/me/github/token") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const body = await jsonBody() as { token?: unknown } | null;
        if (typeof body?.token !== "string") return json(res, 400, { error: "send { token }", code: "invalid_token" });
        return json(res, 200, { github: await deps.github.connectToken(principalId, body.token) });
      }
      if (path === "/api/me/github") {
        if (method !== "DELETE") return json(res, 405, { error: "DELETE only" });
        await deps.github.disconnect(principalId);
        return json(res, 200, { github: await deps.github.status(principalId) });
      }
      if (path === "/api/me/mcp/servers") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        await deps.servers.add(principalId, await jsonBody());
        return json(res, 201, { servers: await deps.servers.list(principalId) });
      }
      const match = SERVER_ROUTE.exec(path);
      if (!match) return json(res, 404, { error: "not found" });
      const [, name, action] = match;
      if (action === "start" || action === "disconnect") {
        if (method !== "POST") return json(res, 405, { error: "POST only" });
        const body = await jsonBody();
        if (action === "disconnect") {
          await deps.servers.oauthDisconnect(principalId, name!);
          return json(res, 200, { servers: await deps.servers.list(principalId) });
        }
        const started = await deps.servers.oauthStart(principalId, name!, req, body, auth);
        return json(res, started.status, started.body);
      }
      if (method === "PATCH") {
        const body = await jsonBody() as { enabled?: unknown } | null;
        if (!body || typeof body.enabled !== "boolean" || Object.keys(body).length !== 1) return json(res, 400, { error: "Only { enabled } can be changed here." });
        await deps.servers.setEnabled(principalId, name!, body.enabled);
        return json(res, 200, { servers: await deps.servers.list(principalId) });
      }
      if (method === "DELETE") {
        await deps.servers.remove(principalId, name!);
        return json(res, 200, { servers: await deps.servers.list(principalId) });
      }
      return json(res, 405, { error: "PATCH or DELETE" });
    } catch (error) {
      const answer = refusal(error);
      if (answer) return json(res, answer.status, answer.body);
      throw error;
    }
  };
}
