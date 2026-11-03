// Characterization: shared-computers and desktop lease refusals / happy paths.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createSharedComputersRoutes,
  type SharedComputersRouteDeps,
} from "./shared-computers-http.ts";
import { PASS, type RouteContext } from "./table.ts";

const loopback = { kind: "loopback", trust: "owner", scopes: ["admin", "client"] } as unknown as RequestAuth;
const sessionAuth = {
  kind: "session",
  via: "bearer",
  scopes: ["client"],
  session: { id: "sess-1", label: "Desk", scopes: ["client"], principalId: "person:1", expiresAt: 1 },
} as unknown as RequestAuth;

function deps(over: Partial<SharedComputersRouteDeps> = {}): SharedComputersRouteDeps {
  return {
    lendingEnabled: () => true,
    sharedComputersEnabled: () => true,
    desktopManaged: false,
    environmentId: "env-1",
    dataDir: "/tmp/fixture",
    identityKind: () => "solo",
    sessionsIsLive: () => true,
    sessionLendingPrincipal: () => "person:1",
    personKey: () => "person:1",
    computerRefusal: () => undefined,
    sharedComputerControl: {
      acquire: vi.fn(),
      release: vi.fn(),
      renew: vi.fn(() => true),
    },
    sharedComputers: {
      status: () => [{ id: "c1" }],
      register: vi.fn(),
      poll: async () => null,
      liveJob: () => false,
      complete: vi.fn(),
      disconnect: vi.fn(),
    },
    publishPersonalCopy: () => ({ path: "x" }),
    ...over,
  };
}

function ctx(path: string, method = "GET", auth: RequestAuth = sessionAuth, headers: Record<string, string> = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: { headers } as IncomingMessage,
    res: { setHeader: () => {}, headersSent: false, writableEnded: false } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => ({})) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createSharedComputersRoutes", () => {
  it("passes foreign paths and feature-off shared-computers", async () => {
    const route = createSharedComputersRoutes(deps({ lendingEnabled: () => false }));
    expect(await route(ctx("/api/bots").context)).toBe(PASS);
    expect(await route(ctx("/api/shared-computers").context)).toBe(PASS);
  });

  it("desktop control refuses non-loopback with 403", async () => {
    const route = createSharedComputersRoutes(deps());
    const call = ctx("/api/desktop/shared-computer-control", "POST", sessionAuth);
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
  });

  it("desktop control invalid body is 400", async () => {
    const route = createSharedComputersRoutes(deps());
    const call = ctx("/api/desktop/shared-computer-control", "POST", loopback);
    call.context.readBody = async () => ({ id: "not-uuid", action: "acquire" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(400);
  });

  it("desktop control managed policy is 403", async () => {
    const route = createSharedComputersRoutes(deps({
      computerRefusal: () => "Agency forbids this computer.",
    }));
    const call = ctx("/api/desktop/shared-computer-control", "POST", loopback);
    call.context.readBody = async () => ({ id: "11111111-1111-4111-8111-111111111111", action: "acquire" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(call.sent[0]?.body).toMatchObject({ code: "managed_policy" });
  });

  it("desktop control acquire happy path", async () => {
    const acquire = vi.fn();
    const route = createSharedComputersRoutes(deps({
      sharedComputerControl: { acquire, release: vi.fn(), renew: vi.fn(() => true) },
    }));
    const call = ctx("/api/desktop/shared-computer-control", "POST", loopback);
    call.context.readBody = async () => ({ id: "11111111-1111-4111-8111-111111111111", action: "acquire" });
    await route(call.context);
    expect(acquire).toHaveBeenCalled();
    expect(call.sent[0]?.status).toBe(200);
  });

  it("lists lent computers", async () => {
    const route = createSharedComputersRoutes(deps());
    const call = ctx("/api/shared-computers");
    await route(call.context);
    expect(call.sent[0]?.body).toEqual({ computers: [{ id: "c1" }] });
  });

  it("connect refuses loopback with 403", async () => {
    const route = createSharedComputersRoutes(deps());
    const call = ctx("/api/shared-computers/connect", "POST", loopback, { "content-type": "application/json" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
  });

  it("connect refuses non-JSON with 415", async () => {
    const route = createSharedComputersRoutes(deps());
    const call = ctx("/api/shared-computers/connect", "POST", sessionAuth);
    await route(call.context);
    expect(call.sent[0]?.status).toBe(415);
  });

  it("connect refuses ended session with 401", async () => {
    const route = createSharedComputersRoutes(deps({ sessionsIsLive: () => false }));
    const call = ctx("/api/shared-computers/connect", "POST", sessionAuth, { "content-type": "application/json" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(401);
  });

  it("connect wrong environment is 409", async () => {
    const route = createSharedComputersRoutes(deps());
    const call = ctx("/api/shared-computers/connect", "POST", sessionAuth, { "content-type": "application/json" });
    call.context.readBody = async () => ({
      environmentId: "00000000-0000-4000-8000-000000000099",
      id: "11111111-1111-4111-8111-111111111111",
      name: "Mac",
      folders: [],
      terminal: false,
      computer: true,
    });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(409);
  });
});
