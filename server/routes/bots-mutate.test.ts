import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { createBotsMutateRoutes, type BotsMutateRouteDeps } from "./bots-mutate.ts";
import { PASS, dispatchRoutes, type RouteContext } from "./table.ts";
import { buildBotPatchProfile } from "./bots-mutate-patch-build-profile.ts";
import { createBotPatchState, type BotPatchState, type BotsMutateEnv } from "./bots-mutate-helpers.ts";

function context(path: string, method = "GET", body: unknown = {}, headers: Record<string, string> = {}) {
  const json = vi.fn();
  const url = new URL(`http://fixture${path}`);
  const ctx = {
    req: { headers }, res: { setHeader: vi.fn() }, url, path: url.pathname, method,
    auth: { kind: "loopback", scopes: ["client", "admin"], trust: "owner" },
    json, readBody: vi.fn(async () => body),
  } as unknown as RouteContext;
  return { ctx, json };
}

const bot = {
  id: "osprey", name: "Osprey", threadId: "thread-1", busy: false,
  modelSelection: { instanceId: "xai", model: "grok", auto: false },
  alwaysAllow: [],
};

function baseDeps(overrides: Partial<BotsMutateRouteDeps> = {}): BotsMutateRouteDeps {
  return {
    ADMIN_APPROVAL_REQUIRED: { error: "admin" },
    BOTS_READ_ONLY: { error: "org_bots_read_only", message: "read only" },
    COMMAND_ALLOWLIST_ADD_REFUSAL: "add refused",
    COMMAND_ALLOWLIST_DRIVERS: new Set(["xai"]),
    DESKTOP_MANAGED: false,
    IDENTITY: { kind: "personal" },
    MAX_MCP_SERVERS: 20,
    MAX_WORKSPACE_BOTS: 100,
    MEMBER_AUTO_NOT_ALLOWED: { error: "auto refused" },
    MEMBER_BOT_FULL_ACCESS: { error: "full refused", code: "member_bot_full_access" },
    MY_CHROME_PROFILE: "my-chrome",
    store: {
      bot: vi.fn((id: string) => id === "osprey" ? bot : null),
      bots: [bot],
      tasks: vi.fn(() => [{ threadId: "thread-1" }]),
      patchBot: vi.fn((_id: string, patch: Record<string, unknown>) => ({ ...bot, ...patch })),
      patchTask: vi.fn(),
      messagesFor: vi.fn(() => []),
      projectBotForTask: vi.fn(() => bot),
      taskByThread: vi.fn(() => ({ threadId: "thread-1", unread: true })),
      groups: [],
      sections: [],
      setPrimaryBot: vi.fn(() => []),
      clearAutoSurfacePins: vi.fn(),
      isConfidentialThread: vi.fn(() => false),
    },
    wireBot: vi.fn((b: typeof bot) => b),
    broadcast: vi.fn(),
    requestedTaskBot: vi.fn(() => bot),
    ownerSettingsForbidden: vi.fn(() => null),
    checkedModelSelection: vi.fn((raw: unknown) => ({ ok: true, selection: raw ?? bot.modelSelection })),
    selectionOnMachine: vi.fn(() => null),
    sessionPrincipal: vi.fn(() => "pr_osprey"),
    activeGroupTurnForBot: vi.fn(() => null),
    threadBusy: vi.fn(() => false),
    hostedModels: null,
    speakerFor: vi.fn(() => ({})),
    autoEnginesFor: vi.fn(() => []),
    autoPayerKey: vi.fn(() => "payer"),
    autoRefusalsFor: vi.fn(() => []),
    limitFailover: { autoExcluded: vi.fn(() => new Set()) },
    autoPickForTurn: vi.fn(() => null),
    autoModelRecord: vi.fn(),
    explainPick: vi.fn(() => ""),
    botRecoveryBackups: vi.fn(() => []),
    personalProviderInstances: { visible: vi.fn(() => true) },
    engineDisplayName: vi.fn(() => "xAI"),
    registry: { get: vi.fn(() => ({ driverKind: "xai", models: { options: [] }, displayName: "xAI" })) },
    canManageCommandAllowlist: vi.fn(() => true),
    computerOwner: vi.fn(() => true),
    ownerOrAdminOf: vi.fn(() => true),
    commandAllowlistResponse: vi.fn(() => ({ rules: [] })),
    commandAllowlistCandidate: vi.fn(() => null),
    commandAllowlist: { add: vi.fn(), remove: vi.fn() },
    settingsStepUpGate: vi.fn(() => null),
    ruleManager: vi.fn(() => "pr_osprey"),
    approvalOwnerId: vi.fn(() => "pr_osprey"),
    memberOwnsBot: vi.fn(() => true),
    deleteBotWithLifecycle: vi.fn(async () => ({ status: 200, body: { ok: true } })),
    pushHub: { noteRead: vi.fn() },
    actorPrincipalId: vi.fn(() => "pr_osprey"),
    readCursor: vi.fn(() => ({})),
    threadsShownTo: vi.fn((_bot: unknown, tasks: unknown[]) => tasks),
    scopedThreadViewer: vi.fn(() => null),
    isAgentConversation: vi.fn(() => false),
    z: { string: () => ({ regex: () => ({}) }), object: () => ({ strict: () => ({ safeParse: () => ({ success: false }) }) }), array: () => ({ max: () => ({ safeParse: () => ({ success: false }) }) }) },
    ...overrides,
  };
}

