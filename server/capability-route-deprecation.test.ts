import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { CAPABILITY_ROUTE_DEPRECATION } from "../shared/capability-stores.ts";
import { capabilityRouteAliasActive, setCapabilityDeprecationHeaders } from "./capability-route-deprecation.ts";
import { json, readBody } from "./harness/http.ts";
import type { RequestAuth } from "./request-auth.ts";
import { createPersonConnectionRoutes } from "./routes/person-connections.ts";
import { dispatchRoutes, type RouteHandler } from "./routes/table.ts";

describe("capability route deprecation", () => {
  it("marks the alias window open through 2027-11-01", () => {
    expect(capabilityRouteAliasActive(Date.parse("2026-11-01T00:00:00Z"))).toBe(true);
    expect(capabilityRouteAliasActive(Date.parse("2027-10-31T23:00:00Z"))).toBe(true);
    expect(capabilityRouteAliasActive(Date.parse("2027-11-01T00:00:01Z"))).toBe(false);
  });

  it("sets Deprecation, Link and Warning once", () => {
    const headers = new Map<string, string | number | readonly string[]>();
    const res = {
      getHeader: (name: string) => headers.get(name.toLowerCase()),
      setHeader: (name: string, value: string | number | readonly string[]) => {
        headers.set(name.toLowerCase(), value);
      },
    };
    setCapabilityDeprecationHeaders(res as never, "/api/me/capabilities");
    setCapabilityDeprecationHeaders(res as never, "/api/me/capabilities");
    expect(headers.get("deprecation")).toBe(CAPABILITY_ROUTE_DEPRECATION.headerValue);
    expect(String(headers.get("link"))).toContain("/api/me/capabilities");
    expect(String(headers.get("warning"))).toContain("2027-11-01");
  });
});

describe("person connection route aliases", () => {
  const servers: Server[] = [];
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((done) => server.close(() => done()))));
  });

  const member = (principalId: string): RequestAuth => ({
    kind: "session", via: "cookie", scopes: ["client"],
    session: { id: principalId, principalId, label: principalId, scopes: ["client"], createdAt: 0, expiresAt: 0, lastUsedAt: 0 } as never,
  });

  async function serve(routes: RouteHandler[], auth: RequestAuth): Promise<string> {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      try {
        if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) {
          json(res, 404, { from: "inline" });
        }
      } catch (error) {
        json(res, 500, { error: String(error) });
      }
    });
    servers.push(server);
    await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("serves /api/me/capabilities and deprecates /api/me/connections", async () => {
    const routes = [createPersonConnectionRoutes({
      organization: () => true,
      sandboxConfigured: () => true,
      github: {
        status: () => ({ state: "connected", login: "alice", deviceFlow: false, via: "token", connectedAt: 1 }),
        startDevice: async () => ({ userCode: "x" }),
        connectToken: async () => ({ state: "connected", login: "alice", deviceFlow: false, via: "token", connectedAt: 1 }),
        disconnect: async () => undefined,
      },
      servers: {
        list: async () => [],
        add: async () => undefined,
        setEnabled: async () => undefined,
        remove: async () => undefined,
        oauthStart: async () => ({ status: 200, body: {} }),
        oauthDisconnect: async () => undefined,
      },
    })];
    const base = await serve(routes, member("pr_alice"));

    const canonical = await fetch(`${base}/api/me/capabilities`);
    expect(canonical.status).toBe(200);
    expect(canonical.headers.get("deprecation")).toBeNull();
    expect(await canonical.json()).toMatchObject({ github: { login: "alice" }, servers: [] });

    const legacy = await fetch(`${base}/api/me/connections`);
    expect(legacy.status).toBe(200);
    expect(legacy.headers.get("deprecation")).toBe(CAPABILITY_ROUTE_DEPRECATION.headerValue);
    expect(legacy.headers.get("link")).toContain("/api/me/capabilities");
    expect(await legacy.json()).toMatchObject({ github: { login: "alice" } });
  });
});
