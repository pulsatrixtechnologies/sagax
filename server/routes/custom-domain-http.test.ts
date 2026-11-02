import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import {
  createCustomDomainPublicRoutes,
  createCustomDomainSettingsRoutes,
  type CustomDomainPublicDeps,
  type CustomDomainSettingsDeps,
} from "./custom-domain-http.ts";
import type { PreAuthRouteContext, RouteContext } from "./table.ts";
import { PASS } from "./table.ts";

const HASH = "a".repeat(64);
const CHALLENGE_PATH = `/.well-known/sagax/domain-check/${HASH}`;
const LEGACY_CHALLENGE_PATH = `/.well-known/openmausbot/domain-check/${HASH}`;
const SETTINGS_PATH = "/api/settings/custom-domain";

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

function publicHarness(over: Partial<CustomDomainPublicDeps> = {}) {
  const deps: CustomDomainPublicDeps = {
    challenge: () => null,
    ...over,
  };
  const route = createCustomDomainPublicRoutes(deps);
  const call = async (method: string, path: string) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const headers: Record<string, string> = {};
    const out = await route({
      req: { headers: {} } as PreAuthRouteContext["req"],
      res: { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as ServerResponse,
      url: new URL(`http://local${path}`),
      path,
      method,
      auth: null,
      json: ((_res, status, payload) => { sent.push({ status, body: payload }); }) as PreAuthRouteContext["json"],
      readBody: (async () => ({})) as PreAuthRouteContext["readBody"],
    });
    return { out, sent: sent[0], headers, deps };
  };
  return { call, deps };
}

