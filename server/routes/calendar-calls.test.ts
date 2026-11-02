import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import {
  calendarAudienceConflict,
  createCalendarCallsRoutes,
  type CalendarCallsRouteDeps,
} from "./calendar-calls.ts";
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

const callRow = {
  id: "c1",
  botIds: ["b1", "b2"],
  title: "Standup",
  startsAt: 1,
};

function deps(over: Partial<CalendarCallsRouteDeps> = {}): CalendarCallsRouteDeps {
  return {
    list: () => [callRow as never],
    get: (id) => (id === "c1" ? callRow as never : null),
    create: (body) => ({ ...callRow, ...(body as object) } as never),
    update: (id, body) => ({ ...callRow, id, ...(body as object) } as never),
    remove: (id) => id === "c1",
    viewerEverything: () => true,
    botVisible: () => true,
    needsRun: () => false,
    roomAudienceConflict: () => null,
    ensureRoom: () => ({ id: "g1", threadId: "t1", memberIds: ["b1", "b2"] } as never),
    publicGroup: (group) => group,
    projectMessages: () => [],
    approvalViewer: () => ({ kind: "all" } as never),
    messagesFor: () => [],
    ...over,
  };
}

function call(
  route: ReturnType<typeof createCalendarCallsRoutes>,
  over: Partial<RouteContext> & { body?: unknown } = {},
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const { body, ...rest } = over;
  const path = rest.path ?? "/api/calendar-calls";
  const ctx: RouteContext = {
    req: { headers: {} } as RouteContext["req"],
    res: {} as ServerResponse,
    url: new URL(`http://local${path}`),
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

describe("calendarAudienceConflict", () => {
  it("returns null for one bot or non-arrays", () => {
    expect(calendarAudienceConflict({ botIds: ["b1"] }, () => "nope")).toBeNull();
    expect(calendarAudienceConflict({}, () => "nope")).toBeNull();
  });

  it("relays roomAudienceConflict for several bots", () => {
    expect(calendarAudienceConflict({ botIds: ["b1", "b2"] }, () => "mismatch")).toBe("mismatch");
  });
});

describe("createCalendarCallsRoutes", () => {
  it("PASS for foreign paths", async () => {
    const route = createCalendarCallsRoutes(deps());
    expect(await route(call(route, { path: "/api/routines" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/webhooks" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/bots" }).ctx)).toBe(PASS);
  });

  it("GET /api/calendar-calls lists visible calls", async () => {
    const route = createCalendarCallsRoutes(deps());
    const { sent, run } = call(route, { path: "/api/calendar-calls" });
    await run();
    expect(sent[0]).toEqual({ status: 200, body: { calls: [callRow] } });
  });

  it("POST /api/calendar-calls refuses without run right", async () => {
    const route = createCalendarCallsRoutes(deps({
      viewerEverything: () => false,
      needsRun: () => true,
    }));
    const { sent, run } = call(route, {
      path: "/api/calendar-calls",
      method: "POST",
      body: { botIds: ["b1"], title: "x", startsAt: 1 },
    });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("POST /api/calendar-calls happy path", async () => {
    const create = vi.fn(() => callRow as never);
    const route = createCalendarCallsRoutes(deps({ create }));
    const { sent, run } = call(route, {
      path: "/api/calendar-calls",
      method: "POST",
      body: { botIds: ["b1", "b2"], title: "Standup", startsAt: 1 },
    });
    await run();
    expect(create).toHaveBeenCalled();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ call: callRow });
  });

  it("POST /api/calendar-calls/:id/room refuses when needs run", async () => {
    // Existing call with needsRun: calendarCallRefusal answers 404 (like a missing call).
    const route = createCalendarCallsRoutes(deps({
      viewerEverything: () => false,
      needsRun: () => true,
    }));
    const { sent, run } = call(route, { path: "/api/calendar-calls/c1/room", method: "POST" });
    await run();
    expect(sent[0]?.status).toBe(404);
  });

  it("POST /api/calendar-calls/:id/room happy path", async () => {
    const route = createCalendarCallsRoutes(deps());
    const { sent, run } = call(route, { path: "/api/calendar-calls/c1/room", method: "POST" });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({ group: { id: "g1", messages: [] } });
  });

  it("DELETE /api/calendar-calls/:id returns 404 when missing", async () => {
    const route = createCalendarCallsRoutes(deps({ get: () => null, remove: () => false }));
    const { sent, run } = call(route, { path: "/api/calendar-calls/missing", method: "DELETE" });
    await run();
    expect(sent[0]).toEqual({ status: 404, body: { error: "no such scheduled call" } });
  });

  it("DELETE /api/calendar-calls/:id happy path", async () => {
    const route = createCalendarCallsRoutes(deps());
    const { sent, run } = call(route, { path: "/api/calendar-calls/c1", method: "DELETE" });
    await run();
    expect(sent[0]).toEqual({ status: 200, body: { ok: true } });
  });
});
