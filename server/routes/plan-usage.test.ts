// Characterization of GET /api/plan-usage: solo admin-only, org needs a person.
import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.ts";
import type { PlanUsageReport } from "../plan-usage.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createPlanUsageRoutes, type PlanUsageRouteDeps } from "./plan-usage.ts";
import { PASS } from "./table.ts";

const ADA = "pr_00000001-0000-4000-8000-000000000000";
const emptyReport: PlanUsageReport = { fetchedAt: "2026-11-01T00:00:00.000Z", providers: [] };

function harness(overrides: Partial<PlanUsageRouteDeps> = {}) {
  const announced: Array<[PlanUsageReport, string]> = [];
  const load = vi.fn(async () => emptyReport);
  const deps: PlanUsageRouteDeps = {
    cfg: () => ({} as AppConfig),
    isOrganization: () => false,
    engineLogins: () => null,
    principals: { byId: () => null },
    perspicaxDirectory: () => null,
    identityIssuer: () => "https://issuer.test",
    localPrincipalId: () => ADA,
    announcePlanThresholds: (report, scope) => { announced.push([report, scope]); },
    loadPlanUsage: load,
    ...overrides,
  };
  const route = createPlanUsageRoutes(deps);
  const call = async (path: string, auth: RequestAuth, query = "") => {
    const sent: Array<{ status: number; body: unknown }> = [];
    const headers: Record<string, string> = {};
    const out = await route({
      req: { headers: {} } as never,
      res: { setHeader: (k: string, v: string) => { headers[k] = v; } } as never,
      url: new URL(`http://localhost${path}${query}`),
      path,
      method: "GET",
      auth,
      json: ((_: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as never,
      readBody: (async () => ({})) as never,
    });
    return { out, sent: sent[0], headers, announced, load };
  };
  return { call, announced, load };
}

const admin: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] } as never;
const member: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: { principalId: ADA } as never,
} as never;
const nameless: RequestAuth = {
  kind: "session", via: "cookie", scopes: ["client"],
  session: {} as never,
} as never;

describe("GET /api/plan-usage", () => {
  it("refuses a non-admin on a solo server", async () => {
    const h = harness();
    const { sent } = await h.call("/api/plan-usage", member);
    expect(sent).toEqual({ status: 403, body: { error: "admin only" } });
    expect(h.load).not.toHaveBeenCalled();
  });

  it("loads the server's accounts for an admin on solo", async () => {
    const h = harness();
    const { sent, headers, announced } = await h.call("/api/plan-usage", admin);
    expect(sent?.status).toBe(200);
    expect(sent?.body).toEqual(emptyReport);
    expect(headers["cache-control"]).toBe("no-store");
    expect(announced).toEqual([[emptyReport, "server"]]);
    expect(h.load).toHaveBeenCalledOnce();
  });

  it("refuses a session that names nobody on an organization server", async () => {
    const h = harness({
      isOrganization: () => true,
      engineLogins: () => ({
        loginDir: () => "/tmp/login",
        signedIn: () => false,
      }),
    });
    const { sent } = await h.call("/api/plan-usage", nameless);
    expect(sent).toEqual({ status: 403, body: { error: "sign in as a person first" } });
  });

  it("loads the person's own accounts on an organization server", async () => {
    const loginDir = vi.fn((_driver?: string) => "/tmp/ada/claude");
    const signedIn = vi.fn((_driver?: string) => true);
    const h = harness({
      isOrganization: () => true,
      engineLogins: () => ({ loginDir: (_id, driver) => loginDir(driver), signedIn: (_id, driver) => signedIn(driver) }),
      principals: {
        byId: (id) => id === ADA ? { subject: { iss: "https://issuer.test", sub: "ada" } } : null,
      },
      perspicaxDirectory: () => ({ providerKeys: () => ["anthropic"] }),
      identityIssuer: () => "https://issuer.test",
    });
    const { sent, announced } = await h.call("/api/plan-usage", member, "?refresh=1");
    expect(sent?.status).toBe(200);
    expect(announced).toEqual([[emptyReport, ADA]]);
    expect(h.load).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }));
  });

  it("passes other paths", async () => {
    const h = harness();
    expect((await h.call("/api/usage", admin)).out).toBe(PASS);
  });
});
