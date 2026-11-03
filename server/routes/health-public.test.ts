import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createHealthPublicRoutes,
  createUnauthHealthBrandRoutes,
  type HealthPublicRouteDeps,
  type UnauthHealthBrandRouteDeps,
} from "./health-public.ts";
import { PASS, type PreAuthRouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;

const healthzOk = { ok: true, app: "openmausbot", product: "sagax" };
const healthzUnready = { ok: false, shuttingDown: true, app: "openmausbot", product: "sagax" };
const environment = { environmentId: "env-1", label: "test" };
const brand = { brand: { name: "Sagax" }, source: "default", file: "/tmp/brand.json" };
const identity = { app: "openmausbot", product: "sagax" } as const;

function publicDeps(over: Partial<HealthPublicRouteDeps> = {}): HealthPublicRouteDeps {
  return {
    isShuttingDown: () => false,
    healthzBody: () => healthzOk,
    healthzUnreadyBody: () => healthzUnready,
    environmentPaths: ["/.well-known/sagax/environment", "/.well-known/openmausbot/environment"],
    environmentDescriptor: () => environment,
    ...over,
  };
}

function unauthDeps(over: Partial<UnauthHealthBrandRouteDeps> = {}): UnauthHealthBrandRouteDeps {
  return {
    isShuttingDown: () => false,
    healthzUnreadyBody: () => healthzUnready,
    healthIdentity: identity,
    loadBrand: () => brand,
    ...over,
  };
}

function ctx(path: string, method = "GET", caller: RequestAuth | null = null) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth: caller,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as PreAuthRouteContext["json"],
    readBody: (async () => null) as PreAuthRouteContext["readBody"],
  } satisfies PreAuthRouteContext;
  return { context, sent };
}

describe("createHealthPublicRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createHealthPublicRoutes(publicDeps());
    expect(await route(ctx("/api/health").context)).toBe(PASS);
    expect(await route(ctx("/api/brand").context)).toBe(PASS);
    expect(await route(ctx("/healthz", "POST").context)).toBe(PASS);
    expect(await route(ctx("/.well-known/other").context)).toBe(PASS);
  });

  it("answers /healthz with 200 when ready", async () => {
    const route = createHealthPublicRoutes(publicDeps());
    const call = ctx("/healthz");
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 200, body: healthzOk });
  });

  it("answers /healthz with 503 while shutting down", async () => {
    const route = createHealthPublicRoutes(publicDeps({ isShuttingDown: () => true }));
    const call = ctx("/healthz");
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 503, body: healthzUnready });
  });

  it("answers environment paths with the descriptor", async () => {
    const route = createHealthPublicRoutes(publicDeps());
    for (const path of ["/.well-known/sagax/environment", "/.well-known/openmausbot/environment"]) {
      const call = ctx(path);
      await route(call.context);
      expect(call.sent[0]).toEqual({ status: 200, body: environment });
    }
  });
});

describe("createUnauthHealthBrandRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createUnauthHealthBrandRoutes(unauthDeps());
    expect(await route(ctx("/healthz").context)).toBe(PASS);
    expect(await route(ctx("/api/routines").context)).toBe(PASS);
    expect(await route(ctx("/api/health", "POST").context)).toBe(PASS);
  });

  it("answers /api/health without auth with the minimal identity", async () => {
    const route = createUnauthHealthBrandRoutes(unauthDeps());
    const call = ctx("/api/health");
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 200, body: { ...identity } });
  });

  it("passes /api/health when auth is present", async () => {
    const route = createUnauthHealthBrandRoutes(unauthDeps());
    expect(await route(ctx("/api/health", "GET", auth).context)).toBe(PASS);
  });

  it("answers /api/health with 503 while shutting down without auth", async () => {
    const route = createUnauthHealthBrandRoutes(unauthDeps({ isShuttingDown: () => true }));
    const call = ctx("/api/health");
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 503, body: healthzUnready });
  });

  it("answers /api/brand without auth", async () => {
    const route = createUnauthHealthBrandRoutes(unauthDeps());
    const call = ctx("/api/brand");
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 200, body: brand });
  });

  it("passes /api/brand when auth is present", async () => {
    const route = createUnauthHealthBrandRoutes(unauthDeps());
    expect(await route(ctx("/api/brand", "GET", auth).context)).toBe(PASS);
  });
});
