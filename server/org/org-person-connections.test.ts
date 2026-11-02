import { describe, expect, it } from "vitest";

import { createOrgPersonConnectionRoutes, orgConnectionListing, type OrgPersonConnectionsDeps, type RemovedConnection } from "./org-person-connections.ts";
import type { PersonalMcpServer } from "../person-connections.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext } from "../routes/table.ts";
import type { SessionRecord } from "../sessions.ts";

const ADMIN = "pr_11111111-1111-4111-8111-111111111111";
const MEMBER = "pr_33333333-3333-4333-8333-333333333333";
const PERSON = "pr_22222222-2222-4222-8222-222222222222";
const TOKEN = "t-secret-token-000";
const ENV = "k-env-secret";
const ARG = "--secret-arg-value";
const USER_CODE = "WDJB-SECRET";
const QUERY = "query-secret";

const session = (principalId: string, scopes: ("admin" | "client")[]): RequestAuth => ({
  kind: "session", via: "cookie", scopes,
  session: { id: `s-${principalId}`, label: "web", scopes, createdAt: 1, lastSeenAt: 1, principalId } as SessionRecord,
});
const admin = session(ADMIN, ["admin"]);
const member = session(MEMBER, ["client"]);
const loopbackOwner: RequestAuth = { kind: "loopback", scopes: ["admin"] };
const loopbackService: RequestAuth = { kind: "loopback", scopes: ["admin"], trust: "service" };

const remote: PersonalMcpServer = {
  kind: "remote", type: "http", url: `https://mcp.example.test/mcp?access_token=${QUERY}`, auth: "token",
  headerName: "X-Api-Key", token: TOKEN, enabled: true, addedAt: 10,
};
const stdio: PersonalMcpServer = {
  kind: "stdio", command: "fake-mcp", args: [ARG], env: { API_KEY: ENV }, runsIn: "environment", enabled: true, addedAt: 20,
};

