// Characterization of P6 computers routes moved out of server/index.ts
// (#1388): /api/computers/* inventory and /api/bots/:id/computer/* cloud tail.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteContext } from "./table.ts";
import {
  createComputersRoutes,
  type ComputersRouteDeps,
} from "./computers.ts";

const admin: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["admin", "client"],
  session: {
    id: "s-admin",
    label: "web",
    scopes: ["admin", "client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_admin",
  } as never,
};

const client: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s-client",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_member",
  } as never,
};

function baseDeps(over: Partial<ComputersRouteDeps> = {}): ComputersRouteDeps {
  return {
    listBoxes: vi.fn(async () => ({ boxes: [{ id: "bx1", name: "Box" }] })),
    sleepBox: vi.fn(async () => ({ ok: true, id: "bx1" })),
    deleteBox: vi.fn(async () => ({ ok: true, id: "bx1" })),
    listVps: vi.fn(async () => ({ computers: [{ id: "v1", name: "Vps" }] })),
    removeVps: vi.fn(async () => ({ ok: true, id: "v1" })),
    providerTransitioning: () => false,
    providerTransitionMessage: () => "provider is changing",
    claimBoxInventory: () => () => undefined,
    claimVpsMutation: () => () => undefined,
    previewBot: (id) => (id === "b1"
      ? { id: "b1", threadId: "t1", name: "Bot", computer: "cloud", cloudBackend: "box" } as never
      : null),
    bot: (id) => (id === "b1"
      ? { id: "b1", threadId: "t1", name: "Bot", computer: "cloud", cloudBackend: "box" } as never
      : null),
    previewSurface: vi.fn(async () => "cloud" as const),
    isOrganization: () => false,
    sandboxConfigured: () => false,
    inheritedTeamComputer: () => undefined,
    teamOwnerKey: (id) => `team:${id}`,
    boatStatus: vi.fn(async () => ({ configured: true, state: "ready" })),
    vpsStatus: vi.fn(async () => ({ configured: true, state: "ready" })),
    botControlSnapshot: () => ({ held: false }),
    controlSnapshot: () => ({ held: false }),
    controlTake: () => ({ held: true }),
    controlRelease: () => ({ held: false }),
    controlDismissHelp: () => ({ held: false }),
    controlAcquireLease: () => ({ snapshot: { held: true }, owned: true, acquired: true }),
    controlReleaseLease: () => ({ snapshot: { held: false }, released: true }),
    controlOwnsLease: () => false,
    controlKey: (bot) => bot.id,
    boatLifecycleBusy: () => false,
    closeSessionViewers: () => 0,
    closeVpsTunnel: () => ({ closed: true }),
    isComputerOwner: () => false,
    memberOwnsBot: () => false,
    orgComputerRefusal: () => null,
    claimBotLifecycle: () => () => undefined,
    claimTeamLifecycle: () => () => undefined,
    teamComputerBusy: () => false,
    teamJoin: vi.fn(async () => ({ joinUrl: "team" })),
    teamScreenshot: vi.fn(async () => ({ image: "t" })),
    teamSleep: vi.fn(async () => ({ ok: true })),
    waitVpsJoin: async () => undefined,
    beginVpsJoin: () => () => undefined,
    vpsScreenshot: vi.fn(async () => ({ image: "v" })),
    vpsJoin: vi.fn(async () => ({ joinUrl: "vps-local" })),
    vpsAction: vi.fn(async () => ({ ok: true })),
    botHasActiveTurn: () => false,
    activeVpsThread: () => false,
    desktopViewerUrl: (target) => `api/desktop-viewer/${target}/websockify`,
    maxRemoteCommandLength: () => 4000,
    boatProvision: vi.fn(async () => ({ ok: true })),
    boatJoinReady: vi.fn(async () => ({ joinUrl: "ready" })),
    boatJoin: vi.fn(async () => ({ joinUrl: "wake" })),
    boatSleep: vi.fn(async () => ({ ok: true })),
    boatExec: vi.fn(async () => ({ stdout: "hi" })),
    boatScreenshot: vi.fn(async () => ({ image: "b" })),
    cloudBusyError: "cloud computer is busy",
    ...over,
  };
}

