import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import {
  createMcpServersHttpRoutes,
  type McpServersHttpDeps,
} from "./mcp-servers-http.ts";
import type { RouteContext } from "./table.ts";
import { PASS } from "./table.ts";

const admin: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["admin"],
  session: {
    id: "s1",
    label: "web",
    scopes: ["admin"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_admin",
  } as never,
};

const member: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s2",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_member",
  } as never,
};

function harness(over: Partial<McpServersHttpDeps> = {}) {
  let servers: Record<string, unknown> = {
    notes: { url: "https://mcp.example.test/mcp", headers: {}, enabled: true },
  };
  let busy = false;
  let probes = 0;
  const forgotten: string[] = [];
  const deps: McpServersHttpDeps = {
    mcpServers: () => servers,
    mcpViewer: () => "pr_admin",
    mcpServerResponse: () => ({ servers: Object.keys(servers).map((name) => ({ name })) }),
    mcpServerNamesResponse: () => ({ servers: Object.keys(servers).map((name) => ({ name, enabled: true })) }),
    probeMcpOAuth: async () => undefined,
    mcpOAuth: {
      status: () => ({ auth: "none" }),
      pendingFor: () => false,
      probe: async () => ({ auth: "none" }),
      disconnect: async () => undefined,
      forget: async (name) => { forgotten.push(name); },
      refresh: async () => false,
      withAuthHeaders: (s) => s,
      vault: { accounts: () => [] },
    },
    remoteMcpServers: (names) => {
      const out: Record<string, { url: string; headers: Record<string, string>; enabled: boolean }> = {};
      for (const [name, raw] of Object.entries(servers)) {
        if (names && !names.includes(name)) continue;
        if (raw && typeof raw === "object" && "url" in raw) out[name] = raw as never;
      }
      return out as never;
    },
    managedPolicy: { mcpAllowed: () => true },
    mcpPolicyRefusal: () => undefined,
    persistMcpServers: (next) => { servers = next; },
    bots: () => [],
    patchBot: () => null,
    broadcast: () => undefined,
    wireBot: (bot) => bot,
    startMcpSignIn: async () => ({ status: 200, body: { authorizationUrl: "https://auth.example.test" } }),
    personalMcpNamesForGuard: () => new Set(),
    acquireMcpConfig: () => (busy ? false : (busy = true)),
    releaseMcpConfig: () => { busy = false; },
    mcpProbesInFlight: () => probes,
    beginMcpProbe: () => { probes += 1; },
    endMcpProbe: () => { probes -= 1; },
    MAX_CONCURRENT_MCP_PROBES: 2,
    mcpServerBody: (body) => {
      const out: Record<string, unknown> = {};
      if (!body || typeof body !== "object") return out;
      const record = body as Record<string, unknown>;
      for (const key of ["command", "args", "env", "type", "url", "headers", "oauth", "enabled", "resultBudget"]) {
        if (record[key] !== undefined) out[key] = record[key];
      }
      return out;
    },
    identityKind: () => "sagax",
    ORG_HOST_COMMAND_REFUSAL: "org host command refused",
    sharedMcpPersonalRefusal: () => null,
    sessionsIsLive: () => true,
    callerCan: () => false,
    ...over,
  };
  const route = createMcpServersHttpRoutes(deps);
  const call = async (
    method: string,
    path: string,
    opts: { body?: unknown; auth?: RequestAuth; search?: string; contentType?: string } = {},
  ) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const out = await route({
      req: { headers: { "content-type": opts.contentType ?? "application/json" } } as RouteContext["req"],
      res: {
        setHeader: () => undefined,
        once: () => undefined,
        off: () => undefined,
        writableEnded: false,
      } as unknown as ServerResponse,
      url: new URL(`http://local${path}${opts.search ?? ""}`),
      path,
      method,
      auth: opts.auth ?? admin,
      json: ((_res, status, payload) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
      readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
    });
    return { out, sent: sent[0], forgotten, servers: () => servers, setBusy: (v: boolean) => { busy = v; }, setProbes: (n: number) => { probes = n; } };
  };
  return { call, forgotten, servers: () => servers, setBusy: (v: boolean) => { busy = v; }, setProbes: (n: number) => { probes = n; }, deps };
}

