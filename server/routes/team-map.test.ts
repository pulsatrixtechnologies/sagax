import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createTeamMapRoutes,
  type TeamMapRouteDeps,
} from "./team-map.ts";
import { PASS, type RouteContext } from "./table.ts";

const auth = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;

function deps(over: Partial<TeamMapRouteDeps> = {}): TeamMapRouteDeps {
  return {
    bots: () => [{ id: "a" }, { id: "b" }],
    groups: () => [{
      id: "g1",
      dm: true,
      memberIds: ["a", "b"],
      threadId: "t-dm",
      createdAt: 10,
    }],
    messagesFor: () => [{ at: 42 }],
    group: (id) => (id === "g1" ? {
      id: "g1",
      dm: true,
      memberIds: ["a", "b"],
      threadId: "t-dm",
      createdAt: 10,
    } : undefined),
    visibleFor: () => ({ bot: () => true, group: () => true }),
    delegationWatchEntries: () => new Map([
      ["t-run", { toBotId: "b", sourceBotId: "a" }],
    ]).entries(),
    liveHandoffEdges: () => [{
      state: "queued" as const,
      sourceBotId: "a",
      targetBotId: "b",
      threadId: "t-handoff",
    }],
    ...over,
  };
}

function ctx(path: string, method = "GET", caller: RequestAuth = auth) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const context = {
    req: {} as IncomingMessage,
    res: {} as ServerResponse,
    url: new URL(`http://x${path}`),
    path,
    method,
    auth: caller,
    json: ((_res: unknown, status: number, payload: unknown) => { sent.push({ status, body: payload }); }) as RouteContext["json"],
    readBody: (async () => null) as RouteContext["readBody"],
  } satisfies RouteContext;
  return { context, sent };
}

describe("createTeamMapRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createTeamMapRoutes(deps());
    expect(await route(ctx("/api/teams/export", "POST").context)).toBe(PASS);
    expect(await route(ctx("/api/team-map", "POST").context)).toBe(PASS);
    expect(await route(ctx("/api/routines").context)).toBe(PASS);
  });

  it("returns collaborations, queued handoffs and running delegations", async () => {
    const route = createTeamMapRoutes(deps());
    const call = ctx("/api/team-map");
    await route(call.context);
    expect(call.sent[0]?.status).toBe(200);
    const body = call.sent[0]?.body as {
      collaborations: unknown[];
      queued: unknown[];
      running: unknown[];
    };
    expect(body.collaborations).toEqual([{
      groupId: "g1",
      botIds: ["a", "b"],
      lastAt: 42,
    }]);
    expect(body.queued).toEqual([{
      sourceBotId: "a",
      targetBotId: "b",
      threadId: "t-handoff",
    }]);
    expect(body.running).toEqual([{
      sourceBotId: "a",
      targetBotId: "b",
      threadId: "t-run",
      groupId: undefined,
    }]);
  });

  it("hides bots the viewer cannot see", async () => {
    const visibleFor = vi.fn(() => ({ bot: (id: string) => id === "a", group: () => false }));
    const route = createTeamMapRoutes(deps({
      visibleFor,
      liveHandoffEdges: () => [{
        state: "running" as const,
        sourceBotId: "a",
        targetBotId: "b",
        threadId: "t-x",
      }],
      delegationWatchEntries: () => new Map().entries(),
    }));
    const call = ctx("/api/team-map");
    await route(call.context);
    expect(visibleFor).toHaveBeenCalledOnce();
    const body = call.sent[0]?.body as { collaborations: unknown[]; running: unknown[]; queued: unknown[] };
    expect(body.collaborations).toEqual([]);
    expect(body.running).toEqual([]);
    expect(body.queued).toEqual([]);
  });
});
