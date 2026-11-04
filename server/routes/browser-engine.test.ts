// Characterization of post-gate health, browser-engine install, edition and brand.
import { describe, expect, it, vi } from "vitest";

import { HEALTH_IDENTITY } from "../../electron/legacy-names.mjs";
import * as browserEngine from "../browser/browser-engine.ts";
import { editionForMembers, editionStatus } from "../enterprise.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createBrowserEngineRoutes,
  type BrowserEngineRouteDeps,
  type HealthEngineProbe,
} from "./browser-engine.ts";
import { PASS } from "./table.ts";

function harness(overrides: Partial<BrowserEngineRouteDeps> = {}) {
  let installing = false;
  const broadcasts: number[] = [];
  const started: Array<() => Promise<void>> = [];
  const probes = new Map<string, HealthEngineProbe>();
  const deps: BrowserEngineRouteDeps = {
    isShuttingDown: () => false,
    isOrganization: () => false,
    sharedWorkspaceFullAccessEnabled: () => false,
    engineProbes: () => probes,
    registryEntries: () => [],
    probeEngines: async () => undefined,
    settledWithin: async () => undefined,
    engineNotAvailableReason: () => undefined,
    ENGINE_PROBE_TTL_MS: 60_000,
    ENGINE_PROBE_TIMEOUT_MS: 10_000,
    staticDir: () => null,
    isInstalling: () => installing,
    startInstall: (work) => {
      installing = true;
      started.push(work);
      void work().finally(() => { installing = false; });
    },
    broadcastConfig: () => { broadcasts.push(Date.now()); },
    log: () => undefined,
    ...overrides,
  };
  const route = createBrowserEngineRoutes(deps);
  const call = async (
    path: string,
    opts: { method?: string; auth?: RequestAuth; headers?: Record<string, string>; probes?: HealthEngineProbe[] } = {},
  ) => {
    if (opts.probes) {
      probes.clear();
      for (const probe of opts.probes) probes.set(probe.instanceId, probe);
    }
    const sent: Array<{ status: number; body: unknown }> = [];
    const out = await route({
      req: { headers: opts.headers ?? {} } as never,
      res: {} as never,
      url: new URL(`http://localhost${path}`),
      path,
      method: opts.method ?? "GET",
      auth: opts.auth ?? ({ kind: "loopback", scopes: ["admin", "client"] } as never),
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => ({})) as never,
    });
    return { out, sent: sent[0], broadcasts, started, setInstalling: (value: boolean) => { installing = value; } };
  };
  return { call, probes, broadcasts, started, deps };
}

describe("GET /api/health", () => {
  it("exposes aggregate warm-resource usage, caps and evictions to a signed-in reader", async () => {
    const { sent } = await harness().call("/api/health");
    expect(sent.body).toMatchObject({ warmResources: { count: 0, memoryBytes: 0, evictions: 0,
      limits: { count: expect.any(Number), bytes: expect.any(Number), personCount: expect.any(Number), personBytes: expect.any(Number) } } });
    expect(JSON.stringify((sent.body as any).warmResources)).not.toMatch(/principalId|threadId|token/);
  });
  it("answers 503 while shutting down", async () => {
    const h = harness({ isShuttingDown: () => true });
    const { sent } = await h.call("/api/health");
    expect(sent).toMatchObject({ status: 503, body: { ok: false, shuttingDown: true, ...HEALTH_IDENTITY } });
  });

  it("gives a session-less bot shell on an organization server the app name only", async () => {
    const h = harness({ isOrganization: () => true });
    const { sent } = await h.call("/api/health", {
      auth: { kind: "loopback", scopes: ["client"], trust: "service" } as RequestAuth,
    });
    expect(sent).toEqual({ status: 200, body: { ...HEALTH_IDENTITY } });
  });

  it("gives a service loopback on a solo server capabilities without engines", async () => {
    const h = harness({ isOrganization: () => false });
    const { sent } = await h.call("/api/health", {
      auth: { kind: "loopback", scopes: ["client"], trust: "service" } as RequestAuth,
    });
    expect(sent?.status).toBe(200);
    expect(sent?.body).toMatchObject({ ...HEALTH_IDENTITY, capabilities: expect.objectContaining({ guardedMessages: 1 }) });
    const body = sent!.body as { engines?: unknown; pid?: unknown };
    expect(body.engines).toBeUndefined();
    expect(body.pid).toBeUndefined();
  });

  it("lists engines for a full caller, sorted, with notAvailable when missing", async () => {
    const h = harness({
      engineNotAvailableReason: (id) => id === "codex" ? "not in this image" : undefined,
    });
    const { sent } = await h.call("/api/health", {
      probes: [
        { instanceId: "codex", driver: "codex", installed: false, at: Date.now(), pinned: true },
        { instanceId: "claude", driver: "claudeAgent", installed: true, version: "1.0", at: Date.now(), pinned: true },
      ],
    });
    expect(sent?.status).toBe(200);
    expect(sent?.body).toMatchObject({
      ...HEALTH_IDENTITY,
      pid: process.pid,
      static: false,
      capabilities: { guardedMessages: 1, guardedRequests: 1, guardedFullAccess: 1, guardedOnBehalfOf: 1 },
      engines: [
        { instanceId: "claude", driver: "claudeAgent", installed: true, version: "1.0" },
        { instanceId: "codex", driver: "codex", installed: false, notAvailable: "not in this image" },
      ],
    });
  });

  it("probes when stale on an organization server, never on solo", async () => {
    let probed = 0;
    const org = harness({
      isOrganization: () => true,
      probeEngines: async () => { probed++; },
      settledWithin: async (promise) => { await promise; },
      registryEntries: () => [{ instanceId: "claude" }],
    });
    await org.call("/api/health");
    expect(probed).toBe(1);

    probed = 0;
    const solo = harness({
      isOrganization: () => false,
      probeEngines: async () => { probed++; },
      registryEntries: () => [{ instanceId: "claude" }],
    });
    await solo.call("/api/health");
    expect(probed).toBe(0);
  });
});

