// Characterization: provider instance routes extracted from server/index.ts (#1388 P5).
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.ts";
import { HOSTED_PROVIDER_SETTINGS_ERROR } from "../hosted-models.ts";
import { permissionRefusal } from "../../shared/permissions.ts";
import { createInstancesRoutes, type InstancesRouteDeps } from "./instances.ts";
import { PASS } from "./table.ts";

function harness(overrides: Partial<InstancesRouteDeps> = {}) {
  const cfg: AppConfig = {
    instances: {
      claude: { driver: "claudeAgent", displayName: "Claude" },
      mistral: { driver: "mistral", displayName: "Mistral" },
      "claude-extra": { driver: "claudeAgent", displayName: "Work", config: { configDir: "/tmp/claude-extra" } },
    },
  };
  let busy = false;
  const changing = new Set<string>();
  const updates = new Set<string>();
  const instancesList = [{ instanceId: "claude", driverKind: "claudeAgent" }, { instanceId: "mistral", driverKind: "mistral" }];
  const deps: InstancesRouteDeps = {
    cfg,
    dataDir: "/tmp/sagax-test-data",
    hostedModels: false,
    identityKind: () => "solo",
    callerCan: () => false,
    adminOrDelegate: () => false,
    resetPathCache: vi.fn(),
    instancesForViewer: vi.fn(async () => instancesList),
    memberInstanceView: (instance) => ({ ...(instance as object), member: true }),
    clientInstanceView: (instance) => ({ ...(instance as object), readOnly: true }),
    registry: {
      get: (id) => id === "claude" || id === "mistral"
        ? { instanceId: id, driverKind: id === "claude" ? "claudeAgent" : "mistral" } as never
        : null,
      refreshModels: vi.fn(async () => true),
      installRuntime: vi.fn(async () => true),
      forgetSnapshots: vi.fn(),
      cliTarget: (id) => id === "claude" ? { driverKind: "claudeAgent", cli: "/usr/bin/claude" } : null,
    },
    providerAccounts: { list: vi.fn(async () => ({ keys: [] })), setKey: vi.fn(async () => ({ keys: [] })) },
    providerAccountOwner: () => undefined,
    providerAuthSessions: {
      status: vi.fn(async () => ({ phase: "waiting" })),
      start: vi.fn(async () => ({ phase: "waiting" })),
      signOut: vi.fn(async () => undefined),
      complete: vi.fn(async () => undefined),
      cancel: vi.fn(async () => undefined),
      revokeOwner: vi.fn(),
    },
    sessionsIsLive: () => true,
    saveConfig: vi.fn(),
    loadConfig: () => cfg,
    broadcast: vi.fn(),
    configStatus: () => ({ xai: { configured: false } }),
    providerConfigs: () => (cfg.instances ?? {}) as never,
    getProviderConfigBusy: () => busy,
    setProviderConfigBusy: (value) => { busy = value; },
    providerInstancesChanging: { add: (id) => changing.add(id), delete: (id) => changing.delete(id) },
    claudeUpdatesInFlight: { has: (cli) => updates.has(cli), add: (cli) => updates.add(cli), delete: (cli) => updates.delete(cli) },
    persistProviderInstance: vi.fn(async (_id, next) => { cfg.instances = next; }),
    reloadProviders: vi.fn(async () => undefined),
    selfCheckedEngine: () => null,
    cliProbeEnvironment: () => ({ ...process.env }),
    updateClaudeCli: vi.fn(async () => ({ version: "1.0.0" })),
    bots: () => [],
    tasks: () => [],
    threadBusy: () => false,
    botForThread: () => null,
    activeGroupTurnForBot: () => false,
    isProxied: () => false,
    isLoopbackHost: () => true,
    ...overrides,
  };
  const route = createInstancesRoutes(deps);
  const call = async (method: string, path: string, opts: {
    body?: unknown;
    auth?: { kind?: string; scopes?: string[]; session?: { id: string; principalId?: string } };
    contentType?: string | null;
    search?: string;
  } = {}) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const headers = new Map<string, string>();
    const auth = {
      kind: opts.auth?.kind ?? "loopback",
      scopes: opts.auth?.scopes ?? ["admin"],
      ...(opts.auth?.session ? { session: opts.auth.session } : {}),
    };
    const contentType = opts.contentType === null ? undefined : (opts.contentType ?? "application/json");
    const out = await route({
      req: {
        headers: contentType ? { "content-type": contentType } : {},
        socket: { remoteAddress: "127.0.0.1" },
      } as never,
      res: { setHeader: (k: string, v: string) => headers.set(k, v) } as never,
      url: new URL(`http://localhost${path}${opts.search ?? ""}`),
      path,
      method,
      auth: auth as never,
      json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => opts.body ?? {}) as never,
    });
    return { out, sent: sent[0], headers, deps, cfg };
  };
  return { call, deps, cfg, instancesList };
}