function harness(overrides: Partial<OrgPersonConnectionsDeps> = {}) {
  const servers: Record<string, PersonalMcpServer> = { notes: { ...remote }, tools: { ...stdio } };
  let github: "connected" | "pending" | "none" = "connected";
  const plugins = [{
    botId: "bob-bot", botName: "Bobby",
    plugins: [{ key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", enabled: true, installedAt: 30, updatedAt: 30, removed: [], declaredMcpServers: [] }],
  }];
  const stopped: string[] = [];
  const audits: RemovedConnection[][] = [];
  const route = createOrgPersonConnectionRoutes({
    organization: true,
    isAdmin: (auth) => {
      if (auth.kind === "loopback") return auth.trust !== "service";
      return auth.kind === "session" && auth.session.principalId === ADMIN;
    },
    person: (id) => (id === PERSON ? { id } : null),
    githubStatus: () => (github === "connected"
      ? { state: "connected", deviceFlow: true, login: "bob-gh", via: "device", connectedAt: 5, scopes: ["repo"] }
      : github === "pending"
        ? { state: "pending", deviceFlow: true, userCode: USER_CODE, verificationUri: "https://github.com/login/device", expiresAt: 99 }
        : { state: "none", deviceFlow: true }),
    servers: () => ({ ...servers }),
    lastUsed: (_id, name) => (name === "tools" ? 40 : undefined),
    plugins: () => plugins.map((bot) => ({ ...bot, plugins: bot.plugins.map((plugin) => ({ ...plugin })) })),
    stopMcp: (_id, server) => { stopped.push(server ?? "*"); },
    removeMcp: async (_id, name) => { if (!servers[name]) return false; delete servers[name]; return true; },
    disconnectGithub: async () => {
      if (github === "none") return { removed: false };
      const login = github === "connected" ? "bob-gh" : undefined;
      github = "none";
      return { removed: true, ...(login ? { login } : {}) };
    },
    removePlugin: async (_id, botId, key) => {
      const bot = plugins.find((entry) => entry.botId === botId);
      const index = bot?.plugins.findIndex((entry) => entry.key === key) ?? -1;
      if (!bot || index < 0) return false;
      bot.plugins.splice(index, 1);
      return true;
    },
    audit: (_auth, _id, removed) => { audits.push(removed); },
    ...overrides,
  });
  const call = async (path: string, auth: RequestAuth, body?: unknown, method = "GET") => {
    const out: { status?: number; body?: unknown } = {};
    const ctx = {
      req: {}, res: { setHeader: () => {}, headersSent: false, writableEnded: false },
      url: new URL(`http://localhost${path}`), path, method, auth,
      json: (_res: unknown, status: number, payload: unknown) => { out.status = status; out.body = payload; },
      readBody: async () => body,
    } as unknown as RouteContext;
    const result = await route(ctx);
    return { ...out, passed: result === PASS, text: JSON.stringify(out.body ?? null) };
  };
  return { call, stopped, audits, servers, plugins, setGithub: (next: typeof github) => { github = next; } };
}

const path = `/api/org/people/${PERSON}/connections`;

describe("admin list and revoke of a person's connections", () => {
  it("lets other paths through", async () => {
    const h = harness();
    expect((await h.call("/api/org/people", admin)).passed).toBe(true);
    expect((await h.call(`/api/me/connections`, admin)).passed).toBe(true);
  });

  it("an organization admin lists names and dates, never a secret", async () => {
    const h = harness();
    const out = await h.call(path, admin);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      principalId: PERSON,
      connections: [
        { kind: "github", state: "connected", login: "bob-gh", via: "device", createdAt: 5 },
        { kind: "mcp", name: "notes", mcpKind: "remote", detail: "mcp.example.test", auth: "token", createdAt: 10, enabled: true },
        { kind: "mcp", name: "tools", mcpKind: "stdio", detail: "fake-mcp", createdAt: 20, lastUsedAt: 40 },
        { kind: "plugin", botId: "bob-bot", key: "reviewer@acme-tools", name: "reviewer", marketplace: "acme-tools", createdAt: 30 },
      ],
    });
    for (const secret of [TOKEN, ENV, ARG, USER_CODE, QUERY, "X-Api-Key", "access_token"]) expect(out.text).not.toContain(secret);
  });

  it("a pending GitHub sign-in is listed without its device code", () => {
    const listing = orgConnectionListing({
      principalId: PERSON,
      github: { state: "pending", deviceFlow: true, userCode: USER_CODE, verificationUri: "https://github.com/login/device", expiresAt: 99 },
      servers: {}, lastUsed: () => undefined, plugins: [],
    });
    expect(listing).toEqual({ principalId: PERSON, connections: [{ kind: "github", state: "pending" }] });
    expect(JSON.stringify(listing)).not.toContain(USER_CODE);
  });

  it("a refused GitHub token is listed as error, never connected", () => {
    const listing = orgConnectionListing({
      principalId: PERSON,
      github: { state: "error", deviceFlow: true, error: "GitHub refused this token. Connect again.", login: "bob-gh" },
      servers: {}, lastUsed: () => undefined, plugins: [],
    });
    expect(listing).toEqual({ principalId: PERSON, connections: [{ kind: "github", state: "error", login: "bob-gh" }] });
  });

  it("a member is refused", async () => {
    const h = harness();
    const listed = await h.call(path, member);
    const revoked = await h.call(`${path}/revoke`, member, { all: true }, "POST");
    expect(listed.status).toBe(403);
    expect(revoked.status).toBe(403);
    expect((listed.body as { code: string }).code).toBe("not_org_admin");
    expect(h.audits).toEqual([]);
    expect(h.stopped).toEqual([]);
  });

  it("a service loopback is refused and an owner loopback is allowed", async () => {
    const h = harness();
    const service = await h.call(path, loopbackService);
    expect(service.status).toBe(403);
    expect((service.body as { code: string }).code).toBe("not_org_admin");
    const owner = await h.call(path, loopbackOwner);
    expect(owner.status).toBe(200);
    expect(h.audits).toEqual([]);
  });

  it("a solo server answers identity_perspicax", async () => {
    const h = harness({ organization: false, isAdmin: () => true });
    const out = await h.call(path, admin);
    expect(out.status).toBe(403);
    expect((out.body as { code: string }).code).toBe("identity_perspicax");
  });

  it("revokes one MCP server: the child stops, the credential is deleted, it is audited", async () => {
    const h = harness();
    const missing = await h.call(`${path}/revoke`, admin, { kind: "mcp", name: "nope" }, "POST");
    expect(missing.status).toBe(404);
    expect(h.audits).toEqual([]);
    expect(h.stopped).toEqual([]);
    const out = await h.call(`${path}/revoke`, admin, { kind: "mcp", name: "tools" }, "POST");
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ removed: [{ kind: "mcp", name: "tools" }] });
    expect(h.stopped).toEqual(["tools"]);
    expect(h.servers.tools).toBeUndefined();
    expect(h.servers.notes).toBeTruthy();
    expect(h.audits).toEqual([[{ kind: "mcp", name: "tools" }]]);
    expect(out.text).not.toContain(ENV);
  });

  it("revokes GitHub, including a pending sign-in, and stops MCP children that could hold the token", async () => {
    const h = harness();
    const out = await h.call(`${path}/revoke`, admin, { kind: "github" }, "POST");
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ removed: [{ kind: "github", name: "bob-gh" }] });
    expect(h.stopped).toEqual(["*"]);
    const again = await h.call(`${path}/revoke`, admin, { kind: "github" }, "POST");
    expect(again.status).toBe(404);
    expect(h.audits).toHaveLength(1);
    h.setGithub("pending");
    const pending = await h.call(`${path}/revoke`, admin, { kind: "github" }, "POST");
    expect(pending.status).toBe(200);
    expect(pending.body).toEqual({ removed: [{ kind: "github" }] });
    expect(pending.text).not.toContain(USER_CODE);
  });

  it("revokes one plugin on a bot the person owns", async () => {
    const h = harness();
    const missing = await h.call(`${path}/revoke`, admin, { kind: "plugin", botId: "other", key: "reviewer@acme-tools" }, "POST");
    expect(missing.status).toBe(404);
    expect(h.audits).toEqual([]);
    const out = await h.call(`${path}/revoke`, admin, { kind: "plugin", botId: "bob-bot", key: "reviewer@acme-tools" }, "POST");
    expect(out.status).toBe(200);
    expect(h.plugins[0]!.plugins).toEqual([]);
    expect(h.audits[0]).toEqual([{ kind: "plugin", botId: "bob-bot", key: "reviewer@acme-tools", name: "reviewer" }]);
  });

  it("revokes everything, and an empty list is not audited", async () => {
    const h = harness();
    const out = await h.call(`${path}/revoke`, admin, { all: true }, "POST");
    expect(out.status).toBe(200);
    const removed = (out.body as { removed: RemovedConnection[] }).removed;
    expect(removed.map((entry) => entry.kind === "mcp" ? entry.name : entry.kind)).toEqual(["github", "notes", "tools", "plugin"]);
    expect(h.stopped[0]).toBe("*");
    expect(h.servers).toEqual({});
    expect(h.plugins[0]!.plugins).toEqual([]);
    expect(out.text).not.toContain(TOKEN);
    expect(out.text).not.toContain(ENV);
    const empty = harness();
    empty.setGithub("none");
    empty.servers.notes = undefined as never;
    delete empty.servers.notes;
    delete empty.servers.tools;
    empty.plugins[0]!.plugins = [];
    const none = await empty.call(`${path}/revoke`, admin, { all: true }, "POST");
    expect(none.status).toBe(200);
    expect(none.body).toEqual({ removed: [] });
    expect(empty.audits).toEqual([]);
  });

  it("unknown person 404, wrong method 405, bad body 400", async () => {
    const h = harness();
    expect((await h.call(`/api/org/people/${ADMIN}/connections`, admin)).status).toBe(404);
    expect((await h.call(path, admin, undefined, "POST")).status).toBe(405);
    expect((await h.call(`${path}/revoke`, admin, undefined, "GET")).status).toBe(405);
    expect((await h.call(`${path}/revoke`, admin, {}, "POST")).status).toBe(400);
    expect((await h.call(`${path}/revoke`, admin, { all: true, kind: "github" }, "POST")).status).toBe(400);
    expect(h.audits).toEqual([]);
  });
});
