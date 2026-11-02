// Characterization of the I5a bot-to-bot chat routes moved out of
// server/index.ts (#1388): ask-bot, delegations, retry-thread, delegate-bot,
// room-targets, coordinate-bots.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import {
  createInternalBotChatRoutes,
  type InternalBotChatBot,
  type InternalBotChatDeps,
} from "./internal-bot-chat.ts";
import { PASS } from "./table.ts";

const BOT: InternalBotChatBot = {
  id: "bot-1",
  name: "Ada",
  color: "#111",
  title: "Lead",
  section: "General",
  chiefOfStaff: true,
  threadId: "t-main",
  busy: false,
};

const PEER: InternalBotChatBot = {
  id: "bot-2",
  name: "Bea",
  color: "#222",
  title: "Peer",
  section: "General",
  threadId: "t-peer",
  busy: false,
};

function baseDeps(over: Partial<InternalBotChatDeps> = {}): InternalBotChatDeps {
  const bots = [BOT, PEER];
  return {
    store: {
      bot: (id) => bots.find((b) => b.id === id),
      get bots() { return bots; },
      group: () => undefined,
      groupByThread: () => undefined,
      groups: [],
      taskByThread: (botId, threadId) =>
        botId === PEER.id && threadId === "t-peer"
          ? { threadId: "t-peer", title: "Peer task" }
          : undefined,
      activePath: () => [],
      appendMessage: () => ({ id: "msg-1" }),
      messagesFor: () => [],
      createTask: () => ({ threadId: "t-new", title: "New" }),
      deleteTask: () => undefined,
      workThread: () => undefined,
    },
    startTurn: vi.fn(async () => undefined),
    coordinator: {
      node: () => null,
      has: () => false,
      enqueue: () => ({ node: { id: "n1", botId: PEER.id, threadId: "t-new", status: "queued" } }),
      tick: () => undefined,
    },
    approvalBus: {} as InternalBotChatDeps["approvalBus"],
    delegationWatch: new Map(),
    phoneToolTaintedThreads: new Set(),
    incidentLedger: { lastAt: () => undefined, countInWindow: () => 0 },
    threadStarters: new Map(),
    directRequestOwners: new Map(),
    engineEligibility: () => undefined,
    connectorThread: (botId, threadId) =>
      botId === BOT.id && (threadId === "t-1" || threadId === "t-main") ? {} : null,
    pollOnlyCaller: () => false,
    delegateOnRuntime: (async () => [200, { ok: true, toBotName: PEER.name, receipt: { botId: PEER.id, outcome: "injected" } }]) as InternalBotChatDeps["delegateOnRuntime"],
    peerThreadFor: (bot) => String(bot.threadId ?? ""),
    threadBusy: () => false,
    runningTurnInstance: () => null,
    orgJoinsRunningTurn: () => true,
    peerSpeaker: () => ({ origin: "person" }),
    isUnattended: () => false,
    peerReviewRequired: () => false,
    cloudGuestDriven: () => false,
    idempotencyKeyOf: () => undefined,
    runtimeDelegationStatus: async () => [200, { status: "queued" }],
    openPersonCard: () => undefined,
    roomHandoffProblem: () => undefined,
    turnOrigin: () => ({ kind: "direct" }),
    joinPerson: () => undefined,
    applyDelegatedLevel: () => undefined,
    adoptReservedWorkThread: () => undefined,
    openerFrom: () => undefined,
    latestFailedTurnCause: () => null,
    requireActive: () => undefined,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalBotChatRoutes>,
  opts: {
    path: string;
    method?: string;
    body?: Record<string, unknown>;
    query?: string;
    capability?: InternalRouteContext["capability"];
  },
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const url = new URL(`http://x${opts.path}${opts.query ? `?${opts.query}` : ""}`);
  const ctx: InternalRouteContext = {
    res: {} as ServerResponse,
    path: opts.path,
    method: opts.method ?? "POST",
    url,
    headers: {},
    json: ((_r, status, body) => {
      sent.push({ status, body });
    }) as InternalRouteContext["json"],
    capability: opts.capability ?? {
      botId: BOT.id,
      threadId: "t-1",
      generation: "g1",
      depth: 0,
      openedThreads: 0,
      createdBots: 0,
      createdRooms: 0,
      roomPosts: 0,
    },
    readBody: async () => opts.body ?? {},
  };
  return { ctx, sent, run: () => route(ctx) };
}

describe("createInternalBotChatRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createInternalBotChatRoutes(baseDeps());
    expect(await route(call(route, { path: "/api/internal/post-to-room" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/create-bot" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/memory" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/bots", method: "GET" }).ctx)).toBe(PASS);
  });

  it("POST /ask-bot refuses a foreign source conversation (403)", async () => {
    const route = createInternalBotChatRoutes(baseDeps({
      connectorThread: () => null,
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/ask-bot",
      body: { toBotId: PEER.id, message: "hello" },
    });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source thread does not belong to sender" } }]);
  });

  it("POST /ask-bot consults a peer (happy)", async () => {
    const delegateOnRuntime = vi.fn(async () => [200, { text: "pong", toBotName: PEER.name }]) as unknown as InternalBotChatDeps["delegateOnRuntime"];
    const route = createInternalBotChatRoutes(baseDeps({ delegateOnRuntime }));
    const { sent, run } = call(route, {
      path: "/api/internal/ask-bot",
      body: { toBotId: PEER.id, message: "hello" },
    });
    await run();
    expect(delegateOnRuntime).toHaveBeenCalled();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({ text: "pong" });
  });

  it("POST /delegate-bot refuses a missing peer (404)", async () => {
    const route = createInternalBotChatRoutes(baseDeps());
    const { sent, run } = call(route, {
      path: "/api/internal/delegate-bot",
      body: { toBotId: "missing", message: "do it" },
    });
    await run();
    expect(sent[0]?.status).toBe(404);
  });

  it("POST /retry-thread refuses a non-Primary Bot (403)", async () => {
    const route = createInternalBotChatRoutes(baseDeps({
      store: {
        ...baseDeps().store,
        bot: (id) => (id === BOT.id ? { ...BOT, chiefOfStaff: false } : PEER),
      },
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/retry-thread",
      body: { toBotId: PEER.id, toThreadId: "t-peer", note: "try again" },
    });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "only a Primary Bot can retry a teammate's thread" } }]);
  });

  it("GET /room-targets refuses without roomCoordination (403)", async () => {
    const route = createInternalBotChatRoutes(baseDeps());
    const { sent, run } = call(route, { path: "/api/internal/room-targets", method: "GET" });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("GET /room-targets lists peers when coordinating (happy)", async () => {
    const route = createInternalBotChatRoutes(baseDeps());
    const { sent, run } = call(route, {
      path: "/api/internal/room-targets",
      method: "GET",
      capability: {
        botId: BOT.id,
        threadId: "t-1",
        generation: "g1",
        depth: 0,
        roomCoordination: true,
      },
    });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({ bots: expect.any(Array), rooms: expect.any(Array) });
  });
});
