import { describe, expect, it } from "vitest";

import { createInterimAttachRoutes, interimWindowUntil, suggestedPerson, windowWithDays, type InterimAttachRouteDeps } from "./interim-attach-routes.ts";
import { createPerspicaxOrgRoutes } from "./perspicax/perspicax-org-routes.ts";
import type { Principal } from "./auth/principals.ts";
import type { RequestAuth } from "./auth/request-auth.ts";
import { PASS, type RouteContext } from "./routes/table.ts";

const DAY = 86_400_000;
const EVE_OLD = "pr_11111111-1111-4111-8111-111111111111";
const EVE = "pr_22222222-2222-4222-8222-222222222222";
const MALLORY = "pr_33333333-3333-4333-8333-333333333333";
const LOCAL = "pr_44444444-4444-4444-8444-444444444444";
const OFF = "pr_55555555-5555-4555-8555-555555555555";
const OTHER_ISS = "pr_66666666-6666-4666-8666-666666666666";

const people: Principal[] = [
  { id: EVE_OLD, kind: "human", email: "eve@example.test", createdAt: 1 },
  { id: EVE, kind: "human", email: "eve@example.test", subject: { iss: "https://px.test", sub: "E" }, createdAt: 2 },
  { id: MALLORY, kind: "human", email: "mallory@example.test", subject: { iss: "https://px.test", sub: "M" }, createdAt: 3 },
  { id: LOCAL, kind: "human", local: true, createdAt: 4 },
  { id: OFF, kind: "human", subject: { iss: "https://px.test", sub: "O" }, disabledAt: 5, createdAt: 5 },
  { id: OTHER_ISS, kind: "human", subject: { iss: "https://elsewhere.test", sub: "X" }, createdAt: 6 },
];
const admin: RequestAuth = { kind: "loopback", scopes: ["admin", "client"] };
const member = { kind: "session", via: "cookie", scopes: ["client"], session: { id: "s", principalId: MALLORY } } as unknown as RequestAuth;

function harness(overrides: Partial<InterimAttachRouteDeps> = {}) {
  const attached: unknown[] = [];
  let merged = false;
  const deps: InterimAttachRouteDeps = {
    isAdmin: (auth) => auth.kind === "loopback",
    window: () => ({ since: 0, days: 30 }),
    now: () => DAY,
    interim: () => (merged ? [] : [people[0]!]),
    byId: (id) => {
      const found = people.find((person) => person.id === id);
      return found && found.id === EVE_OLD && merged ? { ...found, mergedInto: EVE } : found ?? null;
    },
    isTarget: (person) => person.subject?.iss === "https://px.test",
    directory: () => [
      { principalId: EVE, name: "Eve", login: "eve", email: "eve@example.test", disabled: false },
      { principalId: MALLORY, name: "Mallory", login: "mallory", email: "mallory@example.test", disabled: false },
    ],
    counts: () => ({ bots: 1, rooms: 1, routines: 0 }),
    attach: (input) => {
      attached.push({ from: input.from, to: input.to });
      merged = true;
      return { rewritten: { bots: 1, grants: 1, rooms: 1, sections: 0, routines: 0 }, sessionsRevoked: 2 };
    },
    ...overrides,
  };
  const route = createInterimAttachRoutes(deps);
  const call = async (auth: RequestAuth, method: string, path: string, body: unknown = {}) => {
    const out: { status?: number; body?: unknown } = {};
    const result = await route({
      req: {}, res: { setHeader: () => {} }, path, method, auth,
      json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
      readBody: async () => body,
    } as unknown as RouteContext);
    return { ...out, passed: result === PASS };
  };
  return { call, attached };
}

describe("interim attach window", () => {
  it("is open until since + days and closes at 0 days", () => {
    expect(interimWindowUntil(undefined, 1)).toBeNull();
    expect(interimWindowUntil({ since: 0, days: 30 }, DAY)).toBe(30 * DAY);
    expect(interimWindowUntil({ since: 0, days: 30 }, 30 * DAY)).toBeNull();
    expect(interimWindowUntil(windowWithDays({ since: 0, days: 30 }, 0, DAY), DAY)).toBeNull();
    expect(windowWithDays(undefined, 10, 7)).toEqual({ since: 7, days: 10 });
  });

  it("suggests a person only when exactly one active person carries the address", () => {
    const eve = { principalId: EVE, name: "Eve", login: "eve", email: "EVE@example.test", disabled: false };
    expect(suggestedPerson("eve@example.test", [eve])).toEqual({ principalId: EVE, name: "Eve", login: "eve" });
    expect(suggestedPerson("eve@example.test", [eve, { ...eve, principalId: MALLORY }])).toBeNull();
    expect(suggestedPerson("eve@example.test", [{ ...eve, disabled: true }])).toBeNull();
    expect(suggestedPerson(undefined, [eve])).toBeNull();
  });
});

