import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createRoutinesHttpRoutes,
  type RoutinesHttpDeps,
} from "./routines-http.ts";
import type { RouteContext } from "./table.ts";
import { PASS } from "./table.ts";

const member: RequestAuth = {
  kind: "session",
  via: "cookie",
  scopes: ["client"],
  session: {
    id: "s1",
    label: "web",
    scopes: ["client"],
    createdAt: 0,
    expiresAt: 0,
    lastUsedAt: 0,
    principalId: "pr_member",
  } as never,
};

const routine = {
  id: "r1",
  botId: "b1",
  name: "Morning",
  schedule: { kind: "cron" as const, expr: "0 9 * * *" },
};

function deps(over: Partial<RoutinesHttpDeps> = {}): RoutinesHttpDeps {
  return {
    listRoutines: () => [routine as never],
    listRuns: () => [],
    listFolders: () => ({ b1: ["General"] }),
    create: () => routine as never,
    wakeHold: () => ({ hold: false }),
    runNow: () => ({ id: "run1", routineId: "r1", botId: "b1", routineName: "Morning" } as never),
    runStanding: () => null,
    markAllSeen: () => [],
    clearRuns: () => [],
    cancelRun: async () => ({ id: "run1" } as never),
    markSeen: () => ({ id: "run1" } as never),
    routineBotId: (id) => (id === "r1" ? "b1" : undefined),
    inFlightRun: () => undefined,
    visible: () => ({ everything: true, bot: () => true, group: () => true }),
    viewerId: () => "pr_member",
    scopeCaller: () => ({ admin: false, viewTeam: false, viewAll: false, teamIds: [] }),
    scopeDeps: () => ({
      mine: () => true,
      facts: () => ({
        ownerId: "pr_owner",
        ownerName: "Owner",
        teamIds: [],
        bot: { id: "b1", name: "Ada" },
      }),
      canRun: () => true,
      canEdit: () => true,
      wire: (r: unknown) => r as object,
      teamName: () => undefined,
    }),
    needsRun: () => false,
    needsRunBody: NEEDS_RUN,
    hiddenTarget: () => null,
    resultsRefusal: () => null,
    runAsChoice: () => ({}),
    actorKey: () => "actor",
    nobodyKey: () => "nobody",
    withWriter: (_w, work) => work(),
    routineActor: () => ({ actorPrincipalId: "pr_member" }),
    isTriggerSchedule: () => false,
    bindOwnedTrigger: () => undefined,
    auditRunAs: () => undefined,
    onWire: (r) => r,
    mayRunNow: () => true,
    receiptFacts: () => ({ botName: "Ada", reportsTo: "chat" }),
    auditRunNow: () => undefined,
    routineVisible: () => true,
    routineSeenBy: () => true,
    runAsChooser: () => ({ principalId: "pr_member", admin: false, manager: false, managedTeamIds: [] }),
    runAsPeople: () => [],
    bot: (id) => (id === "b1" ? { id: "b1", ownerUserId: "pr_owner" } : null),
    botOwner: () => "pr_owner",
    principalMayRun: () => true,
    consentActive: () => false,
    principalName: () => ({ name: "Ada", login: "ada" }),
    patchAs: () => ({ status: 200, body: { routine } }),
    deleteAs: () => ({ status: 200, body: { ok: true } }),
    mayCancel: () => true,
    auditCleared: () => undefined,
    effectiveRunAs: () => "pr_member",
    ...over,
  };
}

const NEEDS_RUN = { error: "you need the right to run this bot's routines", code: "needs_run" } as const;

function call(
  route: ReturnType<typeof createRoutinesHttpRoutes>,
  over: Partial<RouteContext> & { body?: unknown; search?: string } = {},
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const { body, search, ...rest } = over;
  const path = rest.path ?? "/api/routines";
  const ctx: RouteContext = {
    req: { headers: {} } as RouteContext["req"],
    res: { setHeader: () => undefined } as unknown as ServerResponse,
    url: new URL(`http://local${path}${search ?? ""}`),
    path,
    method: rest.method ?? "GET",
    auth: rest.auth ?? member,
    json: ((_res, status, out) => {
      sent.push({ status, body: out });
    }) as RouteContext["json"],
    readBody: async () => body ?? {},
    ...rest,
  };
  return { ctx, sent, run: () => route(ctx) };
}

