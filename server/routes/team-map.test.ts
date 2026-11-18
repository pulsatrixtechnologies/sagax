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

  describe("seven-day handoff counts", () => {
    const NOW = 1_000_000_000_000;
    const DAY = 24 * 60 * 60 * 1000;

    it("sends the count per pair with delegates or reviews, busiest first, over the last seven days", async () => {
      const handoffCounts = vi.fn((since: number) => {
        expect(since).toBe(NOW - 7 * DAY);
        return [
          { sourceBotId: "a", targetBotId: "b", count: 3, consult: true, lastAt: NOW - DAY },
          { sourceBotId: "b", targetBotId: "a", count: 9, consult: false, lastAt: NOW - 1000 },
        ];
      });
      const route = createTeamMapRoutes(deps({ handoffCounts, now: () => NOW }));
      const call = ctx("/api/team-map");
      await route(call.context);
      const body = call.sent[0]?.body as { handoffs: unknown[] };
      expect(body.handoffs).toEqual([
        { sourceBotId: "b", targetBotId: "a", count: 9, kind: "delegates", lastAt: NOW - 1000 },
        { sourceBotId: "a", targetBotId: "b", count: 3, kind: "reviews", lastAt: NOW - DAY },
      ]);
    });

    it("never sends a pair that touches a bot the viewer cannot see (isolation)", async () => {
      const route = createTeamMapRoutes(deps({
        bots: () => [{ id: "a" }, { id: "b" }, { id: "x" }],
        visibleFor: () => ({ bot: (id: string) => id !== "x", group: () => true }),
        handoffCounts: () => [
          { sourceBotId: "a", targetBotId: "b", count: 2, consult: false, lastAt: 1 },
          { sourceBotId: "a", targetBotId: "x", count: 50, consult: false, lastAt: 2 },
          { sourceBotId: "x", targetBotId: "b", count: 40, consult: true, lastAt: 3 },
        ],
      }));
      const call = ctx("/api/team-map");
      await route(call.context);
      const body = call.sent[0]?.body as { handoffs: Array<{ sourceBotId: string; targetBotId: string }> };
      expect(body.handoffs.map((pair) => `${pair.sourceBotId}>${pair.targetBotId}`)).toEqual(["a>b"]);
    });

    it("also hides a hidden bot's pairs and answers with an empty list when the host keeps no rows", async () => {
      const hidden = createTeamMapRoutes(deps({
        bots: () => [{ id: "a" }, { id: "b", hidden: true }],
        handoffCounts: () => [{ sourceBotId: "a", targetBotId: "b", count: 4, consult: false, lastAt: 1 }],
      }));
      const first = ctx("/api/team-map");
      await hidden(first.context);
      expect((first.sent[0]!.body as { handoffs: unknown[] }).handoffs).toEqual([]);
      const none = createTeamMapRoutes(deps());
      const second = ctx("/api/team-map");
      await none(second.context);
      expect((second.sent[0]!.body as { handoffs: unknown[] }).handoffs).toEqual([]);
    });
  });
});
