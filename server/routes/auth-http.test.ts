// Characterization: public email/pair refusals and post-gate session routes.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import {
  createAuthPublicRoutes,
  createAuthSessionRoutes,
  type AuthPublicRouteDeps,
  type AuthSessionRouteDeps,
} from "./auth-http.ts";
import { PASS, type PreAuthRouteContext, type RouteContext } from "./table.ts";

const loopback = { kind: "loopback", trust: "owner", scopes: ["admin", "client"] } as unknown as RequestAuth;
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

function publicDeps(over: Partial<AuthPublicRouteDeps> = {}): AuthPublicRouteDeps {
  return {
    emailSignIn: {
      enabled: () => true,
      start: async () => ({ ok: true }),
      verify: async () => ({ ok: true, email: "a@example.test", userId: "u1", scopes: ["admin", "client"] }),
    },
    sessions: {
      attemptAllowed: () => ({ ok: true }),
      noteFailure: vi.fn(),
      clearFailures: vi.fn(),
      issue: () => ({
        token: "tok",
        session: { id: "s", label: "x", scopes: ["admin", "client"], expiresAt: 1, createdAt: 0, lastSeenAt: 0 },
      }),
      exchange: () => ({
        ok: true,
        token: "tok",
        session: { id: "s", label: "x", scopes: ["admin", "client"], expiresAt: 1, createdAt: 0, lastSeenAt: 0 },
      }),
      previewBrowserSignIn: () => null,
      previewSignInPrincipal: () => null,
      authenticate: () => null,
      revoke: vi.fn(),
    },
    isAccountEmail: () => true,
    acceptOpenInvitesForEmail: () => false,
    persistOrgState: vi.fn(),
    principalsForAccount: () => ({ id: "person:1" }),
    sessionPersonFields: () => ({}),
    environmentForEmailSignIn: () => ({ label: "env" }),
    environmentForPair: () => ({ label: "env" }),
    sessionCookieName: "sgx",
    serializeSessionCookie: () => "sgx=tok",
    cookieMaxAgeSeconds: () => 60,
    ...over,
  } as AuthPublicRouteDeps;
}

function sessionDeps(over: Partial<AuthSessionRouteDeps> = {}): AuthSessionRouteDeps {
  return {
    environmentId: "env-1",
    hostedWorkspace: false,
    identityKind: () => "solo",
    sessions: {
      issueStreamTicket: () => ({ ticket: "t", expiresAt: 1 }),
      revoke: vi.fn(() => true),
      list: () => [],
      byId: () => null,
    },
    clearSessionCookie: () => "sgx=; Max-Age=0",
    sessionCookieName: "sgx",
    computerOwnerFields: () => ({ name: "Owner" }),
    ownerSessionFields: () => ({}),
    oidcSessionFields: () => ({}),
    profileManagedFor: () => false,
    profileManagement: null,
    sessionPersonFields: () => ({}),
    viewerIsOperator: () => true,
    orgAdminCaller: () => false,
    mayActOnPerson: () => false,
    ...over,
  };
}

function preCtx(path: string, method = "GET", headers: Record<string, string> = {}) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const headersOut: Record<string, string> = {};
  const context = {
    req: { headers } as IncomingMessage,
    res: {
      setHeader: (k: string, v: string) => { headersOut[k.toLowerCase()] = v; },
      headersSent: false,
      writableEnded: false,
    } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth: null,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as PreAuthRouteContext["json"],
    readBody: (async () => ({})) as PreAuthRouteContext["readBody"],
  } satisfies PreAuthRouteContext;
  return { context, sent, headersOut };
}

function authedCtx(path: string, method = "GET", auth: RequestAuth = sessionAuth) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const headersOut: Record<string, string> = {};
  const context = {
    req: { headers: {} } as IncomingMessage,
    res: {
      setHeader: (k: string, v: string) => { headersOut[k.toLowerCase()] = v; },
      headersSent: false,
      writableEnded: false,
    } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => ({})) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent, headersOut };
}