describe("GET and POST /api/org/interim-people", () => {
  it("lists interim people with counts and a suggestion, for admins only", async () => {
    const h = harness();
    expect(await h.call(member, "GET", "/api/org/interim-people")).toMatchObject({ status: 403, body: { code: "forbidden" } });
    expect(await h.call(admin, "GET", "/api/org/interim-people")).toMatchObject({
      status: 200,
      body: { until: 30 * DAY, people: [{ principalId: EVE_OLD, email: "eve@example.test", bots: 1, rooms: 1, routines: 0, suggested: { principalId: EVE, name: "Eve", login: "eve" } }] },
    });
  });

  it("answers 410 when the window is closed", async () => {
    const h = harness({ window: () => ({ since: 0, days: 0 }) });
    expect(await h.call(admin, "GET", "/api/org/interim-people")).toMatchObject({ status: 410, body: { code: "interim_attach_closed" } });
    expect(await h.call(admin, "POST", "/api/org/interim-people/attach", { interimPrincipalId: EVE_OLD, principalId: EVE })).toMatchObject({ status: 410 });
    expect(h.attached).toEqual([]);
  });

  it("refuses unknown people, non-interim sources and bad targets", async () => {
    const h = harness();
    const attach = (body: unknown, auth: RequestAuth = admin) => h.call(auth, "POST", "/api/org/interim-people/attach", body);
    expect(await attach({ interimPrincipalId: EVE_OLD, principalId: EVE }, member)).toMatchObject({ status: 403 });
    expect(await attach({ interimPrincipalId: "pr_00000000-0000-4000-8000-000000000000", principalId: EVE })).toMatchObject({ status: 404, body: { code: "unknown_person" } });
    expect(await attach({ interimPrincipalId: EVE_OLD })).toMatchObject({ status: 404, body: { code: "unknown_person" } });
    expect(await attach({ interimPrincipalId: MALLORY, principalId: EVE })).toMatchObject({ status: 400, body: { code: "not_interim" } });
    expect(await attach({ interimPrincipalId: LOCAL, principalId: EVE })).toMatchObject({ status: 400, body: { code: "not_interim" } });
    for (const target of [LOCAL, OFF, OTHER_ISS, EVE_OLD]) {
      expect(await attach({ interimPrincipalId: EVE_OLD, principalId: target })).toMatchObject({ status: 400, body: { code: "bad_target" } });
    }
    expect(h.attached).toEqual([]);
  });

  it("attaches once; a second attach of the same person is not_interim", async () => {
    const h = harness();
    expect(await h.call(admin, "POST", "/api/org/interim-people/attach", { interimPrincipalId: EVE_OLD, principalId: EVE })).toEqual({
      status: 200, passed: false,
      body: { attached: { from: EVE_OLD, to: EVE }, rewritten: { bots: 1, grants: 1, rooms: 1, sections: 0, routines: 0 }, sessionsRevoked: 2 },
    });
    expect(await h.call(admin, "POST", "/api/org/interim-people/attach", { interimPrincipalId: EVE_OLD, principalId: EVE })).toMatchObject({ status: 400, body: { code: "not_interim" } });
    expect(h.attached).toEqual([{ from: EVE_OLD, to: EVE }]);
  });

  it("passes other paths and refuses other methods", async () => {
    const h = harness();
    expect((await h.call(admin, "GET", "/api/org/directory")).passed).toBe(true);
    expect(await h.call(admin, "DELETE", "/api/org/interim-people")).toMatchObject({ status: 405 });
  });
});

describe("PATCH /api/org/settings interimAttachDays", () => {
  function settingsRoute(saved: unknown[]) {
    const route = createPerspicaxOrgRoutes({
      issuer: "https://px.test", orgName: "Acme", directory: () => null, bySubject: () => null,
      viewerRole: (auth) => (auth.kind === "loopback" ? "admin" : "member"),
      settings: () => ({ orgKeyConfigured: false, allowFullAccess: true, memberEnvironmentAutonomy: true, memberAutoApproval: true, interimAttach: { until: null, people: 1 } }),
      saveInterimAttachDays: (days) => saved.push({ days }),
      pendingAdminApprovals: () => [],
    });
    return async (auth: RequestAuth, body: unknown) => {
      const out: { status?: number; body?: unknown } = {};
      await route({
        req: {}, res: { setHeader: () => {} }, path: "/api/org/settings", method: "PATCH", auth,
        json: (_res: unknown, status: number, value: unknown) => { out.status = status; out.body = value; },
        readBody: async () => body,
      } as unknown as RouteContext);
      return out;
    };
  }

  it("accepts 0 to 90 days from an admin; the old org key switch is refused (2026-10-01)", async () => {
    const saved: unknown[] = [];
    const patch = settingsRoute(saved);
    expect(await patch(admin, { interimAttachDays: 0 })).toMatchObject({ status: 200, body: { settings: { interimAttach: { until: null, people: 1 } } } });
    expect(await patch(admin, { interimAttachDays: 90 })).toMatchObject({ status: 200 });
    expect(saved).toEqual([{ days: 0 }, { days: 90 }]);
    for (const bad of [{ interimAttachDays: 91 }, { interimAttachDays: -1 }, { interimAttachDays: 1.5 }, { interimAttachDays: "3" }, {}, { other: 1 }, { memberBotsUseOrgKey: true }, { interimAttachDays: 3, memberBotsUseOrgKey: true }]) {
      expect(await patch(admin, bad)).toMatchObject({ status: 400 });
    }
    expect(await patch(member, { interimAttachDays: 0 })).toMatchObject({ status: 403 });
    expect(saved).toHaveLength(2);
  });
});