describe("routine effort HTTP", () => {
  it("passes effort through POST and preserves a null reset through PATCH", async () => {
    const create = vi.fn((_body: unknown) => routine as never);
    const patchAs = vi.fn((_auth: unknown, _req: unknown, _id: string, _body: unknown) => ({ status: 200, body: { routine } }));
    const route = createRoutinesHttpRoutes(deps({ create, patchAs }));
    const created = call(route, { method: "POST", body: { botId: "b1", model: "fast", effort: "low" } });
    await created.run();
    expect(created.sent[0]?.status).toBe(201);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: "fast", effort: "low" });
    const changed = call(route, { path: "/api/routines/r1", method: "PATCH", body: { effort: null } });
    await changed.run();
    expect(changed.sent[0]?.status).toBe(200);
    expect(patchAs.mock.calls[0]?.[3]).toEqual({ effort: null });
  });
});

describe("routine readiness HTTP", () => {
  it("keeps the run-as options route ahead of generic routine detail", async () => {
    const route = createRoutinesHttpRoutes(deps());
    const request = call(route, { path: "/api/routines/run-as-options", search: "?botId=b1" });
    await request.run();
    expect(request.sent[0]?.status).toBe(200);
  });
  it("checks with Run now rights without creating a run, and returns the last readiness on detail", async () => {
    const answer = { ok: false, checks: [{ kind: "skills", ok: false, code: "skill_missing", params: { skill: "inbox-review" }, line: "Missing skill. Assign it." }], checkedAt: 123 } as const;
    const check = vi.fn(async () => ({ ...answer, checks: [...answer.checks] }));
    const runNow = vi.fn();
    const route = createRoutinesHttpRoutes(deps({ check, runNow, listRuns: () => [{ routineId: "r1", createdAt: 1, readiness: answer.checks }] as never }));
    const request = call(route, { path: "/api/routines/r1/check", method: "POST" });
    await request.run();
    expect(request.sent[0]).toEqual({ status: 200, body: answer });
    expect(check).toHaveBeenCalledTimes(1); expect(runNow).not.toHaveBeenCalled();
    const bridge = call(route, { path: "/api/routines/r1/run", method: "POST", body: { action: "check" } }); await bridge.run();
    expect(bridge.sent[0]).toEqual({ status: 200, body: answer }); expect(runNow).not.toHaveBeenCalled();
    const detail = call(route, { path: "/api/routines/r1" }); await detail.run();
    expect(detail.sent[0]?.body).toMatchObject({ readiness: answer.checks, lastRun: { readiness: answer.checks } });
  });
  it("withholds another person's latest readiness and output on detail", async () => {
    const base = deps();
    const route = createRoutinesHttpRoutes(deps({ listRuns: () => [{ routineId: "r1", createdAt: 1, output: "private report", readiness: [{ code: "mcp_missing" }] }] as never,
      scopeDeps: (...args) => ({ ...base.scopeDeps(...args), mine: () => false }) }));
    const request = call(route, { path: "/api/routines/r1" }); await request.run();
    expect(request.sent[0]?.body).toMatchObject({ lastRun: { redacted: true } });
    expect((request.sent[0]?.body as { readiness?: unknown } | undefined)?.readiness).toBeUndefined();
    expect(JSON.stringify(request.sent[0]?.body)).not.toContain("private report");
  });
  it("refuses missing run rights, a foreign routine, and a hidden target", async () => {
    for (const over of [{ needsRun: () => true }, { mayRunNow: () => false }, { routineVisible: () => false }]) {
      const check = vi.fn();
      const route = createRoutinesHttpRoutes(deps({ ...over, check }));
      const request = call(route, { path: "/api/routines/r1/check", method: "POST" }); await request.run();
      expect(request.sent[0]?.status).toBe(over.routineVisible ? 404 : 403);
      expect(check).not.toHaveBeenCalled();
    }
  });
});

