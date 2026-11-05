import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import type { TeamComputerRecord } from "../computer/team-computers.ts";
import { createTeamComputersRoutes, type TeamComputersRouteDeps } from "./team-computers.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;
const sessionAuth = {
  kind: "session",
  scopes: ["admin"],
  session: { id: "s1" },
} as unknown as RequestAuth;

const computer: TeamComputerRecord = {
  id: randomUUID(),
  name: "Desk",
  section: null,
  createdAt: 1,
};

function deps(over: Partial<TeamComputersRouteDeps> = {}): TeamComputersRouteDeps {
  return {
    listPayload: async () => ({ configured: true, computers: [] }),
    get: (id) => (id === computer.id ? computer : undefined),
    create: (name, requestId) => ({ id: requestId, name, section: null, createdAt: 1 }),
    assign: () => undefined,
    setProblem: () => undefined,
    sections: () => ["Ops"],
    sectionKey: (section) => section ?? "",
    bots: () => [],
    botHasActiveTurn: () => false,
    activeRunForBot: () => undefined,
    botComputerControlSnapshot: () => ({ held: false }),
    computerControl: {
      snapshot: () => ({ held: false }),
      take: () => ({ held: true }),
      release: () => ({ held: false }),
      acquireLease: () => ({ snapshot: { held: true }, ok: true }),
      releaseLease: () => ({ snapshot: { held: false }, ok: true }),
    },
    sessionsIsLive: () => true,
    boxProviderBusy: () => false,
    providerTransitionMessage: () => "busy",
    boatLifecycleBusy: () => false,
    claimLifecycle: () => () => undefined,
    claimBotLifecycle: () => () => undefined,
    teamComputerInUse: () => false,
    boatConfigured: () => true,
    findBoat: async () => ({ id: "box" }),
    provisionBoat: async () => ({ ok: true }),
    sleepBoat: async () => ({ ok: true }),
    joinReadyBoat: async () => ({ url: "vnc" }),
    ...over,
  };
}

function ctx(path: string, method: string, body: unknown = null, caller: RequestAuth = auth, contentType = "application/json") {
  const sent: Array<{ status: number; body: unknown }> = [];
  const headers: Record<string, string> = {};
  const context = {
    req: { headers: { "content-type": contentType } } as IncomingMessage,
    res: { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth: caller,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => body) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent, headers };
}

describe("createTeamComputersRoutes", () => {
  it("passes foreign paths including /api/computers/*", async () => {
    const route = createTeamComputersRoutes(deps());
    expect(await route(ctx("/api/computers/boxes", "GET").context)).toBe(PASS);
    expect(await route(ctx("/api/local-computer", "GET").context)).toBe(PASS);
  });

  it("lists team computers", async () => {
    const route = createTeamComputersRoutes(deps());
    const call = ctx("/api/team-computers", "GET");
    await route(call.context);
    expect(call.headers["cache-control"]).toBe("private, no-store");
    expect(call.sent).toEqual([{ status: 200, body: { configured: true, computers: [] } }]);
  });

  it("404s an unknown computer", async () => {
    const route = createTeamComputersRoutes(deps());
    const call = ctx(`/api/team-computers/${randomUUID()}/sleep`, "POST", {});
    await route(call.context);
    expect(call.sent).toEqual([{ status: 404, body: { error: "No such team computer" } }]);
  });

  it("refuses non-JSON mutations", async () => {
    const route = createTeamComputersRoutes(deps());
    const call = ctx(`/api/team-computers/${computer.id}/sleep`, "POST", {}, auth, "text/plain");
    await route(call.context);
    expect(call.sent).toEqual([{ status: 415, body: { error: "content-type must be application/json" } }]);
  });

  it("refuses a dead session on mutate", async () => {
    const route = createTeamComputersRoutes(deps({ sessionsIsLive: () => false }));
    const call = ctx(`/api/team-computers/${computer.id}/sleep`, "POST", {}, sessionAuth);
    await expect(route(call.context)).rejects.toMatchObject({ status: 401 });
  });

  it("creates a computer when Boat is configured", async () => {
    const provisionBoat = vi.fn(async () => ({ ok: true }));
    const requestId = randomUUID();
    const route = createTeamComputersRoutes(deps({ provisionBoat }));
    const call = ctx("/api/team-computers", "POST", {
      requestId,
      name: "Desk",
      acknowledgeCost: true,
    });
    await route(call.context);
    expect(provisionBoat).toHaveBeenCalled();
    expect(call.sent).toEqual([{ status: 201, body: { id: requestId } }]);
  });

  it("refuses create without Boat", async () => {
    const route = createTeamComputersRoutes(deps({ boatConfigured: () => false }));
    const call = ctx("/api/team-computers", "POST", {
      requestId: randomUUID(),
      name: "Desk",
      acknowledgeCost: true,
    });
    await route(call.context);
    expect(call.sent[0]?.status).toBe(409);
  });
});
