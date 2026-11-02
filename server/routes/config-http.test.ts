import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import {
  createConfigHttpRoutes,
  type ConfigHttpDeps,
} from "./config-http.ts";
import type { RouteContext } from "./table.ts";
import { PASS } from "./table.ts";

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

const delegate: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s2",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_delegate",
  } as never,
};

function harness(over: Partial<ConfigHttpDeps> = {}) {
  const applyPatch = vi.fn(async (ctx: { json: RouteContext["json"]; res: ServerResponse; body: unknown }) => {
    ctx.json(ctx.res, 200, { ok: true, saved: ctx.body });
  });
  const deps: ConfigHttpDeps = {
    configView: () => ({ profile: { name: "Ada" }, language: "en" }),
    identityKind: () => "perspicax",
    callerCan: () => true,
    configAddressField: () => undefined,
    configProviderKeyField: () => undefined,
    experimentalOnlyConfigViolation: () => null,
    permissionRefusal: (key) => ({ error: "forbidden", permission: key, message: `need ${key}` }),
    hostedModels: () => false,
    HOSTED_PROVIDER_SETTINGS_ERROR: "Company models and provider accounts are managed in Admin.",
    profileManagedFor: () => false,
    writesManagedProfile: () => false,
    MANAGED_PROFILE_REFUSAL: { error: "profile managed", code: "managed_profile" },
    applyPatch,
    ...over,
  };
  const route = createConfigHttpRoutes(deps);
  const call = async (
    method: string,
    path: string,
    opts: { body?: unknown; auth?: RequestAuth } = {},
  ) => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const out = await route({
      req: { headers: { "content-type": "application/json" } } as RouteContext["req"],
      res: {} as ServerResponse,
      url: new URL(`http://local${path}`),
      path,
      method,
      auth: opts.auth ?? admin,
      json: ((_res, status, payload) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
      readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
    });
    return { out, sent: sent[0], applyPatch };
  };
  return { call, applyPatch, deps };
}

describe("createConfigHttpRoutes", () => {
  it("PASSes foreign paths", async () => {
    const h = harness();
    expect((await h.call("GET", "/api/mcp/servers")).out).toBe(PASS);
    expect((await h.call("POST", "/api/config")).out).toBe(PASS);
    expect((await h.call("DELETE", "/api/config")).out).toBe(PASS);
  });

  it("GET returns deps.configView(auth)", async () => {
    const view = vi.fn((auth: RequestAuth) => ({
      viewer: auth.kind === "session" ? auth.session.principalId : null,
    }));
    const h = harness({ configView: view });
    const { sent } = await h.call("GET", "/api/config");
    expect(sent).toEqual({ status: 200, body: { viewer: "pr_admin" } });
    expect(view).toHaveBeenCalledWith(admin);
  });

  it("PUT refuses admin_only_field for a Perspicax delegate", async () => {
    const h = harness({
      callerCan: (_auth, key) => key === "server.settings",
    });
    const { sent, applyPatch } = await h.call("PUT", "/api/config", {
      auth: delegate,
      body: { signIn: { admins: ["x"] } },
    });
    expect(sent).toEqual({
      status: 403,
      body: {
        error: "Only an organization admin can change this part of the settings.",
        code: "admin_only_field",
        field: "signIn",
      },
    });
    expect(applyPatch).not.toHaveBeenCalled();

    const address = harness({
      configAddressField: () => "decider.baseUrl",
    });
    expect((await address.call("PUT", "/api/config", {
      auth: delegate,
      body: { decider: { baseUrl: "https://evil.example.test" } },
    })).sent).toMatchObject({
      status: 403,
      body: { code: "admin_only_field", field: "decider.baseUrl" },
    });
  });

  it("PUT refuses hosted provider fields", async () => {
    const h = harness({ hostedModels: () => true });
    const { sent, applyPatch } = await h.call("PUT", "/api/config", {
      body: { openai: { key: "sk-test" } },
    });
    expect(sent).toEqual({
      status: 403,
      body: { error: "Company models and provider accounts are managed in Admin." },
    });
    expect(applyPatch).not.toHaveBeenCalled();
  });

  it("happy PUT calls deps.applyPatch and returns 200", async () => {
    const h = harness();
    const { sent, applyPatch } = await h.call("PUT", "/api/config", {
      body: { language: "fr" },
    });
    expect(applyPatch).toHaveBeenCalledOnce();
    expect(sent).toEqual({ status: 200, body: { ok: true, saved: { language: "fr" } } });
  });
});