describe("createRoutinesHttpRoutes", () => {
  it("PASS for foreign paths", async () => {
    const route = createRoutinesHttpRoutes(deps());
    expect(await route(call(route, { path: "/api/webhooks" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/calendar-calls" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/bots" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/routines/bulk", method: "POST" }).ctx)).toBe(PASS);
  });

  it("GET /api/routines refuses a forbidden scope", async () => {
    const route = createRoutinesHttpRoutes(deps());
    const { sent, run } = call(route, { path: "/api/routines", search: "?scope=all" });
    await run();
    expect(sent[0]?.status).toBe(403);
    expect(sent[0]?.body).toMatchObject({ code: "routine_scope_not_allowed" });
  });

  it("GET /api/routines happy path returns listing and folders", async () => {
    const route = createRoutinesHttpRoutes(deps());
    const { sent, run } = call(route, { path: "/api/routines" });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({
      routines: [routine],
      folders: { b1: ["General"] },
    });
  });

  it("POST /api/routines refuses without run right", async () => {
    const route = createRoutinesHttpRoutes(deps({ needsRun: () => true }));
    const { sent, run } = call(route, { path: "/api/routines", method: "POST", body: { botId: "b1" } });
    await run();
    expect(sent[0]).toEqual({ status: 403, body: NEEDS_RUN });
  });

  // #2622: the owner may turn off "collaborators can create routines".
  it("POST /api/routines refuses a collaborator when the owner turned it off", async () => {
    const create = vi.fn(() => routine as never);
    const refusal = { error: "the owner of this bot does not let collaborators create routines", code: "collaborators_cannot_create_routines" };
    const route = createRoutinesHttpRoutes(deps({ create, createRefused: (_auth, botId) => (botId === "b1" ? refusal : null) }));
    const { sent, run } = call(route, { path: "/api/routines", method: "POST", body: { botId: "b1" } });
    await run();
    expect(sent[0]).toEqual({ status: 403, body: refusal });
    expect(create).not.toHaveBeenCalled();
  });

  it("POST /api/routines creates and returns 201", async () => {
    const create = vi.fn(() => routine as never);
    const route = createRoutinesHttpRoutes(deps({ create }));
    const { sent, run } = call(route, { path: "/api/routines", method: "POST", body: { botId: "b1", name: "Morning" } });
    await run();
    expect(create).toHaveBeenCalled();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ routine });
  });

  it("POST /api/routines/:id/run refuses without run-now right", async () => {
    const route = createRoutinesHttpRoutes(deps({ mayRunNow: () => false }));
    const { sent, run } = call(route, { path: "/api/routines/r1/run", method: "POST" });
    await run();
    expect(sent[0]?.status).toBe(403);
    expect(sent[0]?.body).toMatchObject({ code: "run_now_not_allowed" });
  });

  it("POST /api/routines/:id/run happy path", async () => {
    const route = createRoutinesHttpRoutes(deps());
    const { sent, run } = call(route, { path: "/api/routines/r1/run", method: "POST" });
    await run();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ run: { id: "run1" }, message: expect.any(String) });
  });

  it("PATCH /api/routines/:id relays patchAs", async () => {
    const patchAs = vi.fn(() => ({ status: 200, body: { routine } }));
    const route = createRoutinesHttpRoutes(deps({ patchAs }));
    const { sent, run } = call(route, { path: "/api/routines/r1", method: "PATCH", body: { enabled: false } });
    await run();
    expect(patchAs).toHaveBeenCalled();
    expect(sent[0]).toEqual({ status: 200, body: { routine } });
  });

  it("DELETE /api/routines/:id relays deleteAs refusal", async () => {
    const route = createRoutinesHttpRoutes(deps({
      deleteAs: () => ({ status: 403, body: NEEDS_RUN }),
    }));
    const { sent, run } = call(route, { path: "/api/routines/r1", method: "DELETE" });
    await run();
    expect(sent[0]).toEqual({ status: 403, body: NEEDS_RUN });
  });

  it("POST /api/routine-runs/:id/cancel refuses without cancel right", async () => {
    const route = createRoutinesHttpRoutes(deps({
      listRuns: () => [{ id: "run1", botId: "b1", routineId: "r1" } as never],
      mayCancel: () => false,
    }));
    const { sent, run } = call(route, { path: "/api/routine-runs/run1/cancel", method: "POST" });
    await run();
    expect(sent[0]?.status).toBe(403);
    expect(sent[0]?.body).toMatchObject({ code: "run_now_not_allowed" });
  });

  it("GET /api/routines/wake returns wake hold", async () => {
    const route = createRoutinesHttpRoutes(deps({ wakeHold: () => ({ hold: true, reason: "running" }) }));
    const { sent, run } = call(route, { path: "/api/routines/wake" });
    await run();
    expect(sent[0]).toEqual({ status: 200, body: { hold: true, reason: "running" } });
  });
});
