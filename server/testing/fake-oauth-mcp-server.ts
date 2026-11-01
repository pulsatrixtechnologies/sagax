// A local MCP server behind a tiny OAuth 2.1 authorization server, for tests
// of server/mcp-oauth.ts. No network: everything listens on 127.0.0.1. It
// checks what a real server would (PKCE S256, redirect URI, resource) and
// records what it saw so a test can prove each step. Every value is fake.
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/** One programmed answer for the next refresh_token grant. `"ok"` issues
 * tokens as usual; `{ ok: true, delayMs }` does the same after a pause; a
 * status sends that HTTP answer (and optional body). */
export type FakeRefreshAnswer =
  | "ok"
  | { ok: true; delayMs?: number }
  | { status: number; body?: Record<string, unknown>; delayMs?: number };

export interface FakeOAuthMcpOptions {
  /** where the 401 points: the WWW-Authenticate header, or only well-known */
  metadataHint?: "header" | "wellknown";
  /** publish authorization server metadata as RFC 8414 or OIDC discovery */
  asMetadata?: "oauth" | "oidc";
  /** offer Dynamic Client Registration */
  registration?: boolean;
  /** seconds an access token lives */
  accessTtl?: number;
  /** answer every refresh with invalid_grant */
  refuseRefresh?: boolean;
  /** claim a different origin for the protected resource */
  foreignResource?: boolean;
  /** leave S256 out of code_challenge_methods_supported */
  noS256?: boolean;
  /** Queued answers for refresh_token grants (consumed in order). After the
   * queue is empty, behaviour falls back to refuseRefresh / valid refresh. */
  refreshAnswers?: FakeRefreshAnswer[];
}