describe("instances routes", () => {
  it("passes foreign paths including cli-candidates and cli-test", async () => {
    const { call } = harness();
    expect((await call("GET", "/api/cli-candidates")).out).toBe(PASS);
    expect((await call("POST", "/api/cli-test", { body: { cli: "claude" } })).out).toBe(PASS);
    expect((await call("GET", "/api/bots")).out).toBe(PASS);
    expect((await call("GET", "/api/instances/openai-compat-servers")).out).toBe(PASS);
    expect((await call("POST", "/api/instances/antigravity-accounts", { body: {} })).out).toBe(PASS);
  });

  it("lists instances for an admin and rescan PATH", async () => {
    const { call, deps, instancesList } = harness();
    const result = await call("GET", "/api/instances");
    expect(result.out).toBeUndefined();
    expect(result.sent).toEqual({ status: 200, body: { instances: instancesList } });
    expect(deps.resetPathCache).toHaveBeenCalled();
  });

  it("narrows the list for a client session on a solo server", async () => {
    const { call } = harness();
    const result = await call("GET", "/api/instances", {
      auth: { kind: "session", scopes: ["client"], session: { id: "s1", principalId: "pr_1" } },
    });
    expect(result.sent?.status).toBe(200);
    expect((result.sent!.body as { instances: unknown[] }).instances).toEqual([
      { instanceId: "claude", driverKind: "claudeAgent", readOnly: true },
      { instanceId: "mistral", driverKind: "mistral", readOnly: true },
    ]);
  });

  it("gives a Perspicax engines.manage caller the full list", async () => {
    const { call, instancesList } = harness({
      identityKind: () => "perspicax",
      callerCan: (_auth, key) => key === "engines.manage",
    });
    const result = await call("GET", "/api/instances", {
      auth: { kind: "session", scopes: ["client"], session: { id: "s1", principalId: "pr_1" } },
    });
    expect(result.sent).toEqual({ status: 200, body: { instances: instancesList } });
  });

  it("refuses non-GET instance writes on a hosted workspace", async () => {
    const { call } = harness({ hostedModels: true });
    for (const [method, path, body] of [
      ["POST", "/api/instances/claude-accounts", { displayName: "A" }],
      ["PATCH", "/api/instances/claude", { displayName: "Renamed" }],
      ["DELETE", "/api/instances/claude-extra"],
      ["POST", "/api/instances/claude/refresh-models", {}],
    ] as const) {
      const result = await call(method, path, { body });
      expect(result.sent).toEqual({ status: 403, body: { error: HOSTED_PROVIDER_SETTINGS_ERROR } });
    }
    // GET still works
    expect((await call("GET", "/api/instances")).sent?.status).toBe(200);
  });

  it("refuses company account mutations", async () => {
    const { call } = harness();
    const result = await call("PATCH", "/api/instances/company.acme", { body: { displayName: "Nope" } });
    expect(result.sent).toEqual({
      status: 403,
      body: { error: "Company accounts are read-only here. Manage this connection in desktop Settings." },
    });
  });

  it("refuses a CLI/configDir patch without host.shell", async () => {
    const { call } = harness();
    const result = await call("PATCH", "/api/instances/claude", {
      body: { cli: "/opt/claude" },
      auth: { kind: "session", scopes: ["client"], session: { id: "s1", principalId: "pr_1" } },
    });
    expect(result.sent).toEqual({
      status: 403,
      body: { ...permissionRefusal("host.shell"), field: "cli" },
    });
  });

  it("patches displayName when the caller may manage engines", async () => {
    const { call, deps } = harness({
      adminOrDelegate: () => true,
    });
    // displayName alone does not need host.shell; admin scope also skips the check
    const result = await call("PATCH", "/api/instances/claude-extra", {
      body: { displayName: "Work Claude" },
      auth: { kind: "session", scopes: ["admin"], session: { id: "s1", principalId: "pr_1" } },
    });
    expect(result.sent?.status).toBe(200);
    expect(deps.persistProviderInstance).toHaveBeenCalled();
  });

  it("refuses deleting the default Claude account", async () => {
    const { call } = harness();
    expect((await call("DELETE", "/api/instances/claude")).sent).toEqual({
      status: 400,
      body: { error: "Only added Claude accounts can be removed here." },
    });
  });

  it("removes an added Claude account when unused", async () => {
    const { call, cfg } = harness();
    const result = await call("DELETE", "/api/instances/claude-extra");
    expect(result.sent?.status).toBe(200);
    expect(cfg.instances?.["claude-extra"]).toBeUndefined();
  });
});