function call(
  deps: ComputersRouteDeps,
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
  const route = createComputersRoutes(deps);
  const ctx: RouteContext = {
    req: { headers: opts.headers ?? {} } as RouteContext["req"],
    res: {
      setHeader: (key: string, value: string) => { headersOut[key] = value; },
    } as unknown as ServerResponse,
    url,
    path: url.pathname,
    method: opts.method,
    auth: opts.auth ?? admin,
    json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
    readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
  };
  return (async () => {
    const out = await route(ctx);
    return { out, sent: sent[0], headersOut };
  })();
}

describe("createComputersRoutes", () => {
  it("returns PASS for foreign paths", async () => {
    const deps = baseDeps();
    expect((await call(deps, { method: "GET", path: "/api/team-computers" })).out).toBe(PASS);
    expect((await call(deps, { method: "GET", path: "/api/local-computer" })).out).toBe(PASS);
    expect((await call(deps, { method: "GET", path: "/api/bots/b1/local-computer" })).out).toBe(PASS);
    expect((await call(deps, { method: "GET", path: "/api/health" })).out).toBe(PASS);
  });

  it("lists managed boxes", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "GET", path: "/api/computers/boxes" });
    expect(result.headersOut["cache-control"]).toBe("private, no-store");
    expect(result.sent).toEqual({ status: 200, body: { boxes: [{ id: "bx1", name: "Box" }] } });
  });

  it("refuses box delete without JSON content-type", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "POST", path: "/api/computers/boxes/bx1/delete" });
    expect(result.sent).toEqual({ status: 415, body: { error: "content-type must be application/json" } });
  });

  it("refuses box delete while the provider is transitioning", async () => {
    const deps = baseDeps({ providerTransitioning: (p) => p === "box" });
    const result = await call(deps, {
      method: "POST",
      path: "/api/computers/boxes/bx1/delete",
      headers: { "content-type": "application/json" },
      body: { confirmName: "Box" },
    });
    expect(result.sent).toEqual({ status: 409, body: { error: "provider is changing" } });
  });

  it("refuses box delete without confirmName", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/computers/boxes/bx1/delete",
      headers: { "content-type": "application/json" },
      body: {},
    });
    expect(result.sent).toEqual({
      status: 400,
      body: { error: "confirmName must be the cloud computer name shown in Settings" },
    });
  });

  it("deletes a managed box on the happy path", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/computers/boxes/bx1/delete",
      headers: { "content-type": "application/json" },
      body: { confirmName: "Box" },
    });
    expect(result.sent?.status).toBe(202);
    expect(deps.deleteBox).toHaveBeenCalledWith("bx1", "Box");
  });

  it("lists managed VPS computers", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "GET", path: "/api/computers/vps" });
    expect(result.sent?.status).toBe(200);
    expect(deps.listVps).toHaveBeenCalledOnce();
  });

  it("returns 404 for an unknown bot computer", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "GET", path: "/api/bots/missing/computer" });
    expect(result.sent).toEqual({ status: 404, body: { error: "no such bot" } });
  });

  it("returns cloud computer status on the happy path", async () => {
    const deps = baseDeps();
    const result = await call(deps, { method: "GET", path: "/api/bots/b1/computer" });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ surface: "cloud", backend: "box", configured: true });
  });

  it("refuses non-owner computer open for a client session", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/bots/b1/computer/provision",
      headers: { "content-type": "application/json" },
      auth: client,
      body: { acknowledgeCost: true },
    });
    expect(result.sent).toEqual({
      status: 403,
      body: {
        error: "forbidden: only the bot owner or an admin can open its computer",
        code: "bot_computer_open_owner_only",
      },
    });
  });

  it("provisions a boat computer for an admin", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/bots/b1/computer/provision",
      headers: { "content-type": "application/json" },
      body: {},
    });
    expect(result.sent?.status).toBe(200);
    expect(deps.boatProvision).toHaveBeenCalledOnce();
  });

  it("takes computer control on the happy path", async () => {
    const deps = baseDeps();
    const result = await call(deps, {
      method: "POST",
      path: "/api/bots/b1/computer/control",
      headers: { "content-type": "application/json" },
      body: { action: "take" },
    });
    expect(result.sent).toEqual({ status: 200, body: { held: true } });
  });
});
