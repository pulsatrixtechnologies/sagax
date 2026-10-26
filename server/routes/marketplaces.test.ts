import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { PluginMarketplaces } from "../plugin-marketplaces.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createMarketplaceRoutes, type MarketplaceRouteDeps } from "./marketplaces.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const MEMBER: RequestAuth = { kind: "loopback", trust: "service", scopes: ["admin", "client"] };

interface Installed { key: string; marketplace: string; plugin: string; version?: string; revision?: string; servers: string[]; skills: string[] }

async function serve(auth: RequestAuth, update?: MarketplaceRouteDeps["update"]) {
  const installed: Installed[] = [
    { key: "notes@acme", marketplace: "acme", plugin: "notes", version: "1.0.0", revision: "sha256:old", servers: ["notes"], skills: ["note-taking"] },
  ];
  const audits: Array<Parameters<MarketplaceRouteDeps["audit"]>[1]> = [];
  const updates: string[] = [];
  const store = {
    installed: () => installed,
    list: () => [{ name: "acme" }],
  } as unknown as PluginMarketplaces;
  const routes = [createMarketplaceRoutes({
    store,
    mayManage: (caller) => caller.kind === "loopback" && caller.trust !== "service",
    actor: () => undefined,
    install: async () => ({ status: 200, body: {} }),
    uninstall: async () => ({ status: 200, body: {} }),
    update: update ?? (async (marketplace, plugin) => {
      updates.push(`${plugin}@${marketplace}`);
      installed[0] = { ...installed[0]!, version: "1.1.0", revision: "sha256:new", servers: ["notes", "notes-search"], skills: ["note-taking"] };
      return { status: 200, body: { plugin: installed[0], skipped: [] } };
    }),
    audit: (_auth, row) => { audits.push(row); },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/marketplaces`;
  const post = (path: string, type = "application/json") => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": type }, body: "{}" });
  return { base, post, audits, updates };
}

const SESSION = (principal: string): RequestAuth => ({ kind: "session", scopes: ["client"], session: { principalId: principal } } as unknown as RequestAuth);

/** A fake store that honours the viewer, for the visibility/enforcement route. */
function visibilityStore() {
  const markets: Record<string, { name: string; visibility: "private" | "org"; addedBy?: string }> = {
    alice: { name: "alice", visibility: "private", addedBy: "alice" },
    shared: { name: "shared", visibility: "org", addedBy: "alice" },
  };
  const visible = (m: typeof markets[string], viewer: { principal?: string; seesAll?: boolean }) =>
    m.visibility === "org" || Boolean(viewer.seesAll) || (viewer.principal !== undefined && viewer.principal === m.addedBy);
  return {
    list: (viewer: { principal?: string; seesAll?: boolean } = {}) =>
      Object.values(markets).filter((m) => visible(m, viewer)).map((m) => ({ name: m.name, visibility: m.visibility, mine: viewer.seesAll || viewer.principal === m.addedBy })),
    canAccess: (name: string, viewer: { principal?: string; seesAll?: boolean } = {}) => Boolean(markets[name]) && visible(markets[name]!, viewer),
    record: (name: string) => markets[name],
    setVisibility: async (name: string, visibility: "private" | "org") => { markets[name] = { ...markets[name]!, visibility }; return { name, visibility, mine: true }; },
    installed: () => [],
    refresh: async () => ({}),
    remove: async () => undefined,
  } as unknown as PluginMarketplaces;
}

async function serveVisibility(auth: RequestAuth, viewer: (auth: RequestAuth) => { principal?: string; seesAll?: boolean }, mayShareOrgWide = true) {
  const store = visibilityStore();
  const audits: Array<Parameters<MarketplaceRouteDeps["audit"]>[1]> = [];
  const routes = [createMarketplaceRoutes({
    store, viewer, mayShareOrgWide: () => mayShareOrgWide,
    mayManage: () => true, actor: (a) => (a.kind === "session" ? (a as { session: { principalId: string } }).session.principalId : undefined),
    install: async () => ({ status: 200, body: {} }), uninstall: async () => ({ status: 200, body: {} }),
    update: async () => ({ status: 200, body: {} }), audit: (_a, row) => { audits.push(row); },
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/marketplaces`;
  return { base, audits };
}

describe("marketplace visibility route (close the private-repo leak)", () => {
  it("lists a private marketplace to its author only; org to everyone", async () => {
    const forAlice = await serveVisibility(SESSION("alice"), () => ({ principal: "alice" }));
    expect((await (await fetch(forAlice.base)).json() as { marketplaces: Array<{ name: string }> }).marketplaces.map((m: { name: string }) => m.name).sort()).toEqual(["alice", "shared"]);
    const forBob = await serveVisibility(SESSION("bob"), () => ({ principal: "bob" }));
    expect((await (await fetch(forBob.base)).json() as { marketplaces: Array<{ name: string }> }).marketplaces.map((m: { name: string }) => m.name)).toEqual(["shared"]);
  });

  it("answers 404 when another person reaches a private marketplace (refresh, install, visibility)", async () => {
    const bob = await serveVisibility(SESSION("bob"), () => ({ principal: "bob" }));
    const headers = { "content-type": "application/json" };
    expect((await fetch(`${bob.base}/alice/refresh`, { method: "POST", headers, body: "{}" })).status).toBe(404);
    expect((await fetch(`${bob.base}/alice/plugins/notes`, { method: "POST", headers, body: "{}" })).status).toBe(404);
    expect((await fetch(`${bob.base}/alice/visibility`, { method: "PUT", headers, body: JSON.stringify({ visibility: "org" }) })).status).toBe(404);
  });

  it("lets the author change visibility and writes an audit row", async () => {
    const alice = await serveVisibility(SESSION("alice"), () => ({ principal: "alice" }));
    const res = await fetch(`${alice.base}/alice/visibility`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: "org" }) });
    expect(res.status).toBe(200);
    expect(alice.audits).toEqual([{ action: "marketplace.visibility", target: { kind: "marketplace", id: "alice", name: "alice" }, before: { visibility: "private" }, after: { visibility: "org" } }]);
  });

  it("org-wide is admins only: a non-admin sharing org is refused (403)", async () => {
    const alice = await serveVisibility(SESSION("alice"), () => ({ principal: "alice" }), false);
    const res = await fetch(`${alice.base}/alice/visibility`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: "org" }) });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("marketplace_org_admin_only");
  });

  it("a non-admin keeps control of their own privacy: setting it back to private is allowed", async () => {
    const alice = await serveVisibility(SESSION("alice"), () => ({ principal: "alice" }), false);
    const res = await fetch(`${alice.base}/shared/visibility`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility: "private" }) });
    expect(res.status).toBe(200);
  });

  it("defaults a new marketplace to private and passes the choice through", async () => {
    const added: Array<Record<string, unknown>> = [];
    const store = { list: () => [], canAccess: () => true, add: async (_i: unknown, _a: unknown, opts: Record<string, unknown>) => { added.push(opts); return { name: "x" }; } } as unknown as PluginMarketplaces;
    const routes = [createMarketplaceRoutes({
      store, viewer: () => ({ principal: "alice" }), mayManage: () => true, actor: () => "alice",
      install: async () => ({ status: 200, body: {} }), uninstall: async () => ({ status: 200, body: {} }), update: async () => ({ status: 200, body: {} }), audit: () => {},
    })];
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: SESSION("alice"), json, readBody })) json(res, 404, {});
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/marketplaces`;
    await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "a/b" }) });
    await fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ source: "c/d", visibility: "org" }) });
    expect(added[0]).not.toHaveProperty("visibility");
    expect(added[1]).toMatchObject({ visibility: "org" });
  });
});

describe("marketplace plugin update route", () => {
  it("updates an installed plugin in place and writes one audit row", async () => {
    const { post, audits, updates } = await serve(OWNER);
    const res = await post("/acme/plugins/notes/update");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ plugin: { version: "1.1.0" }, marketplaces: [{ name: "acme" }] });
    expect(updates).toEqual(["notes@acme"]);
    expect(audits).toEqual([{
      action: "plugin.update",
      target: { kind: "plugin", id: "notes@acme", name: "notes" },
      before: { version: "1.0.0", revision: "sha256:old", servers: ["notes"], skills: ["note-taking"] },
      after: { version: "1.1.0", revision: "sha256:new", servers: ["notes", "notes-search"], skills: ["note-taking"] },
    }]);
  });

  it("refuses a plugin that is not installed, without calling the update", async () => {
    const { post, audits, updates } = await serve(OWNER);
    const res = await post("/acme/plugins/other/update");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: "not_installed" });
    expect(updates).toEqual([]);
    expect(audits).toEqual([]);
  });

  it("writes no audit row when the update fails", async () => {
    const { post, audits } = await serve(OWNER, async () => ({ status: 409, body: { error: "MCP servers are already being updated." } }));
    expect((await post("/acme/plugins/notes/update")).status).toBe(409);
    expect(audits).toEqual([]);
  });

  it("is for whoever manages marketplaces, as JSON, by POST", async () => {
    const member = await serve(MEMBER);
    expect((await member.post("/acme/plugins/notes/update")).status).toBe(403);
    expect(member.updates).toEqual([]);
    const owner = await serve(OWNER);
    expect((await owner.post("/acme/plugins/notes/update", "text/plain")).status).toBe(415);
    expect((await fetch(`${owner.base}/acme/plugins/notes/update`)).status).toBe(405);
    expect(owner.updates).toEqual([]);
  });
});
