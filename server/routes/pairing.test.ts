// Characterization: companion pair and admin pairing refusals / happy paths.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createCompanionPairRoutes,
  createPairingAdminRoutes,
  type CompanionPairRouteDeps,
  type PairingAdminRouteDeps,
} from "./pairing.ts";
import { PASS, type PreAuthRouteContext, type RouteContext } from "./table.ts";

const sessionAuth = {
  kind: "session",
  via: "bearer",
  scopes: ["admin", "client"],
  session: {
    id: "sess-1",
    label: "Phone",
    scopes: ["admin", "client"],
    expiresAt: Date.now() + 60_000,
    principalId: "person:1",
  },
} as unknown as RequestAuth;

function companionDeps(over: Partial<CompanionPairRouteDeps> = {}): CompanionPairRouteDeps {
  return {
    sessions: {
      exchange: () => ({
        ok: true,
        token: "tok",
        session: { id: "s1", label: "Phone", createdAt: 1, lastSeenAt: 2 },
      }),
    },
    serverName: () => "Fixture",
    ...over,
  };
}

function adminDeps(over: Partial<PairingAdminRouteDeps> = {}): PairingAdminRouteDeps {
  return {
    identityKind: () => "solo",
    sessions: {
      isLive: () => true,
      openPairing: () => ({ id: "p1", code: "ABCD1234EFGH", credential: "cred", expiresAt: 9 }),
      openPairings: () => [],
      cancelPairing: () => true,
    },
    actorPrincipalId: () => "person:1",
    publicUrl: () => "https://bots.example.test",
    serverName: () => "Fixture",
    orgAdminCaller: () => false,
    ...over,
  };
}

function preCtx(path: string, method = "POST", headers: Record<string, string> = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: { headers } as IncomingMessage,
    res: { setHeader: () => {}, headersSent: false, writableEnded: false } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth: null,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as PreAuthRouteContext["json"],
    readBody: (async () => ({})) as PreAuthRouteContext["readBody"],
  } satisfies PreAuthRouteContext;
  return { context, sent };
}

function authedCtx(path: string, method = "GET", auth: RequestAuth = sessionAuth, body: unknown = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: { headers: {} } as IncomingMessage,
    res: { setHeader: () => {}, headersSent: false, writableEnded: false } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createCompanionPairRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createCompanionPairRoutes(companionDeps());
    expect(await route(preCtx("/api/auth/pair").context)).toBe(PASS);
  });

  it("refuses non-JSON with 415", async () => {
    const route = createCompanionPairRoutes(companionDeps());
    const call = preCtx("/api/pair", "POST");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(415);
  });

  it("forwards exchange refusal", async () => {
    const route = createCompanionPairRoutes(companionDeps({
      sessions: { exchange: () => ({ ok: false, status: 429, error: "slow down", code: "rate" }) },
    }));
    const call = preCtx("/api/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ credential: "x" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(429);
  });

  it("happy path returns companion shape", async () => {
    const route = createCompanionPairRoutes(companionDeps());
    const call = preCtx("/api/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ credential: "good", deviceName: "iPhone" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.sent[0]?.body).toMatchObject({
      token: "tok",
      device: { id: "s1", name: "Phone" },
      serverName: "Fixture",
    });
  });
});

describe("createPairingAdminRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createPairingAdminRoutes(adminDeps());
    expect(await route(authedCtx("/api/auth/session").context)).toBe(PASS);
  });

  it("refuses mint when session ended mid-body (401)", async () => {
    const route = createPairingAdminRoutes(adminDeps({
      sessions: { ...adminDeps().sessions, isLive: () => false },
    }));
    const call = authedCtx("/api/auth/pairing", "POST");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(401);
  });

  it("org session without principal is 403", async () => {
    const route = createPairingAdminRoutes(adminDeps({
      identityKind: () => "perspicax",
      actorPrincipalId: () => "",
    }));
    const call = authedCtx("/api/auth/pairing", "POST");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(call.sent[0]?.body).toMatchObject({ code: "principal_required" });
  });

  it("scope exceeds session is 403", async () => {
    const narrow = {
      kind: "session",
      via: "bearer",
      scopes: ["client"],
      session: {
        id: "sess-1",
        label: "Phone",
        scopes: ["client"],
        expiresAt: Date.now() + 60_000,
        principalId: "person:1",
      },
    } as unknown as RequestAuth;
    const route = createPairingAdminRoutes(adminDeps({ identityKind: () => "perspicax" }));
    const call = authedCtx("/api/auth/pairing", "POST", narrow, { scopes: ["admin"] });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(call.sent[0]?.body).toMatchObject({ code: "scope_exceeds_session" });
  });

  it("open pairing happy path", async () => {
    const route = createPairingAdminRoutes(adminDeps());
    const call = authedCtx("/api/auth/pairing", "POST", sessionAuth, {});
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.sent[0]?.body).toMatchObject({ id: "p1", serverName: "Fixture" });
  });

  it("lists open pairings", async () => {
    const route = createPairingAdminRoutes(adminDeps({
      sessions: { ...adminDeps().sessions, openPairings: () => [{ id: "p1", scopes: ["client"] }] },
    }));
    const call = authedCtx("/api/auth/pairing");
    await route(call.context);
    expect(call.sent[0]?.body).toEqual({
      pairings: [{ id: "p1", scopes: ["client"] }],
      publicUrl: "https://bots.example.test",
    });
  });

  it("non-admin cannot cancel admin pairing (403)", async () => {
    const route = createPairingAdminRoutes(adminDeps({
      identityKind: () => "perspicax",
      orgAdminCaller: () => false,
      sessions: {
        ...adminDeps().sessions,
        openPairings: () => [{ id: "admin-code", scopes: ["admin"] }],
        cancelPairing: vi.fn(),
      },
    }));
    const call = authedCtx("/api/auth/pairing/admin-code", "DELETE");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(call.sent[0]?.body).toMatchObject({ code: "target_is_admin" });
  });

  it("cancel missing pairing is 404", async () => {
    const route = createPairingAdminRoutes(adminDeps({
      sessions: { ...adminDeps().sessions, cancelPairing: () => false },
    }));
    const call = authedCtx("/api/auth/pairing/missing", "DELETE");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(404);
  });
});
