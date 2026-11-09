// Characterization of the I5a bot-to-bot chat routes moved out of
// server/index.ts (#1388): ask-bot, delegations, retry-thread, delegate-bot,
// room-targets, coordinate-bots.
import type { ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPeerScope } from "../peers/peer-roster.ts";
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
      endTurn: () => undefined,
      status: () => undefined,
      poll: () => undefined,
      outstandingFor: () => [],
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
    beginExternalRoot: () => undefined,
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

// Isolation between people (2026-11-02): a receipt, a notice or an answer
// written after a wait (an approval card, a steer, the synchronous wait)
// names a teammate only if the sender can still reach it. A bot record is
// patched in place, so one read before the wait already carries the new
// name after it; these cases are an organization server in miniature where
// person B unshares and renames the bot it shared with person A meanwhile.
describe("peer receipts never name a teammate made private during a wait", () => {
  afterEach(() => {
    setPeerScope(null);
    vi.useRealTimers();
  });
  const PRIVATE = "Private codename";

  function world(over: (w: { helper: InternalBotChatBot; state: { shared: boolean }; goPrivate: () => void }) => Partial<InternalBotChatDeps> = () => ({})) {
    const ada: InternalBotChatBot = { ...BOT, chiefOfStaff: false };
    const helper: InternalBotChatBot = { id: "bot-3", name: "Shared helper", color: "#333", section: "General", threadId: "t-helper", busy: false };
    const bea: InternalBotChatBot = { ...PEER };
    const bots = [ada, helper, bea];
    const state = { shared: true };
    // The helper is person B's bot, in person A's scope only while B shares it.
    setPeerScope((_from, to) => to.id !== helper.id || state.shared);
    const goPrivate = () => { state.shared = false; helper.name = PRIVATE; };
    const tasks = new Map<string, { threadId: string; title: string }>();
    const created: string[] = [];
    const base = baseDeps();
    const store: InternalBotChatDeps["store"] = {
      ...base.store,
      bot: (id) => bots.find((b) => b.id === id),
      get bots() { return bots; },
      taskByThread: (botId, threadId) => tasks.get(`${botId}:${threadId}`) ?? base.store.taskByThread(botId, threadId),
      createTask: (botId) => {
        created.push(String(botId));
        const task = { threadId: `t-work-${String(botId)}`, title: "@Ada · work" };
        tasks.set(`${String(botId)}:${task.threadId}`, task);
        return task;
      },
    };
    const deps = baseDeps({ store, ...over({ helper, state, goPrivate }) });
    return { helper, created, route: createInternalBotChatRoutes(deps) };
  }
  const ask = (route: ReturnType<typeof createInternalBotChatRoutes>, toBotId: string) =>
    call(route, { path: "/api/internal/ask-bot", body: { toBotId, message: "hello" } });
  const deniedReview: [number, Record<string, unknown>] = [403, { error: "Denied by user; no work sent.", approvals: [{ botId: "bot-3", error: "denied by user", approvalOutcome: "deny", approvalSource: "user" }] }];

  it("POST /ask-bot: a review refused after the teammate was unshared and renamed carries its id, never its new name", async () => {
    const { helper, route } = world(({ goPrivate }) => ({
      // B acts while A's card is open; A then denies
      delegateOnRuntime: (async () => { goPrivate(); return deniedReview; }) as InternalBotChatDeps["delegateOnRuntime"],
    }));
    const { sent, run } = ask(route, helper.id);
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({ approvalOutcome: "deny", approvalSource: "user", receipt: { botId: helper.id, outcome: "failed" } });
    expect((sent[0]!.body as { receipt: object }).receipt).not.toHaveProperty("botName");
    expect(JSON.stringify(sent)).not.toContain(PRIVATE);
  });

  it("POST /ask-bot: a teammate still shared keeps its name on the same refusal", async () => {
    const { helper, route } = world(() => ({
      delegateOnRuntime: (async () => deniedReview) as InternalBotChatDeps["delegateOnRuntime"],
    }));
    const { sent, run } = ask(route, helper.id);
    await run();
    expect(sent[0]?.body).toMatchObject({ receipt: { botId: helper.id, botName: "Shared helper", outcome: "failed" } });
  });

  it("POST /ask-bot from a poll-only caller: the queued answer written after the teammate went private names nobody", async () => {
    const { helper, route } = world(({ goPrivate }) => ({
      pollOnlyCaller: () => true,
      delegateOnRuntime: (async () => { goPrivate(); return [200, { queued: true, taskId: "n-held", approvalRequired: true }]; }) as InternalBotChatDeps["delegateOnRuntime"],
    }));
    const { sent, run } = ask(route, helper.id);
    await run();
    expect(sent[0]?.body).toMatchObject({ busy: true, taskId: "n-held", receipt: { botId: helper.id, outcome: "queued" } });
    expect(sent[0]?.body).not.toHaveProperty("toBotName");
    expect((sent[0]!.body as { receipt: object }).receipt).not.toHaveProperty("botName");
    expect(JSON.stringify(sent)).not.toContain(PRIVATE);
  });

  it("POST /ask-bot from a poll-only caller: the synchronous wait's answer reads the name when the wait ends", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const { helper, route } = world(({ goPrivate }) => ({
      pollOnlyCaller: () => true,
      delegateOnRuntime: (async () => [200, { queued: true, taskId: "n-run" }]) as InternalBotChatDeps["delegateOnRuntime"],
      coordinator: {
        ...baseDeps().coordinator,
        // B unshares and renames the helper while its turn runs and A's call waits
        node: () => { if (++polls === 2) goPrivate(); return { status: "running", result: "", executions: 1 }; },
      },
    }));
    const { sent, run } = ask(route, helper.id);
    const done = run();
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    expect(polls).toBeGreaterThan(2);
    expect(sent[0]?.body).toMatchObject({ timeout: true, taskId: "n-run", receipt: { botId: helper.id, outcome: "injected" } });
    expect(sent[0]?.body).not.toHaveProperty("toBotName");
    expect((sent[0]!.body as { receipt: object }).receipt).not.toHaveProperty("botName");
    expect(JSON.stringify(sent)).not.toContain(PRIVATE);
  });

  it("POST /ask-bot aside: the answer written after the steer names a teammate made private by nobody", async () => {
    const { helper, route } = world(({ goPrivate }) => ({
      pollOnlyCaller: () => true,
      threadBusy: () => true,
      runningTurnInstance: () => ({ adapter: { capabilities: { queueing: true }, steer: async () => { goPrivate(); return "steered" as const; } } }),
    }));
    helper.busy = true;
    const { sent, run } = ask(route, helper.id);
    await run();
    expect(sent[0]?.body).toMatchObject({ busy: true, aside: "injected" });
    expect(sent[0]?.body).not.toHaveProperty("toBotName");
    expect(JSON.stringify(sent)).not.toContain(PRIVATE);
  });

  it("POST /coordinate-bots: a teammate unshared and renamed during the card gets no thread, no work and no name", async () => {
    const enqueued: string[] = [];
    const { helper, created, route } = world(({ helper, state, goPrivate }) => ({
      peerReviewRequired: () => true,
      // A's card: B unshares and renames the helper before A allows
      approvalBus: { store: {} as never, broadcast: () => undefined, autoApply: () => { goPrivate(); return true; } },
      roomHandoffProblem: (node) => node.botId === helper.id && !state.shared ? "The recipient is outside the sender's owner's bots" : undefined,
      coordinator: {
        ...baseDeps().coordinator,
        enqueue: (...args: unknown[]) => {
          const target = args[3] as { botId: string; threadId: string };
          enqueued.push(target.botId);
          return { node: { id: `n-${target.botId}`, botId: target.botId, threadId: target.threadId, status: "queued" }, duplicate: false };
        },
      },
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/coordinate-bots",
      body: { botIds: [helper.id, PEER.id], message: "Review the export" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1", depth: 0, roomCoordination: true },
    });
    await run();
    expect(sent[0]?.status).toBe(200);
    const receipts = (sent[0]!.body as { receipts: Array<Record<string, unknown>> }).receipts;
    expect(receipts).toEqual([
      { botId: helper.id, outcome: "failed", detail: "that bot is no longer available to this bot" },
      expect.objectContaining({ botId: PEER.id, botName: "Bea", outcome: "queued" }),
    ]);
    expect(created).toEqual([PEER.id]);
    expect(enqueued).toEqual([PEER.id]);
    expect(JSON.stringify(sent)).not.toContain(PRIVATE);
  });
});

// send_status (#3246): the sender reads what became of its sends, and only
// the sends it made for the same person.
describe("GET /send-status", () => {
  const sentFrom = (threadId: string, extra: Record<string, unknown> = {}) => ({
    botId: BOT.id, threadId, delegationId: `d-${threadId}`, at: 1000, ...extra,
  });
  function depsWith(tasks: Array<{ threadId: string; title: string; openedBy?: Record<string, unknown>; ownerPrincipalId?: string }>, own: Record<string, string | undefined> = {}) {
    const base = baseDeps();
    return baseDeps({
      store: {
        ...base.store,
        taskByThread: (botId, threadId) => {
          if (botId === BOT.id) return { threadId, title: "mine", ownerPrincipalId: own[threadId] } as never;
          return (botId === PEER.id ? tasks.find((t) => t.threadId === threadId) : undefined) as never;
        },
        tasks: (botId: string) => (botId === PEER.id ? tasks : []) as never,
        messagesFor: (threadId: string) => (threadId === "t-a" ? [{ id: "r", role: "bot", kind: "text", text: "Booked." }] : []) as never,
      },
    });
  }

  it("lists this conversation's sends with their state and reply", async () => {
    const route = createInternalBotChatRoutes(depsWith([
      { threadId: "t-a", title: "Book", openedBy: sentFrom("t-1", { delegationId: "d-a" }) },
      { threadId: "t-b", title: "Other chat", openedBy: sentFrom("t-main", { delegationId: "d-b" }) },
    ]));
    const { sent, run } = call(route, { path: "/api/internal/send-status", method: "GET" });
    await run();
    expect(sent[0]?.status).toBe(200);
    const sends = (sent[0]!.body as { sends: Array<Record<string, unknown>> }).sends;
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ threadId: "t-a", botName: PEER.name, state: "done", summary: "Booked.", delivered: true });
  });

  it("reads one send by thread id", async () => {
    const route = createInternalBotChatRoutes(depsWith([{ threadId: "t-a", title: "Book", openedBy: sentFrom("t-1") }]));
    const { sent, run } = call(route, { path: "/api/internal/send-status", method: "GET", query: "thread_id=t-a" });
    await run();
    expect(sent[0]).toMatchObject({ status: 200, body: { send: { threadId: "t-a", state: "done" } } });
  });

  it("refuses a send made for another person", async () => {
    const route = createInternalBotChatRoutes(depsWith(
      [{ threadId: "t-a", title: "Book", openedBy: sentFrom("t-main") }],
      { "t-1": "person-a", "t-main": "person-b" },
    ));
    const { sent, run } = call(route, { path: "/api/internal/send-status", method: "GET", query: "thread_id=t-a" });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("reads a send of the same person from another conversation", async () => {
    const route = createInternalBotChatRoutes(depsWith(
      [{ threadId: "t-a", title: "Book", openedBy: sentFrom("t-main") }],
      { "t-1": "person-a", "t-main": "Person-A" },
    ));
    const { sent, run } = call(route, { path: "/api/internal/send-status", method: "GET", query: "thread_id=t-a" });
    await run();
    expect(sent[0]?.status).toBe(200);
  });

  it("refuses a thread another bot opened, and an unknown one", async () => {
    const route = createInternalBotChatRoutes(depsWith([{ threadId: "t-a", title: "Book", openedBy: sentFrom("t-1", { botId: "someone" }) }]));
    const refused = call(route, { path: "/api/internal/send-status", method: "GET", query: "thread_id=t-a" });
    await refused.run();
    expect(refused.sent[0]?.status).toBe(403);
    const unknown = call(route, { path: "/api/internal/send-status", method: "GET", query: "thread_id=nope" });
    await unknown.run();
    expect(unknown.sent[0]?.status).toBe(404);
  });
});