export interface FakeOAuthMcp {
  base: string;
  mcpUrl: string;
  issuer: string;
  registrations: Array<Record<string, unknown>>;
  tokenRequests: Array<Record<string, string>>;
  revoked: string[];
  mcpAuthorizations: string[];
  validAccess: Set<string>;
  /** Queue more programmed refresh answers after start. */
  queueRefresh(answer: FakeRefreshAnswer): void;
  /** What the user's browser does at the authorization endpoint: consent,
   * then follow the redirect. Returns the callback URL with code and state. */
  authorize(authorizationUrl: string): Promise<URL>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

export async function startFakeOAuthMcp(options: FakeOAuthMcpOptions = {}): Promise<FakeOAuthMcp> {
  const hint = options.metadataHint ?? "header";
  const registrations: FakeOAuthMcp["registrations"] = [];
  const tokenRequests: FakeOAuthMcp["tokenRequests"] = [];
  const revoked: string[] = [];
  const mcpAuthorizations: string[] = [];
  const validAccess = new Set<string>();
  const validRefresh = new Set<string>();
  const codes = new Map<string, { challenge: string; redirectUri: string; clientId: string; resource: string }>();
  const refreshAnswers: FakeRefreshAnswer[] = [...(options.refreshAnswers ?? [])];
  let counter = 0;
  let base = "";

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", base);
      const send = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        res.writeHead(status, { "content-type": "application/json", ...headers }).end(JSON.stringify(body));
      };
      if (url.pathname === "/mcp" && req.method === "POST") {
        const authorization = req.headers.authorization ?? "";
        mcpAuthorizations.push(authorization);
        const token = /^Bearer (.+)$/.exec(authorization)?.[1];
        if (!token || !validAccess.has(token)) {
          const challenge = hint === "header"
            ? `Bearer error="invalid_token", resource_metadata="${base}/.well-known/oauth-protected-resource/mcp", scope="notes:read"`
            : "Bearer";
          send(401, { error: "invalid_token" }, { "www-authenticate": challenge });
          return;
        }
        const frame = JSON.parse((await readBody(req)) || "{}") as { id?: unknown; method?: unknown };
        if (frame.method === "initialize") {
          send(200, { jsonrpc: "2.0", id: frame.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-oauth-mcp", version: "1" } } });
          return;
        }
        if (frame.method === "tools/list") {
          send(200, { jsonrpc: "2.0", id: frame.id, result: { tools: [{ name: "read_notes", description: "Read saved notes" }] } });
          return;
        }
        res.writeHead(202).end();
        return;
      }
      if (req.method === "GET" && url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        send(200, {
          resource: options.foreignResource ? "https://elsewhere.example/mcp" : `${base}/mcp`,
          authorization_servers: [`${base}/as`],
          scopes_supported: ["notes:read"],
        });
        return;
      }
      const asMetadataPath = options.asMetadata === "oidc" ? "/.well-known/openid-configuration/as" : "/.well-known/oauth-authorization-server/as";
      if (req.method === "GET" && url.pathname === asMetadataPath) {
        send(200, {
          issuer: `${base}/as`,
          authorization_endpoint: `${base}/as/authorize`,
          token_endpoint: `${base}/as/token`,
          ...(options.registration === false ? {} : { registration_endpoint: `${base}/as/register` }),
          revocation_endpoint: `${base}/as/revoke`,
          response_types_supported: ["code"],
          code_challenge_methods_supported: options.noS256 ? ["plain"] : ["S256"],
          token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/as/register") {
        const body = JSON.parse(await readBody(req)) as Record<string, unknown>;
        registrations.push(body);
        send(201, { client_id: `client-${registrations.length}`, redirect_uris: body.redirect_uris, token_endpoint_auth_method: "none" });
        return;
      }
      if (req.method === "GET" && url.pathname === "/as/authorize") {
        const q = url.searchParams;
        if (q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256" || !q.get("code_challenge") || !q.get("state")) {
          send(400, { error: "invalid_request" });
          return;
        }
        const code = `code-${++counter}`;
        codes.set(code, { challenge: q.get("code_challenge")!, redirectUri: q.get("redirect_uri")!, clientId: q.get("client_id")!, resource: q.get("resource") ?? "" });
        const back = new URL(q.get("redirect_uri")!);
        back.searchParams.set("code", code);
        back.searchParams.set("state", q.get("state")!);
        res.writeHead(302, { location: back.toString() }).end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/as/token") {
        const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
        tokenRequests.push(form);
        const issue = () => {
          const access = `fake-access-${++counter}`;
          const refresh = `fake-refresh-${counter}`;
          validAccess.add(access);
          validRefresh.add(refresh);
          send(200, { access_token: access, token_type: "Bearer", expires_in: options.accessTtl ?? 3600, refresh_token: refresh, scope: "notes:read" });
        };
        if (form.grant_type === "authorization_code") {
          const entry = codes.get(form.code ?? "");
          codes.delete(form.code ?? "");
          const verified = entry && createHash("sha256").update(form.code_verifier ?? "").digest("base64url") === entry.challenge;
          if (!entry || !verified || entry.redirectUri !== form.redirect_uri || entry.clientId !== form.client_id || entry.resource !== form.resource) {
            send(400, { error: "invalid_grant" });
            return;
          }
          issue();
          return;
        }
        if (form.grant_type === "refresh_token") {
          const programmed = refreshAnswers.shift();
          if (programmed && typeof programmed === "object" && "status" in programmed) {
            if (programmed.delayMs) await new Promise((resolve) => setTimeout(resolve, programmed.delayMs));
            send(programmed.status, programmed.body ?? { error: "server_error" });
            return;
          }
          if (options.refuseRefresh || !validRefresh.has(form.refresh_token ?? "")) {
            send(400, { error: "invalid_grant", error_description: "refresh token revoked" });
            return;
          }
          if (programmed && typeof programmed === "object" && programmed.ok && programmed.delayMs) {
            await new Promise((resolve) => setTimeout(resolve, programmed.delayMs));
          }
          validRefresh.delete(form.refresh_token!);
          issue();
          return;
        }
        send(400, { error: "unsupported_grant_type" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/as/revoke") {
        const form = Object.fromEntries(new URLSearchParams(await readBody(req)));
        if (form.token) {
          revoked.push(form.token);
          validAccess.delete(form.token);
          validRefresh.delete(form.token);
        }
        res.writeHead(200).end();
        return;
      }
      send(404, { error: "not_found" });
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    mcpUrl: `${base}/mcp`,
    issuer: `${base}/as`,
    registrations,
    tokenRequests,
    revoked,
    mcpAuthorizations,
    validAccess,
    queueRefresh(answer: FakeRefreshAnswer) {
      refreshAnswers.push(answer);
    },
    async authorize(authorizationUrl: string) {
      const response = await fetch(authorizationUrl, { redirect: "manual" });
      const location = response.headers.get("location");
      if (response.status !== 302 || !location) throw new Error(`authorize failed: ${response.status}`);
      return new URL(location);
    },
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}
