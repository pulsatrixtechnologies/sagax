// Characterization of the B1 bots-core routes moved out of server/index.ts
// (#1388): list/create, defaults, profile, primary, soul, active-branch,
// projects/tasks. Auth gate already ran; fake deps cover PASS, refusals,
// and happy paths.
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { BotRecord } from "../store.ts";
import {
  createBotsCoreRoutes,
  type BotsCoreRouteDeps,
  type BotsCoreStore,
} from "./bots-core.ts";
import { PASS, type RouteContext } from "./table.ts";

const bot = {
  id: "b1",
  name: "Ada",
  threadId: "t1",
  modelSelection: { instanceId: "i1", model: "m" },
  ownerUserId: "pr_owner",
  soul: "Be helpful.",
  soulHash: "h1",
} as unknown as BotRecord;

const sessionOwner: RequestAuth = {
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
    principalId: "pr_owner",
  } as never,
};

const sessionOther: RequestAuth = {
  ...sessionOwner,
  session: { ...sessionOwner.session!, principalId: "pr_other" } as never,
};

function storeStub(over: Partial<BotsCoreStore> = {}): BotsCoreStore {
  return {
    bots: [bot],
    groups: [],
    sections: [],
    bot: (id) => (id === "b1" ? bot : null),
    createBot: () => bot,
    patchBot: () => bot,
    patchBotProfile: () => bot,
    deleteBot: () => undefined,
    setPrimaryBot: () => [bot],
    clearPrimaryBot: () => [bot],
    setSoul: () => bot,
    projectBotForTask: () => bot,
    tasks: () => [],
    taskByThread: () => ({ threadId: "t1", title: "Chat" } as never),
    messagesFor: () => [],
    messagesTail: () => ({ messages: [] }),
    patchMessage: () => ({ id: "m1" } as never),
    setActiveLeaf: () => "leaf-1",
    activeLeaf: () => null,
    patchTask: () => ({ threadId: "t1" } as never),
    createTask: () => ({ threadId: "t-new" } as never),
    switchTask: () => bot,
    refreshTaskPermissions: () => ({ threadId: "t1" } as never),
    switchTaskModel: () => ({ threadId: "t1" } as never),
    deleteTask: () => bot,
    retitleTask: () => ({ threadId: "t1", title: "New" } as never),
    reorderProjects: () => [],
    project: () => ({ id: "p1" }),
    createProject: () => ({ id: "p1" }),
    patchProject: () => ({ id: "p1" }),
    deleteProject: () => bot,
    isConfidentialThread: () => false,
    ...over,
  };
}

