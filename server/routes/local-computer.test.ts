// Characterization of P6 local-computer routes moved out of server/index.ts
// (#1388): interrupt, shared Local VM, bot Local VM. Auth gate already ran.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteContext } from "./table.ts";
import {
  createLocalComputerRoutes,
  type LocalComputerRouteDeps,
} from "./local-computer.ts";

const loopback: RequestAuth = {
  kind: "loopback",
  scopes: ["admin", "client"],
} as RequestAuth;

const sessionClient: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s1",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_member",
  } as never,
};

function baseDeps(over: Partial<LocalComputerRouteDeps> = {}): LocalComputerRouteDeps {
  return {
    interruptLocalComputerBots: vi.fn(async () => undefined),
    sharedPayload: vi.fn(async () => ({ ready: true, mode: "shared" })),
    inventoryPayload: vi.fn(async () => ({ instances: [] })),
    hostRefusal: () => undefined,
    setupBusy: () => false,
    sharedInUse: () => false,
    sharedActiveThread: () => false,
    sharedLifecycleBusy: () => false,
    mode: () => "shared",
    maxInstances: () => 2,
    idleTimeoutMs: () => 60_000,
    runSharedAction: vi.fn(async (action, _auth) => ({
      action,
      ready: true,
      runtime: "podman",
      commands: [],
    })),
    sharedScreenshot: vi.fn(async () => "img"),
    touchSharedIdle: () => undefined,
    cancelSharedIdle: () => undefined,
    personStarted: () => undefined,
    personStopped: () => undefined,
    previewBot: (id) => (id === "b1" ? { id: "b1", threadId: "t1" } as never : null),
    botPayload: vi.fn(async () => ({ ready: true, mode: "per-bot" })),
    bot: (id) => (id === "b1" ? { id: "b1", name: "Bot" } as never : null),
    boatLifecycleBusy: () => false,
    botTargetShared: () => false,
    botSetupBusy: () => false,
    botProvisionBusy: () => false,
    botInUse: () => false,
    botActiveThread: () => false,
    botLifecycleBusy: () => false,
    runBotAction: vi.fn(async (_botId, action, _auth) => ({
      action,
      ready: true,
      runtime: "podman",
      commands: [],
      overCap: false,
      noRuntime: false,
    })),
    botScreenshot: vi.fn(async () => "bot-img"),
    touchBotIdle: () => undefined,
    cancelBotIdle: () => undefined,
    previewSurface: vi.fn(async () => "vm" as const),
    controlLeaseOk: () => true,
    botJoinStatus: vi.fn(async () => ({
      ready: true,
      managed: true,
      container: "running",
      network: "loopback",
      viewer_url: "http://127.0.0.1:1/#password=secret",
      problem: undefined,
    })),
    viewerSocketPath: () => "api/desktop-viewer/local/bot-b1/websockify?botId=b1",
    ...over,
  };
}

function call(
  deps: LocalComputerRouteDeps,
  opts: {
    method: string;
    path: string;
    query?: string;
    headers?: Record<string, string>;
    auth?: RequestAuth;
    body?: unknown;
  },
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const headersOut: Record<string, string> = {};
  const url = new URL(`http://x${opts.path}${opts.query ? `?${opts.query}` : ""}`);
  const route = createLocalComputerRoutes(deps);
  const ctx: RouteContext = {
    req: { headers: opts.headers ?? {} } as RouteContext["req"],
    res: {
      setHeader: (key: string, value: string) => { headersOut[key] = value; },
    } as unknown as ServerResponse,
    url,
    path: url.pathname,
    method: opts.method,
    auth: opts.auth ?? loopback,
    json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
    readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
  };
  return (async () => {
    const out = await route(ctx);
    return { out, sent: sent[0], headersOut };
  })();
}

describe("createLocalComputerRoutes", () => {
  it("returns PASS for foreign paths", async () => {
    const deps = baseDeps();
    expect((await call(deps, { method: "GET", path: "/api/computers/boxes" })).out).toBe(PASS);
    expect((await call(deps, { method: "GET", path: "/api/team-computers" })).out).toBe(PASS);
    expect((await call(deps, { method: "POST", path: "/api/local-computer/ensure" })).out).toBe(PASS);
    expect((await call(deps, { method: "POST", path: "/api/local-computer/reset" })).out).toBe(PASS);
    expect((await call(deps, { method: "GET", path: "/api/bots/b1/computer" })).out).toBe(PASS);
  });

  it("refuses interrupt without JSON content-type", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "POST", path: "/api/local-computer/interrupt" });
    expect(result.sent).toEqual({ status: 415, body: { error: "content-type must be application/json" } });
    expect(deps.interruptLocalComputerBots).not.toHaveBeenCalled();
  });

  it("interrupts on the happy path", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/local-computer/interrupt",
      headers: { "content-type": "application/json" },
    });
    expect(result.sent).toEqual({ status: 200, body: { ok: true } });
    expect(deps.interruptLocalComputerBots).toHaveBeenCalledOnce();
  });

  it("returns shared Local VM status", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "GET", path: "/api/local-computer" });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ ready: true, mode: "shared" });
  });

  it("refuses shared lifecycle when the host may not run a desktop", async () => {
    const deps = baseDeps({ hostRefusal: () => "organization servers do not host a Local VM" });
    const result = await call(deps, {
      method: "POST",
      path: "/api/local-computer/run",
      headers: { "content-type": "application/json" },
    });
    expect(result.sent).toEqual({
      status: 403,
      body: { error: "organization servers do not host a Local VM", code: "host_computer" },
    });
  });

  it("runs a shared lifecycle action on the happy path", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/local-computer/start",
      headers: { "content-type": "application/json" },
    });
    expect(result.sent?.status).toBe(200);
    expect(deps.runSharedAction).toHaveBeenCalledWith("start", expect.anything());
  });

  it("refuses bot Local VM when the bot is missing", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "GET", path: "/api/bots/missing/local-computer" });
    expect(result.sent).toEqual({ status: 404, body: { error: "no such bot" } });
  });

  it("refuses bot run without JSON content-type", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "POST", path: "/api/bots/b1/local-computer/run" });
    expect(result.sent).toEqual({ status: 415, body: { error: "content-type must be application/json" } });
  });

  it("joins a bot Local VM for a loopback caller", async () => {
    const deps = baseDeps({ mode: () => "per-bot" });
    const result = await call(deps, {
      method: "POST",
      path: "/api/bots/b1/local-computer/join",
      query: "controlLeaseId=lease-abcdefghijklmnop",
      headers: { "content-type": "application/json" },
      auth: loopback,
    });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toEqual({ joinUrl: "http://127.0.0.1:1/#password=secret" });
  });

  it("joins a bot Local VM for a session with the server proxy", async () => {
    const deps = baseDeps({ mode: () => "per-bot" });
    const result = await call(deps, {
      method: "POST",
      path: "/api/bots/b1/local-computer/join",
      query: "controlLeaseId=lease-abcdefghijklmnop",
      headers: { "content-type": "application/json" },
      auth: sessionClient,
    });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({
      socketPath: "api/desktop-viewer/local/bot-b1/websockify?botId=b1",
      password: "secret",
    });
  });
});