function settingsHarness(over: Partial<CustomDomainSettingsDeps> = {}) {
  let revision = 1;
  const statusPayload = { customDomain: null, supported: true };
  const deps: CustomDomainSettingsDeps = {
    status: () => statusPayload,
    desktopManaged: false,
    clearDomain: vi.fn(),
    revision: () => revision,
    verify: vi.fn(async () => ({ origin: "https://bots.example.com" })),
    sessionsIsLive: () => true,
    setDomain: vi.fn(),
    ...over,
  };
  const route = createCustomDomainSettingsRoutes(deps);
  const call = async (
    method: string,
    path: string,
    opts: { body?: unknown; auth?: RequestAuth; contentType?: string | null } = {},
  ) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const headers: Record<string, string> = {};
    const contentType = opts.contentType === null
      ? undefined
      : (opts.contentType ?? "application/json");
    const out = await route({
      req: { headers: contentType ? { "content-type": contentType } : {} } as RouteContext["req"],
      res: { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as ServerResponse,
      url: new URL(`http://local${path}`),
      path,
      method,
      auth: opts.auth ?? admin,
      json: ((_res, status, payload) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
      readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
    });
    return { out, sent: sent[0], headers, deps, bumpRevision: () => { revision += 1; } };
  };
  return { call, deps, get revision() { return revision; }, setRevision(n: number) { revision = n; } };
}

describe("createCustomDomainPublicRoutes", () => {
  it("PASSes foreign paths", async () => {
    const h = publicHarness({ challenge: () => ({ proof: "x" }) });
    expect((await h.call("GET", "/api/health")).out).toBe(PASS);
    expect((await h.call("POST", CHALLENGE_PATH)).out).toBe(PASS);
    expect((await h.call("GET", `/.well-known/sagax/domain-check/${"b".repeat(63)}`)).out).toBe(PASS);
  });

  it("domain-check returns 200 with challenge", async () => {
    const challenge = { environmentId: "env", proof: "proof" };
    const h = publicHarness({ challenge: vi.fn(() => challenge) });
    const { sent, out, headers } = await h.call("GET", CHALLENGE_PATH);
    expect(out).toBeUndefined();
    expect(headers["cache-control"]).toBe("no-store");
    expect(sent).toEqual({ status: 200, body: challenge });
    expect(h.deps.challenge).toHaveBeenCalledWith(HASH);

    const legacy = await h.call("GET", LEGACY_CHALLENGE_PATH);
    expect(legacy.sent).toEqual({ status: 200, body: challenge });
  });

  it("domain-check returns 404 when no active check", async () => {
    const h = publicHarness({ challenge: () => null });
    const { sent } = await h.call("GET", CHALLENGE_PATH);
    expect(sent).toEqual({ status: 404, body: { error: "No active domain check." } });
  });
});

describe("createCustomDomainSettingsRoutes", () => {
  it("PASSes foreign paths", async () => {
    const h = settingsHarness();
    expect((await h.call("GET", "/api/config")).out).toBe(PASS);
    expect((await h.call("PUT", SETTINGS_PATH)).out).toBe(PASS);
  });

  it("GET returns deps.status()", async () => {
    const status = vi.fn(() => ({ customDomain: "https://bots.example.com" }));
    const h = settingsHarness({ status });
    const { sent, headers } = await h.call("GET", SETTINGS_PATH);
    expect(headers["cache-control"]).toBe("no-store");
    expect(sent).toEqual({ status: 200, body: { customDomain: "https://bots.example.com" } });
    expect(status).toHaveBeenCalledOnce();
  });

  it("POST desktopManaged returns 409", async () => {
    const h = settingsHarness({ desktopManaged: true });
    const { sent, deps } = await h.call("POST", SETTINGS_PATH, { body: { domain: "bots.example.com" } });
    expect(sent).toEqual({
      status: 409,
      body: { error: "Custom domains are configured on a self-hosted Sagax server, not the desktop companion." },
    });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("POST non-json returns 415", async () => {
    const h = settingsHarness();
    const { sent, deps } = await h.call("POST", SETTINGS_PATH, {
      body: { domain: "bots.example.com" },
      contentType: "text/plain",
    });
    expect(sent).toEqual({ status: 415, body: { error: "content-type must be application/json" } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("POST missing domain returns 400", async () => {
    const h = settingsHarness();
    const { sent, deps } = await h.call("POST", SETTINGS_PATH, { body: {} });
    expect(sent).toEqual({ status: 400, body: { error: "Enter your domain name." } });
    expect(deps.verify).not.toHaveBeenCalled();
  });

  it("POST session ended returns 401", async () => {
    const h = settingsHarness({ sessionsIsLive: () => false });
    const { sent, deps } = await h.call("POST", SETTINGS_PATH, { body: { domain: "bots.example.com" } });
    expect(sent).toEqual({
      status: 401,
      body: { error: "Your session ended. Sign in again before connecting a domain." },
    });
    expect(deps.verify).toHaveBeenCalledWith("bots.example.com");
    expect(deps.setDomain).not.toHaveBeenCalled();
  });

  it("POST revision race returns 409", async () => {
    let n = 1;
    const h = settingsHarness({
      revision: () => n,
      verify: vi.fn(async () => {
        n = 2;
        return { origin: "https://bots.example.com" };
      }),
    });
    const { sent, deps } = await h.call("POST", SETTINGS_PATH, { body: { domain: "bots.example.com" } });
    expect(sent).toEqual({
      status: 409,
      body: { error: "Domain settings changed during verification. Try again." },
    });
    expect(deps.setDomain).not.toHaveBeenCalled();
  });

  it("POST happy path returns 200 and sets domain", async () => {
    const h = settingsHarness();
    const { sent, deps } = await h.call("POST", SETTINGS_PATH, { body: { domain: "bots.example.com" } });
    expect(deps.verify).toHaveBeenCalledWith("bots.example.com");
    expect(deps.setDomain).toHaveBeenCalledWith("https://bots.example.com");
    expect(sent).toEqual({ status: 200, body: { customDomain: null, supported: true } });
  });

  it("DELETE happy path clears domain and returns status", async () => {
    const h = settingsHarness();
    const { sent, deps } = await h.call("DELETE", SETTINGS_PATH, { body: {} });
    expect(deps.clearDomain).toHaveBeenCalledOnce();
    expect(deps.verify).not.toHaveBeenCalled();
    expect(sent).toEqual({ status: 200, body: { customDomain: null, supported: true } });
  });
});