describe("POST /api/browser-engine/install", () => {
  it("refuses a non-JSON content type", async () => {
    const h = harness();
    const { sent } = await h.call("/api/browser-engine/install", {
      method: "POST",
      headers: { "content-type": "text/plain" },
    });
    expect(sent).toEqual({ status: 415, body: { error: "content-type must be application/json" } });
    expect(h.started).toHaveLength(0);
  });

  it("returns 409 when the engine cannot be installed here", async () => {
    const spy = vi.spyOn(browserEngine, "browserEngineStatus").mockReturnValue({
      kind: "unavailable",
      reason: "agent-browser publishes no build for this platform",
      installable: false,
    });
    try {
      const h = harness();
      const { sent } = await h.call("/api/browser-engine/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(sent).toEqual({
        status: 409,
        body: { error: "agent-browser publishes no build for this platform" },
      });
      expect(h.started).toHaveLength(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("starts one install and answers 202; a second call does not start another", async () => {
    const spy = vi.spyOn(browserEngine, "browserEngineStatus").mockReturnValue({
      kind: "unavailable",
      reason: "agent-browser is not installed on this machine yet",
      installable: true,
    });
    const resolveSpy = vi.spyOn(browserEngine, "resolveAgentBrowserBinary").mockReturnValue("/bin/agent-browser");
    const chromeSpy = vi.spyOn(browserEngine, "ensureChrome").mockResolvedValue(undefined);
    try {
      const started: Array<() => Promise<void>> = [];
      const h = harness({
        startInstall: (work) => { started.push(work); },
      });
      const first = await h.call("/api/browser-engine/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(first.sent).toEqual({ status: 202, body: { installing: true } });
      expect(first.broadcasts.length).toBeGreaterThanOrEqual(1);
      expect(started).toHaveLength(1);

      const second = await harness({
        isInstalling: () => true,
        startInstall: () => { throw new Error("must not start"); },
      }).call("/api/browser-engine/install", {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      expect(second.sent).toEqual({ status: 202, body: { installing: true } });
    } finally {
      spy.mockRestore();
      resolveSpy.mockRestore();
      chromeSpy.mockRestore();
    }
  });
});

describe("GET /api/edition and /api/brand", () => {
  it("gives admins the full edition and members the shared view", async () => {
    const h = harness();
    const full = editionStatus();
    const admin = await h.call("/api/edition", {
      auth: { kind: "loopback", scopes: ["admin", "client"] } as never,
    });
    expect(admin.sent).toEqual({ status: 200, body: full });
    const member = await h.call("/api/edition", {
      auth: { kind: "session", via: "cookie", scopes: ["client"], session: {} } as never,
    });
    expect(member.sent).toEqual({ status: 200, body: editionForMembers(full) });
  });

  it("returns the deployment brand", async () => {
    const h = harness();
    const { sent } = await h.call("/api/brand");
    expect(sent?.status).toBe(200);
    expect(sent?.body).toMatchObject({ brand: expect.anything() });
  });
});

describe("foreign paths", () => {
  it("passes other paths", async () => {
    const h = harness();
    expect((await h.call("/api/plan-usage")).out).toBe(PASS);
    expect((await h.call("/api/healthz")).out).toBe(PASS);
    expect((await h.call("/api/browser-engine/install", { method: "GET" })).out).toBe(PASS);
  });
});