describe("createMcpServersHttpRoutes", () => {
  it("PASSes foreign paths and /rename", async () => {
    const h = harness();
    expect((await h.call("GET", "/api/config")).out).toBe(PASS);
    expect((await h.call("POST", "/api/mcp/servers/notes/rename", { body: { to: "x" } })).out).toBe(PASS);
    expect((await h.call("GET", "/api/mcp/other")).out).toBe(PASS);
  });

  it("GET lists servers; a non-admin without host.shell gets the names view", async () => {
    const names = vi.fn(() => ({ servers: [{ name: "notes", enabled: true }] }));
    const full = vi.fn(() => ({ servers: [{ name: "notes" }] }));
    const h = harness({ mcpServerNamesResponse: names, mcpServerResponse: full });
    expect((await h.call("GET", "/api/mcp/servers")).sent).toEqual({ status: 200, body: { servers: [{ name: "notes" }] } });
    expect(full).toHaveBeenCalled();
    const memberView = await h.call("GET", "/api/mcp/servers", { auth: member });
    expect(memberView.sent).toEqual({ status: 200, body: { servers: [{ name: "notes", enabled: true }] } });
    expect(names).toHaveBeenCalled();
  });

  it("POST creates a remote server; refuses policy and busy writer", async () => {
    const h = harness();
    const created = await h.call("POST", "/api/mcp/servers", {
      body: { name: "docs", url: "https://docs.example.test/mcp", headers: {} },
    });
    expect(created.sent?.status).toBe(201);
    expect(Object.keys(h.servers())).toContain("docs");
    expect(h.forgotten).toContain("docs");

    expect((await h.call("POST", "/api/mcp/servers", {
      body: { name: "notes", url: "https://n.example.test/mcp", headers: {} },
    })).sent?.status).toBe(409);

    const refused = harness({
      mcpPolicyRefusal: () => "Not approved.",
    });
    expect((await refused.call("POST", "/api/mcp/servers", {
      body: { name: "blocked", url: "https://b.example.test/mcp", headers: {} },
    })).sent).toEqual({ status: 403, body: { error: "Not approved.", code: "managed_policy" } });

    h.setBusy(true);
    expect((await h.call("POST", "/api/mcp/servers", {
      body: { name: "busy", url: "https://busy.example.test/mcp", headers: {} },
    })).sent?.status).toBe(409);
  });

  it("POST import refuses an empty paste and a dead session", async () => {
    const h = harness();
    expect((await h.call("POST", "/api/mcp/servers/import", { body: { json: "" } })).sent?.status).toBe(400);
    const dead = harness({ sessionsIsLive: () => false });
    expect((await dead.call("POST", "/api/mcp/servers/import", {
      body: { json: '{"mcpServers":{"x":{"url":"https://x.example.test/mcp","headers":{}}}}' },
      auth: member,
    })).sent?.status).toBe(401);
  });

  it("PATCH toggles enabled; DELETE removes; PUT refuses org host command", async () => {
    const h = harness();
    expect((await h.call("PATCH", "/api/mcp/servers/notes", { body: { enabled: false } })).sent?.status).toBe(200);
    expect((h.servers().notes as { enabled: boolean }).enabled).toBe(false);

    expect((await h.call("DELETE", "/api/mcp/servers/notes")).sent?.status).toBe(200);
    expect(h.servers().notes).toBeUndefined();

    const org = harness({ identityKind: () => "perspicax" });
    expect((await org.call("POST", "/api/mcp/servers", {
      body: { name: "local", command: "npx", args: ["-y", "x"] },
    })).sent).toEqual({
      status: 403,
      body: { error: "org host command refused", code: "org_host_command" },
    });
  });

  it("OAuth status and start; probe refuses unmanaged; test hits probe limit", async () => {
    const h = harness();
    expect((await h.call("GET", "/api/mcp/servers/notes/oauth/status")).sent?.status).toBe(200);
    expect((await h.call("POST", "/api/mcp/servers/notes/oauth/start", { body: {} })).sent).toEqual({
      status: 200,
      body: { authorizationUrl: "https://auth.example.test" },
    });

    const blocked = harness({ managedPolicy: { mcpAllowed: () => false }, mcpPolicyRefusal: () => "blocked" });
    expect((await blocked.call("POST", "/api/mcp/servers/notes/oauth/probe", { body: {} })).sent).toEqual({
      status: 403,
      body: { error: "blocked", code: "managed_policy" },
    });

    h.setProbes(2);
    expect((await h.call("POST", "/api/mcp/servers/notes/test", { body: {} })).sent?.status).toBe(429);
  });
});
