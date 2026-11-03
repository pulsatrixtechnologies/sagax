// Characterization of the P4 groups routes moved out of server/index.ts
// (#1388): /api/groups*, tasks, messages, leave, read, queue, interrupt.
// Auth gate already ran; these tests cover PASS, permission refusals, and
// happy paths with fake deps.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { GroupRecord } from "../store.ts";
import { createGroupsHttpRoutes, type GroupsHttpDeps, type GroupsHttpStore } from "./groups-http.ts";
import { PASS, type RouteContext } from "./table.ts";

type Sent = { status: number; body: unknown };

const room = {
  id: "g1",
  name: "Ops",
  threadId: "t-g1",
  memberIds: ["b1"],
  humanIds: ["pr_member"],
  defaultResponder: { kind: "first" },
  unread: false,
  bulletin: "",
  createdAt: 1,
} as unknown as GroupRecord;

const sessionMember: RequestAuth = {
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

const sessionAdmin: RequestAuth = {
  ...sessionMember,
  scopes: ["admin", "client"],
  session: { ...sessionMember.session!, scopes: ["admin", "client"] } as never,
};

function storeStub(over: Partial<GroupsHttpStore> = {}): GroupsHttpStore {
  return {
    groups: [room],
    group: (id) => (id === "g1" ? room : undefined),
    bot: (id) => (id === "b1" ? { id: "b1", name: "Ada", hidden: false } as never : null),
    patchGroup: (_id, patch) => ({ ...room, ...patch } as GroupRecord),
    createGroupTask: () => ({ threadId: "t-new", title: "New" }),
    groupProject: () => undefined,
    groupTaskByThread: (gid, tid) => (gid === "g1" && tid === "t-g1" ? { threadId: "t-g1", title: "General" } : null),
    switchGroupTask: () => room,
    patchGroupTask: () => ({ threadId: "t-g1", title: "Renamed" }),
    setGroupTaskTurnTimeout: () => ({ threadId: "t-g1" }),
    setGroupTaskPinned: () => ({ threadId: "t-g1", pinned: true }),
    renameGroupTask: () => ({ threadId: "t-g1", title: "Renamed" }),
    deleteGroupTask: () => room,
    groupTasks: () => [{ threadId: "t-g1" }],
    appendMessage: (_t, message) => ({ id: "m1", ...message } as never),
    messagesFor: () => [],
    deleteGroup: () => undefined,
    ...over,
  };
}

function baseDeps(over: Partial<GroupsHttpDeps> = {}): GroupsHttpDeps {
  return {
    store: storeStub(),
    visibleFor: () => ({ everything: true, group: () => true, bot: () => true }),
    viewerId: () => "pr_member",
    groupVisible: () => true,
    peopleDmProjection: (g) => ({ id: g.id, peopleDm: true }),
    groupReaderId: () => "pr_member",
    knowsPersonThreads: () => true,
    publicGroupState: (g) => ({ id: g.id, name: g.name, threadId: g.threadId, memberIds: g.memberIds }),
    refusePlacedBots: () => null,
    isPerspicax: false,
    channelActorRole: () => "member",
    refuseHumanEdit: () => null,
    createChannel: () => room,
    withCreatorListed: (_a, body) => body,
    channelActorId: () => "pr_member",
    mayPlaceRoomIn: () => false,
    recordRoomPlacement: () => undefined,
    phoneHasGroup: () => false,
    phoneHasThread: () => false,
    peopleDmSetSelection: () => undefined,
    peopleDmForgetThread: () => undefined,
    recordThreadStarter: () => undefined,
    defaultPage: 50,
    viewerForApproval: () => ({ id: "pr_member" } as never),
    actorKey: () => "actor",
    projectGroupTranscript: (g) => g,
    groupWithThread: (g) => g,
    pageSize: () => 50,
    messagePage: () => ({ messages: [] }),
    groupThreadIsWorking: () => false,
    groupOwnerRuleApplies: () => false,
    groupActor: () => ({ id: "pr_member", email: "a@example.test" } as never),
    effectiveBotOwner: () => "pr_owner",
    companionRequest: () => false,
    callerCan: () => false,
    roomSectionMoveRefusal: () => null,
    recordRoomMove: () => undefined,
    updateChannel: (_id, body) => ({ ...room, ...(body as object) } as GroupRecord),
    memberFolderRefusal: () => null,
    memberFolderPrincipal: () => null,
    botGrants: () => [],
    principalById: () => ({ name: "Ann", login: "ann" }),
    channelTurnOpen: () => false,
    failTurnIfMemberLeft: () => undefined,
    broadcast: () => undefined,
    disableRoutinesForGroup: () => undefined,
    notePushRead: () => undefined,
    actorPrincipalId: () => "pr_member",
    readCursor: () => ({}),
    peopleDmThreadOf: () => "t-g1",
    groupIsWorking: () => false,
    stagedSkillCleanupsForThread: () => [],
    clearLastReply: () => undefined,
    cancelTeamSetupResumesForThread: () => undefined,
    clearTurnDigestState: () => undefined,
    revokeInternalCapabilitiesForThread: () => undefined,
    rejectDeletedThreadSkillStages: () => undefined,
    groupPostAllowed: () => true,
    misuseActor: () => ({ triage: false }),
    usageTriggerFor: () => undefined,
    assertSpendCap: () => undefined,
    stopGroupThreads: vi.fn(async () => undefined),
    groupEngineCommandRoute: () => null,
    harnessCommandSource: () => null,
    harnessCommandSpeaker: () => ({ origin: "person" as const }),
    harnessCommands: { cached: () => undefined, read: async () => ({ engine: "claude", commands: [], at: 0 }) } as never,
    desktopManaged: false,
    runSend: async (_k, _f, work) => work(),
    notifyRoomMentions: () => undefined,
    messageSender: () => undefined,
    startGroupTurn: vi.fn(() => ({ id: "m-out", role: "user", kind: "text", text: "hi" } as never)),
    resolveReplyTarget: () => undefined,
    sendPeopleDmMessage: () => ({ ok: true }),
    groupSpeakerBotId: () => undefined,
    runningTurnInstance: () => undefined,
    activeGroupOperations: () => [],
    drainQueuedChannelSends: () => undefined,
    profileName: () => "User",
    ...over,
  };
}

function call(
  deps: GroupsHttpDeps,
  opts: { method?: string; path?: string; auth?: RequestAuth; body?: unknown; query?: string } = {},
) {
  const sent: Sent[] = [];
  const path = opts.path ?? "/api/groups";
  const url = new URL(`http://x${path}${opts.query ? `?${opts.query}` : ""}`);
  const route = createGroupsHttpRoutes(deps);
  return (async () => {
    const out = await route({
      req: { headers: {} } as IncomingMessage,
      res: {} as ServerResponse,
      url,
      path: url.pathname,
      method: opts.method ?? "GET",
      auth: opts.auth ?? sessionMember,
      json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: (async () => opts.body ?? {}) as RouteContext["readBody"],
    });
    return { out, sent: sent[0] };
  })();
}

describe("createGroupsHttpRoutes", () => {
  it("returns PASS for foreign paths", async () => {
    const deps = baseDeps();
    expect((await call(deps, { path: "/api/search" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/teams/export", method: "POST" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/groups/g1/memory" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/groups/g1/folders" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/groups/g1/bots/b1/payer" })).out).toBe(PASS);
  });

  it("lists groups on the happy path", async () => {
    const result = await call(baseDeps());
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toMatchObject({ groups: [{ id: "g1", name: "Ops" }] });
  });

  it("refuses creating a room that places someone else's bot", async () => {
    const deps = baseDeps({
      refusePlacedBots: () => "only the owner of a bot can place it",
    });
    const result = await call(deps, {
      method: "POST",
      body: { name: "Stolen", memberIds: ["b-other"] },
    });
    expect(result.sent).toEqual({
      status: 403,
      body: { error: "only the owner of a bot can place it", code: "bot_place_owner_only" },
    });
  });

  it("creates a channel on the happy path", async () => {
    const createChannel = vi.fn(() => room);
    const result = await call(baseDeps({ createChannel }), {
      method: "POST",
      body: { name: "Ops", memberIds: ["b1"] },
    });
    expect(createChannel).toHaveBeenCalled();
    expect(result.sent?.status).toBe(201);
    expect(result.sent?.body).toMatchObject({ group: { id: "g1", messages: [] } });
  });

  it("404s leave for an invisible group", async () => {
    const result = await call(baseDeps({ groupVisible: () => false }), {
      method: "POST",
      path: "/api/groups/g1/leave",
    });
    expect(result.sent).toEqual({ status: 404, body: { error: "no such group" } });
  });

  it("refuses leave when the caller is not a signed-in person", async () => {
    const result = await call(baseDeps({
      groupActor: () => ({ id: "anon:loop", email: "" } as never),
    }), {
      method: "POST",
      path: "/api/groups/g1/leave",
    });
    expect(result.sent).toEqual({
      status: 403,
      body: { error: "only a signed-in person can leave a group", code: "no_person" },
    });
  });

  it("refuses delete without admin when owner rules do not apply", async () => {
    const result = await call(baseDeps({ groupOwnerRuleApplies: () => false }), {
      method: "DELETE",
      path: "/api/groups/g1",
      auth: sessionMember,
    });
    expect(result.sent).toEqual({
      status: 403,
      body: { error: "forbidden: deleting a channel needs the admin scope", code: "channel_delete_admin_only" },
    });
  });

  it("deletes a channel when the session has admin", async () => {
    const deleteGroup = vi.fn();
    const deps = baseDeps({
      store: storeStub({ deleteGroup }),
      groupOwnerRuleApplies: () => false,
    });
    const result = await call(deps, {
      method: "DELETE",
      path: "/api/groups/g1",
      auth: sessionAdmin,
    });
    expect(deleteGroup).toHaveBeenCalledWith("g1");
    expect(result.sent).toEqual({ status: 200, body: { ok: true } });
  });

  it("refuses posting when the member is read-only on an organization server", async () => {
    const result = await call(baseDeps({
      isPerspicax: true,
      groupPostAllowed: () => false,
    }), {
      method: "POST",
      path: "/api/groups/g1/messages",
      body: { text: "hello" },
    });
    expect(result.sent).toEqual({
      status: 403,
      body: { error: "you may read this channel, not post in it", code: "read_only" },
    });
  });

  it("posts a message through the injected group runner", async () => {
    const startGroupTurn = vi.fn(() => ({ id: "m-out", role: "user", kind: "text", text: "hello" } as never));
    const result = await call(baseDeps({ startGroupTurn }), {
      method: "POST",
      path: "/api/groups/g1/messages",
      body: { text: "hello" },
    });
    expect(startGroupTurn).toHaveBeenCalled();
    expect(result.sent?.status).toBe(202);
    expect(result.sent?.body).toMatchObject({ ok: true, threadId: "t-g1" });
  });

  it("interrupts the room via stopGroupThreads", async () => {
    const stopGroupThreads = vi.fn(async () => undefined);
    const result = await call(baseDeps({ stopGroupThreads }), {
      method: "POST",
      path: "/api/groups/g1/interrupt",
      body: {},
    });
    expect(stopGroupThreads).toHaveBeenCalled();
    expect(result.sent).toEqual({ status: 200, body: { ok: true } });
  });

  it("404s an unknown group on PATCH via updateChannel", async () => {
    const updateChannel = vi.fn(() => {
      throw Object.assign(new Error("no such room"), { status: 404 });
    });
    await expect(call(baseDeps({
      store: storeStub({ group: () => undefined }),
      updateChannel,
    }), {
      method: "PATCH",
      path: "/api/groups/missing",
      body: { name: "X" },
    })).rejects.toMatchObject({ status: 404, message: "no such room" });
    expect(updateChannel).toHaveBeenCalled();
  });

  it("creates a task on the happy path", async () => {
    const createGroupTask = vi.fn(() => ({ threadId: "t-new", title: "Books" }));
    const result = await call(baseDeps({
      store: storeStub({ createGroupTask }),
    }), {
      method: "POST",
      path: "/api/groups/g1/tasks",
      body: { title: "Books" },
    });
    expect(createGroupTask).toHaveBeenCalled();
    expect(result.sent?.status).toBe(201);
    expect(result.sent?.body).toMatchObject({ task: { threadId: "t-new" } });
  });
});
