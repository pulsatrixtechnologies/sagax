// Characterization of the I5b room / create routes moved out of
// server/index.ts (#1388): post-to-room, run-with-engine, threads (POST),
// create-bot, create-room, manage-room.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import {
  createInternalRoomsRoutes,
  type InternalRoomsBot,
  type InternalRoomsDeps,
  type InternalRoomsGroup,
} from "./internal-rooms.ts";
import { PASS } from "./table.ts";

const BOT: InternalRoomsBot = {
  id: "bot-1",
  name: "Ada",
  color: "#111",
  title: "Lead",
  section: "General",
  chiefOfStaff: true,
  threadId: "t-main",
  modelSelection: { instanceId: "eng-1", model: "m1" },
};

const ROOM: InternalRoomsGroup = {
  id: "room-1",
  name: "Ops",
  memberIds: [BOT.id, "bot-2"],
  threadId: "t-room",
  section: "General",
};

function baseDeps(over: Partial<InternalRoomsDeps> = {}): InternalRoomsDeps {
  const bots = [BOT];
  return {
    store: {
      bot: (id) => bots.find((b) => b.id === id),
      get bots() { return bots; },
      group: (id) => (id === ROOM.id ? { ...ROOM } : undefined),
      groupByThread: (threadId) => (threadId === ROOM.threadId ? { ...ROOM } : undefined),
      groups: [ROOM],
      taskByThread: () => undefined,
      tasks: () => [],
      isConfidentialThread: () => false,
      appendMessage: () => ({ id: "msg-1" }),
      messagesFor: () => [],
      createTask: () => ({ threadId: "t-new", title: "New" }),
      deleteTask: () => undefined,
      patchTask: () => undefined,
      patchGroup: () => ROOM,
      patchBot: (id, patch) => ({ ...BOT, ...patch, id }),
      createBot: (input) => ({ ...BOT, id: "bot-new", name: String(input.name), title: String(input.title ?? ""), modelSelection: input.modelSelection as InternalRoomsBot["modelSelection"] }),
      setTaskOpenedBy: () => undefined,
      projectBotForTask: () => ({ modelSelection: BOT.modelSelection }),
      workThread: () => undefined,
    },
    coordinator: {
      node: () => null,
      enqueue: () => ({ node: { id: "n1", botId: BOT.id, threadId: "t-new", status: "queued" } as never }),
      enqueueExternal: () => ({ node: { id: "n1", botId: BOT.id, threadId: "t-new", status: "queued" } as never }),
      tick: () => undefined,
      active: () => [],
    },
    approvalBus: {} as InternalRoomsDeps["approvalBus"],
    delegationWatch: new Map(),
    threadStarters: new Map(),
    directRequestOwners: new Map(),
    roomPostBudgets: new Map(),
    personAskAt: new Map(),
    turnAttachmentsByTurn: new Map(),
    liveTurnByThread: new Map(),
    connectorThread: (botId, threadId) =>
      botId === BOT.id && threadId === "t-1" ? {} : null,
    roomPostEligibility: () => ({ ok: true as const }),
    lastHumanRoomMessageAt: () => undefined,
    peerReviewRequired: () => false,
    isUnattended: () => false,
    turnAttachmentKey: (threadId, turnId) => `${threadId}:${turnId ?? ""}`,
    offerRoomPostToBots: () => undefined,
    proactiveHopsFromThread: () => 1,
    pollOnlyCaller: () => false,
    peerSpeaker: () => ({ origin: "person" }),
    cloudGuestDriven: () => false,
    botmailConfined: () => false,
    relayEnginesFor: () => [],
    approvalModeForBot: () => "ask",
    effectiveBotOwner: () => "person-1",
    cliDriverKind: () => "claudeAgent",
    openedThreadOwner: () => "person-1",
    openerFrom: () => undefined,
    noteRelayParent: () => undefined,
    askBotAndWait: async () => ({ status: "reply", text: "done" }),
    mcpCallTimeoutMinutes: () => 10,
    externalCompletion: () => ({}),
    activeRoutineRunForThread: () => null,
    delegatedThisTurn: () => undefined,
    parentThreadModel: () => ({}),
    privateThreads: () => false,
    startOrQueueOpenedThread: async () => ({ state: "running" }),
    startParallelTask: async () => ({ parallel: { threadId: "t-p", title: "P", state: "running" } }),
    globalRuntimeSettings: () => ({}),
    turnOrigin: () => ({ kind: "direct" }),
    applyDelegatedLevel: () => undefined,
    threadBusy: () => false,
    botAtThreadCapacity: () => false,
    activeGroupTurnForBot: () => null,
    idempotencyKeyOf: () => undefined,
    joinPerson: () => undefined,
    threadRefUrl: () => "https://example.test/t",
    agentApiSecret: () => Buffer.alloc(32),
    nonPrimaryCreationRefusal: () => null,
    ownerBotsReadOnly: () => false,
    personDirectTurn: () => true,
    defaultSelection: async () => ({ instanceId: "eng-1", model: "m1" }),
    checkedModelSelection: () => ({ ok: true as const, selection: { instanceId: "eng-1", model: "m1" } }),
    hostedModelsAllows: () => true,
    hostedModelsError: () => "no",
    memberOwnedInOrg: () => false,
    memberFolderRefusal: () => null,
    settleMemberAutoLevels: () => undefined,
    isPerspicax: () => false,
    internalCapabilityIsActive: () => true,
    teamSetupSuggest: () => ({ state: "pending", requestId: "req-1", detail: "card" }),
    teamSetupSubmit: async () => ({
      state: "applied",
      requestId: "req-1",
      detail: "ok",
      result: { bots: [{ action: "created", id: "bot-new" }] },
    }),
    dataDir: () => "/tmp/data",
    fullAccessForSource: () => true,
    createChannel: (value) => {
      const v = value as { name: string; memberIds: string[] };
      return { id: "room-new", name: v.name, memberIds: v.memberIds, threadId: "t-room-new", section: "General" };
    },
    updateChannel: (id, patch) => ({ ...ROOM, id, ...(patch as object) }),
    deciderReadyRoomRouting: () => false,
    requireActive: () => undefined,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalRoomsRoutes>,
  opts: {
    path: string;
    method?: string;
    body?: Record<string, unknown>;
    capability?: InternalRouteContext["capability"];
  },
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const ctx: InternalRouteContext = {
    res: {} as ServerResponse,
    path: opts.path,
    method: opts.method ?? "POST",
    url: new URL(`http://x${opts.path}`),
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

describe("createInternalRoomsRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createInternalRoomsRoutes(baseDeps());
    expect(await route(call(route, { path: "/api/internal/ask-bot" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/delegate-bot" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/memory" }).ctx)).toBe(PASS);
  });

  it("POST /post-to-room refuses a foreign source (403)", async () => {
    const route = createInternalRoomsRoutes(baseDeps({
      connectorThread: () => null,
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/post-to-room",
      body: { groupId: ROOM.id, message: "hello room" },
    });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /post-to-room posts into a room (happy)", async () => {
    const offerRoomPostToBots = vi.fn();
    const route = createInternalRoomsRoutes(baseDeps({ offerRoomPostToBots }));
    const { sent, run } = call(route, {
      path: "/api/internal/post-to-room",
      body: { groupId: ROOM.id, message: "hello room" },
    });
    await run();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ ok: true, roomName: ROOM.name });
    expect(offerRoomPostToBots).toHaveBeenCalled();
  });

  it("POST /create-bot refuses a foreign source (403)", async () => {
    const route = createInternalRoomsRoutes(baseDeps({
      connectorThread: () => null,
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/create-bot",
      body: { name: "Ned", role: "Helper", instructions: "Help out." },
    });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /create-bot creates via team setup (happy)", async () => {
    const created: InternalRoomsBot = {
      ...BOT,
      id: "bot-new",
      name: "Ned",
      title: "Helper",
    };
    const route = createInternalRoomsRoutes(baseDeps({
      store: {
        ...baseDeps().store,
        bot: (id) => (id === BOT.id ? BOT : id === created.id ? created : undefined),
      },
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/create-bot",
      body: { name: "Ned", role: "Helper", instructions: "Help out." },
    });
    await run();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ id: "bot-new", name: "Ned", title: "Helper" });
  });

  it("POST /create-room refuses a non-Primary Bot (403)", async () => {
    const route = createInternalRoomsRoutes(baseDeps({
      store: {
        ...baseDeps().store,
        bot: (id) => (id === BOT.id ? { ...BOT, chiefOfStaff: false } : undefined),
      },
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/create-room",
      body: { name: "War room", memberIds: [BOT.id] },
    });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("POST /threads refuses a foreign source (403)", async () => {
    const route = createInternalRoomsRoutes(baseDeps({
      connectorThread: () => null,
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/threads",
      body: { title: "Job", message: "do the thing" },
    });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });
});
