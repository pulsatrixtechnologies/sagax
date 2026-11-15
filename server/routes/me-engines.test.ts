import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import { createMeEnginesRoutes } from "./me-engines.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner" } as unknown as RequestAuth;

function ctx(path: string, method: string, body: unknown = null) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const headers: Record<string, string> = {};
  const context = {
    req: { headers: { "content-type": "application/json" } } as IncomingMessage,
    res: {
      setHeader: (k: string, v: string) => { headers[k] = v; },
    } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth,
    json: ((_res: unknown, status: number, payload: unknown) => {
      sent.push({ status, body: payload });
    }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent, headers };
}

describe("createMeEnginesRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createMeEnginesRoutes({
      localPrincipalId: () => "pr_1",
      isPrincipalId: () => true,
      principals: { byId: () => null },
      IDENTITY: { issuer: "iss" },
    });
    expect(await route(ctx("/api/bots", "GET").context)).toBe(PASS);
  });

  it("refuses a caller who is not a person", async () => {
    const route = createMeEnginesRoutes({
      localPrincipalId: () => "",
      isPrincipalId: () => false,
      principals: { byId: () => null },
      IDENTITY: { issuer: "iss" },
    });
    const call = ctx("/api/me/engines", "GET");
    await route(call.context);
    expect(call.sent[0]).toEqual({ status: 403, body: { error: "sign in as a person first" } });
  });

  it("lists engines for a person", async () => {
    const route = createMeEnginesRoutes({
      localPrincipalId: () => "pr_1",
      isPrincipalId: (id: string) => id === "pr_1",
      principals: { byId: () => ({ id: "pr_1", subject: { iss: "iss", sub: "s" } }) },
      IDENTITY: { issuer: "iss" },
      providerAccountOwner: () => null,
      syncPersonalProviders: vi.fn(),
      orgOfferedEngines: () => [{ instanceId: "e1", live: { driverKind: "openai" } }],
      registry: {
        entries: () => [{ instanceId: "e1", live: { driverKind: "openai" } }],
        get: () => ({ displayName: "E1" }),
      },
      personalProviderInstances: { visible: () => true, get: () => null },
      consoleEngineAllowed: () => true,
      engineInstalled: () => true,
      isLoginDriver: () => false,
      keyOnlyInstance: () => true,
      providersOfInstance: () => [],
      perspicaxDirectory: { providerKeys: () => [] },
      fileKeyConfigured: () => false,
      DATA_DIR: "/tmp",
      driverKeyBacked: () => false,
      cfg: {},
      serverEngineAllowedFor: () => false,
      engineNotAvailableReason: () => undefined,
      engineNameForPerson: (_i: string, name: string) => name,
      engineDisplayName: () => "E1",
      secondLoginSupported: () => false,
      grokAccountsFor: () => [],
      perspicaxKeysUrl: () => undefined,
      subscriptionDriver: () => false,
      loginSlotOf: () => "primary",
      logins: {},
      sessions: {},
    });
    const call = ctx("/api/me/engines", "GET");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    expect((call.sent[0]?.body as { engines: unknown[] } | undefined)?.engines).toHaveLength(1);
  });

  it("keeps a person's own name for one of their accounts, and only for an account they reach (#4376)", async () => {
    const set = vi.fn();
    const route = createMeEnginesRoutes({
      localPrincipalId: () => "pr_1",
      isPrincipalId: (id: string) => id === "pr_1",
      principals: { byId: () => ({ id: "pr_1" }) },
      IDENTITY: { issuer: "iss" },
      orgOfferedEngines: () => [{ instanceId: "codex" }],
      registry: { entries: () => [{ instanceId: "codex" }, { instanceId: "hidden" }] },
      personalProviderInstances: { visible: () => true },
      accountNames: { set },
    });
    const renamed = ctx("/api/me/engines/codex/name", "PUT", { name: "  Work plan " });
    await route(renamed.context);
    expect(renamed.sent[0]).toEqual({ status: 200, body: { ok: true, displayName: "Work plan" } });
    expect(set).toHaveBeenCalledWith("pr_1", "codex", "Work plan");
    const cleared = ctx("/api/me/engines/codex/name", "PUT", { name: "" });
    await route(cleared.context);
    expect(cleared.sent[0]).toEqual({ status: 200, body: { ok: true } });
    const other = ctx("/api/me/engines/hidden/name", "PUT", { name: "Mine" });
    await route(other.context);
    expect(other.sent[0]).toEqual({ status: 404, body: { error: "unknown account" } });
    const long = ctx("/api/me/engines/codex/name", "PUT", { name: "x".repeat(81) });
    await route(long.context);
    expect(long.sent[0]?.status).toBe(400);
    expect(set).toHaveBeenCalledTimes(2);
  });
});
