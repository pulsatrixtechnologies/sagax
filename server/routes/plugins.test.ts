import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { json, readBody } from "../harness/http.ts";
import type { PluginListing, RegistrySearch } from "../plugin-registry.ts";
import { requiredScope, type RequestAuth } from "../request-auth.ts";
import { createPluginRoutes, pluginServerName, type PluginRouteDeps } from "./plugins.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done)))); });
const OWNER: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const community: PluginListing = {
  id: "registry:io.example/notes", name: "notes", description: "Notes", url: "https://mcp.example.test/mcp", transport: "http",
  domain: "mcp.example.test", auth: "unknown", source: "registry", reviewed: false,
};

const regional: PluginListing = {
  ...community, id: "registry:io.example/crm", url: "https://us.crm.example.test/mcp", domain: "us.crm.example.test",
  regions: [{ id: "us", label: "US", url: "https://us.crm.example.test/mcp" }, { id: "eu", label: "EU", url: "https://eu.crm.example.test/mcp" }],
};

async function serve(auth: RequestAuth, deps: Partial<PluginRouteDeps> = {}) {
  const installs: Array<{ id: string; returnTo?: unknown }> = [];
  const urls: string[] = [];
  const registry: RegistrySearch = {
    search: async () => ({ results: [community, { ...community, id: "registry:io.notion/dup", url: "https://mcp.notion.com/mcp" }], nextCursor: "next", available: true }),
    lookup: async (name) => (name === "io.example/notes" ? community : name === "io.example/crm" ? regional : null),
  };
  const routes = [createPluginRoutes({
    registry,
    installed: async () => [{ kind: "mcp", name: "linear", url: "https://mcp.linear.app/mcp", domain: "mcp.linear.app", enabled: true, auth: "connected", icon: "linear", catalogId: "linear" }],
    mayInstall: (caller) => caller.kind === "loopback" ? caller.trust !== "service" : caller.scopes.includes("admin"),
    install: async (listing, request) => {
      installs.push({ id: listing.id, returnTo: request.returnTo });
      urls.push(listing.url);
      return { status: 201, body: { name: listing.id, auth: "required", authorizationUrl: "https://auth.example.test/authorize" } };
    },
    ...deps,
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plugins`;
  const install = (body: unknown) => fetch(`${base}/install`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { base, install, installs, urls };
}

describe("plugin routes", () => {
  it("connects to the data center the person chose, and refuses one the plugin does not offer", async () => {
    const { install, installs, urls } = await serve(OWNER);
    expect((await install({ id: "registry:io.example/crm", trust: true, region: "eu" })).status).toBe(201);
    expect(installs.at(-1)?.id).toBe("registry:io.example/crm");
    expect(urls.at(-1)).toBe("https://eu.crm.example.test/mcp");
    expect((await install({ id: "registry:io.example/crm", trust: true })).status).toBe(201);
    expect(urls.at(-1)).toBe("https://us.crm.example.test/mcp");
    const refused = await install({ id: "registry:io.example/crm", trust: true, region: "apac" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "unknown_region" });
  });

  it("read as a member; install reaches the handler, which decides (mayInstall)", () => {
    expect(requiredScope("GET", "/api/plugins/search")).toBe("client");
    expect(requiredScope("GET", "/api/plugins/installed")).toBe("client");
    // iOS parity S2: a client session bound to the computer's operator may
    // install; the handler's mayInstall refuses everyone else (see below).
    expect(requiredScope("POST", "/api/plugins/install")).toBe("client");
    expect(requiredScope("POST", "/api/plugins/uninstall")).toBe("admin");
  });

  it("lists featured first, community without duplicates, and what is installed", async () => {
    const { base } = await serve(OWNER);
    const first = await (await fetch(`${base}/search`)).json() as { featured: Array<{ id: string; installed: boolean; reviewed: boolean }>; results: Array<{ id: string }>; nextCursor: string; registryAvailable: boolean };
    expect(first.featured.length).toBeGreaterThanOrEqual(10);
    expect(first.featured.find((listing) => listing.id === "linear")).toMatchObject({ installed: true, reviewed: true });
    expect(first.featured.find((listing) => listing.id === "notion")).toMatchObject({ installed: false });
    expect(first.results.map((listing) => listing.id)).toEqual(["registry:io.example/notes"]);
    expect(first).toMatchObject({ nextCursor: "next", registryAvailable: true });
    const later = await (await fetch(`${base}/search?q=notes&cursor=next`)).json() as { featured: unknown[] };
    expect(later.featured).toEqual([]);
    const installed = await (await fetch(`${base}/installed`)).json() as { count: number; plugins: Array<{ icon?: string }> };
    expect(installed).toMatchObject({ count: 1, plugins: [{ kind: "mcp", icon: "linear" }] });
  });

  it("installs a featured plugin and hands back its sign-in", async () => {
    const { install, installs } = await serve(OWNER);
    const res = await install({ id: "notion", returnTo: "sagax://oauth-done" });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ authorizationUrl: "https://auth.example.test/authorize" });
    expect(installs).toEqual([{ id: "notion", returnTo: "sagax://oauth-done" }]);
    expect((await install({ id: "nope" })).status).toBe(404);
    expect((await install({})).status).toBe(400);
  });

  it("asks trust for a community server and refuses one that needs a key", async () => {
    const { install, installs } = await serve(OWNER);
    const untrusted = await install({ id: "registry:io.example/notes" });
    expect(untrusted.status).toBe(400);
    expect(await untrusted.json()).toMatchObject({ code: "trust_required" });
    expect((await install({ id: "registry:io.example/notes", trust: true })).status).toBe(201);
    expect((await install({ id: "registry:io.example/missing", trust: true })).status).toBe(404);
    expect(installs.map((entry) => entry.id)).toEqual(["registry:io.example/notes"]);
    const keyed = await serve(OWNER, { registry: { search: async () => ({ results: [], nextCursor: null, available: true }), lookup: async () => ({ ...community, auth: "headers" }) } });
    expect(await (await keyed.install({ id: "registry:io.example/notes", trust: true })).json()).toMatchObject({ code: "headers_required" });
  });

  it("refuses an install from a member or a local service", async () => {
    const member: RequestAuth = { kind: "session", via: "bearer", scopes: ["client"], session: { id: "s", label: "p", scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never };
    expect((await (await serve(member)).install({ id: "notion" })).status).toBe(403);
    expect((await (await serve({ kind: "loopback", scopes: ["client"], trust: "service" })).install({ id: "notion" })).status).toBe(403);
  });

  it("names the MCP server after the plugin, avoiding taken names", () => {
    expect(pluginServerName({ id: "notion" }, new Set())).toBe("notion");
    expect(pluginServerName({ id: "notion" }, new Set(["notion", "notion-2"]))).toBe("notion-3");
    expect(pluginServerName({ id: "registry:io.github.Some_Org/My.Server" }, new Set())).toBe("my-server");
    expect(pluginServerName({ id: "registry:x/123" }, new Set())).toBe("plugin");
  });
});