function baseDeps(over: Partial<BotsCoreRouteDeps> = {}): BotsCoreRouteDeps {
  return {
    store: storeStub(),
    cfg: {},
    identity: { kind: "solo" },
    desktopManaged: false,
    fixedWorkspaceSeam: false,
    threadDeletedMessage: "deleted",
    visibleFor: () => ({
      everything: true,
      bot: () => true,
      thread: () => true,
      group: () => true,
      sections: (all) => [...all],
    }),
    viewerId: () => "pr_owner",
    refreshGroupUsage: () => undefined,
    pageSize: () => 50,
    listedBotVisible: () => true,
    publicBotQueuedMessages: () => ({}),
    threadsWithActiveCoordination: () => new Set(),
    privateThreads: () => false,
    ensureViewerThread: () => undefined,
    wireBot: (b) => ({ id: b.id, name: b.name }),
    viewerBotActivity: () => ({}),
    listedTasks: (_sel, tasks) => [...tasks],
    threadsShownTo: (_b, tasks) => [...tasks],
    wireTask: (task) => task,
    messagePage: () => ({ messages: [] }),
    viewerForApproval: () => ({ id: "pr_owner" } as never),
    threadKeyedForViewer: (entries) => entries,
    orgVisibleSections: (all) => [...all],
    groupVisible: () => true,
    peopleDmProjection: (g) => ({ id: g.id }),
    groupReaderId: () => "pr_owner",
    knowsPersonThreads: () => false,
    publicGroupState: (g) => ({ id: g.id, name: g.name, threadId: g.threadId, memberIds: g.memberIds }),
    botComputerControlSnapshot: () => ({ held: false, helpReason: null }),
    newBotApprovalMode: () => "ask",
    memberDefaultSelection: async () => ({ instanceId: "i1", model: "m" }),
    defaultSelection: async () => ({ instanceId: "i1", model: "m" }),
    githubCredentialsFor: () => [],
    orgAvatarImageConfig: () => null,
    requesterPrincipal: () => "pr_owner",
    takeTemporaryCreateToken: () => null,
    botCreationAllowed: () => true,
    personBotsReadOnly: () => false,
    botsReadOnlyRefusal: () => ({ error: "read_only" }),
    memberBotFieldRefusal: () => null,
    presetStore: { resolve: () => null },
    orgInstallStatuses: () => new Map(),
    requestedWorksOn: () => undefined,
    memberAutoRefused: () => false,
    creatingBotOwnerId: () => "pr_owner",
    storedAvatarExists: () => true,
    personalProfileOf: () => false,
    memberFolderRefusal: () => null,
    memberFolderPrincipal: () => null,
    checkedModelSelection: () => ({ ok: true, selection: { instanceId: "i1", model: "m" } }),
    hostedModels: null,
    ownerChosenVisibility: (_a, v) => v,
    routines: { create: () => ({ id: "r1" }), remove: () => undefined, update: () => undefined, isActiveThread: () => false },
    projectBotTranscript: (b) => b,
    publicBot: (b) => ({ id: b.id, name: b.name }),
    botEditsNeedOwner: () => false,
    memberOwnsBot: (auth, b) => (auth.kind === "session" ? auth.session.principalId : "") === b.ownerUserId,
    viewerBotLevel: () => "owner",
    lockedLookRefusal: () => null,
    ownerSettingsForbidden: () => null,
    recordPersonaSave: () => undefined,
    broadcast: () => undefined,
    actorPrincipalId: (auth) => (auth.kind === "session" ? auth.session.principalId ?? "" : ""),
    effectiveBotOwner: (b) => String(b.ownerUserId ?? ""),
    ownerOrAdminOf: (auth, b) => {
      if (auth.kind === "session" && auth.scopes.includes("admin")) return true;
      return (auth.kind === "session" ? auth.session.principalId : "") === b.ownerUserId;
    },
    computerOwner: () => false,
    previewSystemPrompt: () => ({ prompt: "hi" }),
    botOverview: async () => ({ overview: true }),
    requestedTaskBot: () => bot,
    requirePinnedClientThread: () => undefined,
    threadBusy: () => false,
    phoneSecretSubmissions: { hasThread: () => false, hasBot: () => false },
    callerCan: () => false,
    terminalPrincipalId: () => undefined,
    remoteSessions: { list: () => [], listDir: async () => ({ entries: [] }) } as never,
    callerBotsReadOnly: () => false,
    orgFullAccessRefusalFor: () => null,
    localPrincipalId: () => "pr_owner",
    sharedWorkspaceFullAccessEnabled: () => false,
    approvalModeStepUpGate: () => null,
    ruleManager: () => null,
    supportsApprovalMode: () => true,
    confidentialThreadsByDefault: () => false,
    scopedThreadViewer: () => undefined,
    conversationThreadFor: () => "t1",
    selectViewerThread: () => undefined,
    noteStreamSend: () => undefined,
    refreshStreamDigests: () => undefined,
    actorKey: () => "actor",
    threadStarters: { set: () => undefined },
    makeThreadConfidential: () => undefined,
    privateFolderThread: () => true,
    liveCoordination: () => false,
    computerSelectionMoves: { delete: () => undefined },
    checkedTaskModelSwitch: () => ({ ok: true }),
    auditApprovalModeChange: () => undefined,
    runningTurnLevels: () => ({}),
    applyStricterApprovalLive: async () => undefined,
    stricterApprovalStopError: () => "stop failed",
    primaryAskedReplay: () => false,
    memberOwnedInOrg: () => false,
    stagedSkillCleanupsForThread: () => [],
    coordinator: { cancelDirect: () => undefined },
    cancelTeamSetupResumesForThread: () => undefined,
    confidentialThreadAttachments: () => [],
    threadEngineKeys: () => [],
    wipeConfidentialThread: () => undefined,
    clearTurnDigestState: () => undefined,
    revokeInternalCapabilitiesForThread: () => undefined,
    handoffs: { forget: () => undefined },
    routableSteers: { forgetThread: () => undefined },
    directTurnGenerationByThread: { get: () => undefined },
    settleDirectFollowup: () => undefined,
    rejectDeletedThreadSkillStages: () => undefined,
    threadTitleGate: () => ({ ok: false, refusal: "no title" }),
    titleRegenerations: new Set(),
    generateThreadTitle: async () => "Titled",
    ...over,
  };
}

function context(path: string, method = "GET", auth: RequestAuth = sessionOwner, body: unknown = {}, query = "") {
  const json = vi.fn();
  const readBody = vi.fn(async () => body);
  return {
    json,
    ctx: {
      req: { headers: {} },
      res: { setHeader: () => undefined, headersSent: false, writableEnded: false },
      url: new URL(`http://x${path}${query}`),
      path,
      method,
      auth,
      json,
      readBody,
    } as unknown as RouteContext,
  };
}