describe("createAuthPublicRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    expect(await route(preCtx("/api/auth/session").context)).toBe(PASS);
    expect(await route(preCtx("/api/pair", "POST").context)).toBe(PASS);
  });

  it("refuses non-JSON email start with 415", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/email/start", "POST", { "content-type": "text/plain" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(415);
  });

  it("refuses email start when disabled with 404", async () => {
    const route = createAuthPublicRoutes(publicDeps({
      emailSignIn: { enabled: () => false, start: async () => ({ ok: true }), verify: async () => ({ ok: false, status: 401, error: "x" }) },
    }));
    const call = preCtx("/api/auth/email/start", "POST", { "content-type": "application/json" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(404);
  });

  it("rate-limits email start with 429", async () => {
    const route = createAuthPublicRoutes(publicDeps({
      sessions: {
        ...publicDeps().sessions,
        attemptAllowed: () => ({ ok: false, retryAfterMs: 5000 }),
      },
    }));
    const call = preCtx("/api/auth/email/start", "POST", { "content-type": "application/json" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(429);
    const body = call.sent[0]?.body as { error?: string } | undefined;
    expect(String(body?.error ?? "")).toMatch(/5s/);
  });

  it("notes failure on email start 403", async () => {
    const noteFailure = vi.fn();
    const route = createAuthPublicRoutes(publicDeps({
      emailSignIn: {
        enabled: () => true,
        start: async () => ({ ok: false, status: 403, error: "not welcome" }),
        verify: async () => ({ ok: false, status: 401, error: "x" }),
      },
      sessions: { ...publicDeps().sessions, noteFailure },
    }));
    const call = preCtx("/api/auth/email/start", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ email: "a@example.test" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(noteFailure).toHaveBeenCalled();
  });

  it("email start happy path", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/email/start", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ email: "a@example.test" });
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 200, body: { ok: true } });
  });

  it("refuses non-JSON pair with 415", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/pair", "POST");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(415);
  });

  it("pair preview expired is 401", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ code: "dead", preview: true });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(401);
  });

  it("browser pair without cookie is 400", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ code: "ABCD", browser: true, cookie: false });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(400);
  });

  it("pair exchange refusal forwards status", async () => {
    const route = createAuthPublicRoutes(publicDeps({
      sessions: {
        ...publicDeps().sessions,
        exchange: () => ({ ok: false, status: 401, error: "bad code", code: "pairing_invalid" }),
      },
    }));
    const call = preCtx("/api/auth/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ code: "BAD" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(401);
    expect(call.sent[0]?.body).toMatchObject({ code: "pairing_invalid" });
  });

  it("pair happy path returns token", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ code: "GOOD" });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.sent[0]?.body).toMatchObject({ token: "tok" });
  });

  it("pair with cookie sets set-cookie", async () => {
    const route = createAuthPublicRoutes(publicDeps());
    const call = preCtx("/api/auth/pair", "POST", { "content-type": "application/json" });
    call.context.readBody = async () => ({ code: "GOOD", cookie: true });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.headersOut["set-cookie"]).toBe("sgx=tok");
  });
});

describe("createAuthSessionRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createAuthSessionRoutes(sessionDeps());
    expect(await route(authedCtx("/api/bots").context)).toBe(PASS);
    expect(await route(authedCtx("/api/auth/pair", "POST").context)).toBe(PASS);
  });

  it("session loopback happy path", async () => {
    const route = createAuthSessionRoutes(sessionDeps());
    const call = authedCtx("/api/auth/session", "GET", loopback);
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.sent[0]?.body).toMatchObject({ kind: "loopback", environmentId: "env-1" });
  });

  it("session person happy path", async () => {
    const route = createAuthSessionRoutes(sessionDeps());
    const call = authedCtx("/api/auth/session");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.sent[0]?.body).toMatchObject({ kind: "session", id: "sess-1" });
  });

  it("stream-ticket loopback returns null ticket", async () => {
    const route = createAuthSessionRoutes(sessionDeps());
    const call = authedCtx("/api/auth/stream-ticket", "POST", loopback);
    await route(call.context);
    expect(call.sent[0]?.body).toEqual({ ticket: null, reason: "loopback needs no ticket" });
  });

  it("logout clears cookie", async () => {
    const revoke = vi.fn(() => true);
    const route = createAuthSessionRoutes(sessionDeps({ sessions: { ...sessionDeps().sessions, revoke } }));
    const call = authedCtx("/api/auth/logout", "POST");
    await route(call.context);
    expect(revoke).toHaveBeenCalledWith("sess-1");
    expect(call.headersOut["set-cookie"]).toMatch(/Max-Age=0/);
    expect(call.sent[0]?.status).toBe(200);
  });

  it("delete admin session refused for non-org-admin", async () => {
    const route = createAuthSessionRoutes(sessionDeps({
      identityKind: () => "perspicax",
      orgAdminCaller: () => false,
      mayActOnPerson: () => false,
      sessions: {
        ...sessionDeps().sessions,
        byId: () => ({ id: "other", scopes: ["admin"], principalId: "person:admin" } as never),
        revoke: vi.fn(),
      },
    }));
    const call = authedCtx("/api/auth/sessions/other", "DELETE");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(403);
    expect(call.sent[0]?.body).toMatchObject({ code: "target_is_admin" });
  });

  it("delete own session happy path", async () => {
    const revoke = vi.fn(() => true);
    const route = createAuthSessionRoutes(sessionDeps({
      sessions: { ...sessionDeps().sessions, revoke },
    }));
    const call = authedCtx("/api/auth/sessions/sess-1", "DELETE");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect(call.headersOut["set-cookie"]).toMatch(/Max-Age=0/);
  });
});