describe("bots-mutate routes", () => {
  it("Always allow from a linked root card saves only its exact source bot's grant", async () => {
    const worker = { ...bot, id: "worker", threadId: "work" };
    const original = { card: { requestId: "provider-request", allowKey: "mcp:read" } };
    const mirror = { card: { requestId: "origin:card", allowKey: "origin:card" } };
    const deps = baseDeps({
      originApprovals: { sourceFor: () => ({ threadId: "work", requestId: "provider-request" }) },
      requestedTaskBot: vi.fn((_id: string, threadId: string) => threadId === "work" ? worker : bot),
      requirePinnedClientThread: vi.fn(), memberOwnedInOrg: () => false,
      approvalAnswerRefusal: vi.fn(() => null), cardAnswerRefusal: vi.fn(() => null),
      alwaysAllowStepUpGate: vi.fn(() => null), directTurnBots: new Map(),
    });
    deps.store.messagesFor = (threadId: string) => [threadId === "work" ? original : mirror];
    deps.store.botByThread = () => worker;
    deps.store.bot = () => worker;
    const { ctx, json } = context("/api/bots/osprey/always-allow", "POST", { threadId: "thread-1", allowKey: "origin:card" });
    await createBotsMutateRoutes(deps)(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 200, expect.anything());
    expect(deps.approvalAnswerRefusal).toHaveBeenCalledWith(ctx.auth, "work", "provider-request");
    expect(deps.alwaysAllowStepUpGate).toHaveBeenCalledWith("pr_osprey", "worker", "work", "provider-request", "mcp:read", undefined);
    expect(deps.store.patchTask).toHaveBeenCalledOnce();
    expect(deps.store.patchTask).toHaveBeenCalledWith("worker", "work", { alwaysAllow: ["mcp:read"] });
  });

  it("passes unrelated requests to the next route", async () => {
    expect(await createBotsMutateRoutes(baseDeps())(context("/api/unrelated").ctx)).toBe(PASS);
  });

  it("refuses a model change when owner settings forbid it", async () => {
    const deps = baseDeps({ ownerSettingsForbidden: vi.fn(() => ({ error: "forbidden", code: "bot_model_owner_only" })) });
    const { ctx, json } = context("/api/bots/osprey/model", "PATCH", { instanceId: "xai", model: "grok" });
    await createBotsMutateRoutes(deps)(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 403, expect.objectContaining({ code: "bot_model_owner_only" }));
    expect(deps.store.patchBot).not.toHaveBeenCalled();
  });

  it("#3033: a bot-wide model change from the agent API needs no conversation; the app still names one", async () => {
    const run = async (body: Record<string, unknown>) => {
      const known: Record<string, unknown> = {
        store: { bot: () => bot, tasks: () => [{ threadId: "thread-1" }, { threadId: "thread-2" }] },
        auth: { kind: "session", scopes: ["client"] }, req: { headers: {} },
        threadsShownTo: (_bot: unknown, tasks: unknown[]) => tasks, scopedThreadViewer: () => null,
        isAgentConversation: () => false, json: vi.fn(),
      };
      const env = new Proxy(known, { get: (target, key: string) => key in target ? target[key] : vi.fn(() => undefined) });
      const state = { ...createBotPatchState(["/api/bots/osprey", "osprey"] as unknown as RegExpMatchArray), body } as unknown as BotPatchState;
      try { await buildBotPatchProfile(env as unknown as BotsMutateEnv, state); return null; } catch (error) { return error as { code?: string; status?: number }; }
    };
    const selection = { instanceId: "xai", model: "grok-2" };
    expect(await run({ modelSelection: selection })).toMatchObject({ code: "thread_required", status: 409 });
    expect((await run({ modelSelection: selection, botWide: true }))?.code).not.toBe("thread_required");
  });

  it("#3423: a change of the proactive switch records who set it", async () => {
    const known: Record<string, unknown> = {
      store: { bot: () => bot, tasks: () => [{ threadId: "thread-1" }] },
      auth: { kind: "session", scopes: ["client"] }, req: { headers: {} },
      parseBotProfilePatch: () => ({ ok: true, patch: {} }), lockedLookRefusal: () => null,
      isProactiveMode: (value: unknown) => value === "off" || value === "proactive",
      normalizeProactiveMode: (value: unknown) => value === "off" ? "off" : "proactive",
      sessionPrincipal: () => "pr_osprey", json: vi.fn(),
    };
    const env = new Proxy(known, { get: (target, key: string) => key in target ? target[key] : vi.fn(() => undefined) });
    const state = { ...createBotPatchState(["/api/bots/osprey", "osprey"] as unknown as RegExpMatchArray), body: { proactiveMode: "off" } } as unknown as BotPatchState;
    const before = Date.now();
    expect(await buildBotPatchProfile(env as unknown as BotsMutateEnv, state)).toBe(false);
    expect(state.patch).toMatchObject({ proactiveMode: "off", proactiveModeSet: { principalId: "pr_osprey" } });
    expect((state.patch as { proactiveModeSet: { at: number } }).proactiveModeSet.at).toBeGreaterThanOrEqual(before);
  });

  it("marks the open conversation read", async () => {
    const deps = baseDeps();
    const { ctx, json } = context("/api/bots/osprey/read", "POST", { threadId: "thread-1" });
    await createBotsMutateRoutes(deps)(ctx);
    expect(deps.store.patchTask).toHaveBeenCalledWith("osprey", "thread-1", expect.objectContaining({ unread: false }));
    expect(deps.pushHub.noteRead).toHaveBeenCalledWith("pr_osprey", "thread-1");
    expect(json).toHaveBeenCalledWith(ctx.res, 200, expect.objectContaining({ bot: expect.anything() }));
  });

  it("refuses delete for a bot another person owns", async () => {
    const deps = baseDeps({
      memberOwnsBot: vi.fn(() => false),
    });
    const { ctx, json } = context("/api/bots/osprey", "DELETE");
    ctx.auth = { kind: "session", scopes: ["client"], session: { principalId: "pr_wren" } } as never;
    await createBotsMutateRoutes(deps)(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 403, expect.objectContaining({ code: "bot_delete_owner_only" }));
    expect(deps.deleteBotWithLifecycle).not.toHaveBeenCalled();
  });

  it("deletes when the owner asks", async () => {
    const deps = baseDeps();
    const { ctx, json } = context("/api/bots/osprey", "DELETE");
    await createBotsMutateRoutes(deps)(ctx);
    expect(deps.deleteBotWithLifecycle).toHaveBeenCalledWith("osprey");
    expect(json).toHaveBeenCalledWith(ctx.res, 200, { ok: true });
  });

  it("preserves each request's scope across asynchronous route dispatch", async () => {
    const scope = new AsyncLocalStorage<string>();
    const seen: string[] = [];
    const deps = baseDeps({
      deleteBotWithLifecycle: vi.fn(async () => {
        await Promise.resolve();
        seen.push(scope.getStore()!);
        return { status: 200, body: { ok: true } };
      }),
    });
    const route = createBotsMutateRoutes(deps);
    await Promise.all(["pr_osprey", "pr_wren"].map((person) =>
      scope.run(person, () => dispatchRoutes([route], context("/api/bots/osprey", "DELETE").ctx))));
    expect(seen.sort()).toEqual(["pr_osprey", "pr_wren"]);
  });
});