describe("bots-core foreign paths", () => {
  it("passes /api/routines, bot messages, and bot skills", async () => {
    const handler = createBotsCoreRoutes(baseDeps());
    expect(await handler(context("/api/routines").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/x/messages").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/x/skills").ctx)).toBe(PASS);
  });

  it("passes when the method is wrong for an owned path", async () => {
    const handler = createBotsCoreRoutes(baseDeps());
    expect(await handler(context("/api/bots", "DELETE").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/primary", "GET").ctx)).toBe(PASS);
    expect(await handler(context("/api/bots/b1/active-branch", "GET").ctx)).toBe(PASS);
  });
});

describe("bots-core auth refusals", () => {
  it("refuses primary when the caller is not the owner", async () => {
    const handler = createBotsCoreRoutes(baseDeps({
      identity: { kind: "perspicax" },
      actorPrincipalId: () => "pr_other",
      effectiveBotOwner: () => "pr_owner",
    }));
    const { ctx, json } = context("/api/bots/b1/primary", "POST", sessionOther);
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, expect.objectContaining({ code: "not_bot_owner" }));
  });

  it("refuses soul GET when the caller is not owner or admin", async () => {
    const handler = createBotsCoreRoutes(baseDeps({
      ownerOrAdminOf: () => false,
    }));
    const { ctx, json } = context("/api/bots/b1/soul", "GET", sessionOther);
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, expect.objectContaining({ code: "bot_instructions_owner_only" }));
  });

  it("refuses profile PATCH when botEditsNeedOwner and caller lacks edit", async () => {
    const handler = createBotsCoreRoutes(baseDeps({
      botEditsNeedOwner: () => true,
      memberOwnsBot: () => false,
      viewerBotLevel: () => null,
    }));
    const { ctx, json } = context("/api/bots/b1/profile", "PATCH", sessionOther, { name: "Renamed" });
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 403, expect.objectContaining({ code: "bot_profile_owner_only" }));
  });
});

describe("bots-core happy paths", () => {
  it("lists bots on GET /api/bots", async () => {
    const handler = createBotsCoreRoutes(baseDeps());
    const { ctx, json } = context("/api/bots", "GET");
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      bots: expect.any(Array),
    }));
  });

  it("answers GET /api/bot-defaults", async () => {
    const handler = createBotsCoreRoutes(baseDeps());
    const { ctx, json } = context("/api/bot-defaults", "GET");
    await handler(ctx);
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      defaults: expect.any(Object),
      suggestedName: expect.any(String),
    }));
  });

  it("suggestedName ignores another person's bot names (#2045)", async () => {
    // Peer took the first curated name ("Scout"). With owner scoping it stays
    // free for the viewer; Math.random pinned so the pick is deterministic.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const peerScout = { ...bot, id: "b-peer", name: "Scout", ownerUserId: "pr_other" } as unknown as BotRecord;
    const handler = createBotsCoreRoutes(baseDeps({
      store: storeStub({ bots: [bot, peerScout] }),
      viewerId: () => "pr_owner",
      effectiveBotOwner: (b) => String(b.ownerUserId ?? ""),
      requesterPrincipal: () => "pr_owner",
    }));
    const { ctx, json } = context("/api/bot-defaults", "GET", sessionOwner);
    await handler(ctx);
    random.mockRestore();
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      suggestedName: "Scout",
    }));
  });

  it("sets primary on POST", async () => {
    const setPrimaryBot = vi.fn(() => [bot]);
    const handler = createBotsCoreRoutes(baseDeps({
      store: storeStub({ setPrimaryBot }),
      actorPrincipalId: () => "pr_owner",
      effectiveBotOwner: () => "pr_owner",
    }));
    const { ctx, json } = context("/api/bots/b1/primary", "POST", sessionOwner);
    await handler(ctx);
    expect(setPrimaryBot).toHaveBeenCalledWith("b1");
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, expect.objectContaining({
      changed: ["b1"],
    }));
  });

  it("switches active-branch", async () => {
    const setActiveLeaf = vi.fn(() => "leaf-9");
    const patchTask = vi.fn(() => ({ threadId: "t1" } as never));
    const handler = createBotsCoreRoutes(baseDeps({
      store: storeStub({ setActiveLeaf, patchTask }),
      requestedTaskBot: () => bot,
    }));
    const { ctx, json } = context("/api/bots/b1/active-branch", "POST", sessionOwner, { threadId: "t1", messageId: "m9" });
    await handler(ctx);
    expect(setActiveLeaf).toHaveBeenCalledWith("t1", "m9");
    expect(json).toHaveBeenCalledWith(expect.anything(), 200, { activeLeafId: "leaf-9" });
  });
});
