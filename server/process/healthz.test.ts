import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { healthzBody, healthzUnreadyBody } from "./healthz.ts";

describe("healthz", () => {
  it("answers ok with the app identity", () => {
    expect(healthzBody()).toEqual({ ok: true, app: "openmausbot", product: "sagax" });
  });

  it("answers unready during graceful shutdown", () => {
    expect(healthzUnreadyBody()).toEqual({
      ok: false,
      shuttingDown: true,
      app: "openmausbot",
      product: "sagax",
    });
  });

  it("is served before the SPA fallback and does not require an empty session", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "index.ts"), "utf8");
    const routes = readFileSync(join(import.meta.dirname, "..", "routes", "health-public.ts"), "utf8");
    const route = routes.indexOf('path === "/healthz"');
    const stranger = routes.indexOf('path === "/api/health" && !auth');
    expect(route).toBeGreaterThan(0);
    expect(stranger).toBeGreaterThan(route);
    expect(routes.indexOf('path === "/healthz"', route + 1)).toBe(-1);
    const block = routes.slice(route, route + 280);
    expect(block).toContain("isShuttingDown()");
    expect(block).toContain("healthzUnreadyBody()");
    expect(block).toContain("healthzBody()");
    expect(block).not.toContain("!auth");
    // Public probes moved into the pre-auth table. Pin both that wiring
    // and the call order, so no SPA fallback or session gate can intercept.
    expect(source).toMatch(/PRE_AUTH_ROUTES\.push\(createHealthPublicRoutes\(\{/);
    const preAuth = source.slice(source.indexOf("async function runPreAuth("), source.indexOf("async function authenticate("));
    expect(preAuth.indexOf("dispatchPreAuthRoutes(PRE_AUTH_ROUTES")).toBeGreaterThan(0);
    expect(preAuth.indexOf("serveStatic(res, path)")).toBeGreaterThan(preAuth.indexOf("dispatchPreAuthRoutes(PRE_AUTH_ROUTES"));
    expect(preAuth).toContain("auth: null");
    const pipeline = source.slice(source.indexOf("const handleRequest = async"));
    expect(pipeline.indexOf("await runPreAuth(")).toBeGreaterThan(0);
    expect(pipeline.indexOf("await authenticate(")).toBeGreaterThan(pipeline.indexOf("await runPreAuth("));
  });

  it("drains HTTP and closes SSE streams before exit during shutdown", () => {
    const source = readFileSync(join(import.meta.dirname, "..", "index.ts"), "utf8");
    const drain = source.indexOf("async function drainTurnsBeforeShutdown");
    expect(drain).toBeGreaterThan(0);
    const body = source.slice(drain, drain + 2_000);
    expect(body).toContain("markShuttingDown()");
    expect(body).toContain("sseClients");
    expect(body).toContain("drainHttpServers");
  });
});
