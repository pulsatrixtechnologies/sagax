import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it, vi } from "vitest";
import { createBotsMutateRoutes, type BotsMutateRouteDeps } from "./bots-mutate.ts";
import { PASS, dispatchRoutes, type RouteContext } from "./table.ts";
import { buildBotPatchProfile } from "./bots-mutate-patch-build-profile.ts";
import { buildBotPatchAccess } from "./bots-mutate-patch-build-access.ts";
import { createBotPatchState, type BotPatchState, type BotsMutateEnv } from "./bots-mutate-helpers.ts";
import { forgetToolKeepInMemory, readToolKeep, setToolAlwaysListed, toolKeepTurn } from "../tools/tool-keep.ts";

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
  it("#4359: a products patch merges this bot's switches and refuses anything but product ids with booleans", async () => {
    const run = async (body: Record<string, unknown>, existing: Record<string, unknown> = { products: { psa: false } }) => {
      const json = vi.fn();
      const env = new Proxy({ json, res: {}, auth: { kind: "loopback" } } as Record<string, unknown>, { get: (target, key: string) => key in target ? target[key] : vi.fn(() => undefined) });
      const state = { ...createBotPatchState(["/api/bots/osprey", "osprey"] as unknown as RegExpMatchArray), body, existingBot: { ...bot, ...existing } } as unknown as BotPatchState;
      const stopped = await buildBotPatchAccess(env as unknown as BotsMutateEnv, state);
      return { stopped, patch: state.patch as Record<string, unknown>, json };
    };
    const merged = await run({ products: { EDR: false } });
    expect(merged.stopped).toBe(false);
    expect(merged.patch.products).toEqual({ psa: false, edr: false });
    expect((await run({ products: { psa: true } })).patch.products).toEqual({ psa: true });
    const refused = await run({ products: { psa: "off" } });
    expect(refused.stopped).toBe(true);
    expect(refused.json).toHaveBeenCalledWith({}, 400, expect.objectContaining({ error: expect.stringContaining("true or false") }));
    expect((await run({})).patch.products).toBeUndefined();
  });

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

  // #4417: the bot's context size, kept like its model; null goes back to the default
  it("saves the bot's context size, clears it with null and refuses a non-size", async () => {
    const run = async (contextWindow: unknown) => {
      const json = vi.fn();
      const known: Record<string, unknown> = {
        store: { bot: () => bot, tasks: () => [{ threadId: "thread-1" }] },
        auth: { kind: "session", scopes: ["client"] }, req: { headers: {} },
        parseBotProfilePatch: () => ({ ok: true, patch: {} }), lockedLookRefusal: () => null, json,
      };
      const env = new Proxy(known, { get: (target, key: string) => key in target ? target[key] : vi.fn(() => undefined) });
      const state = { ...createBotPatchState(["/api/bots/osprey", "osprey"] as unknown as RegExpMatchArray), body: { contextWindow } } as unknown as BotPatchState;
      const stopped = await buildBotPatchProfile(env as unknown as BotsMutateEnv, state);
      return { stopped, patch: state.patch as Record<string, unknown>, json };
    };
    const set = await run(200_000);
    expect(set.stopped).toBe(false);
    expect(set.patch.contextWindow).toBe(200_000);
    const cleared = await run(null);
    expect("contextWindow" in cleared.patch && cleared.patch.contextWindow === undefined).toBe(true);
    const refused = await run("1M");
    expect(refused.stopped).toBe(true);
    expect(refused.json).toHaveBeenCalledWith(expect.anything(), 400, expect.objectContaining({ error: expect.stringContaining("contextWindow") }));
  });

  it("marks the open conversation read", async () => {
    const deps = baseDeps();
    const { ctx, json } = context("/api/bots/osprey/read", "POST", { threadId: "thread-1" });
    await createBotsMutateRoutes(deps)(ctx);
    // #4187: the flip from unread to read is announced (one bot frame)
    expect(deps.store.patchTask).toHaveBeenCalledWith("osprey", "thread-1", expect.objectContaining({ unread: false }), { announce: true });
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

// M-20261126-101: the menu's preview reads the limits as the turn's pick does
describe("GET /api/bots/:id/auto-model", () => {
  it("lists an account whose plan the usage report shows spent as held by its limit", async () => {
    const engines = [
      { instanceId: "claude", displayName: "Claude Code", models: { options: [] } },
      { instanceId: "grok", displayName: "Grok", models: { options: [] } },
    ];
    // no turn was refused yet: only a reading of the person's usage report knows of the limit
    const autoExcluded = vi.fn((_payer: string, _engines: unknown, pick?: string) => new Set(pick === "report" ? ["claude"] : []));
    const route = createBotsMutateRoutes(baseDeps({ autoEnginesFor: vi.fn(() => engines), limitFailover: { autoExcluded } } as unknown as Partial<BotsMutateRouteDeps>));
    const { ctx, json } = context("/api/bots/osprey/auto-model");
    expect(await dispatchRoutes([route], ctx)).not.toBe(PASS);
    expect(json.mock.calls[0]?.[2]).toMatchObject({ excluded: [{ instanceId: "claude", engineLabel: "Claude Code", reason: "limit" }] });
  });

  // review M1: with every account at its limit the turn would still try its
  // list, and the preview names none of it: no pick, no sentence about one
  it("names no model as Auto's next one while every account is at its limit", async () => {
    const engines = [
      { instanceId: "claude", displayName: "Claude Code", models: { options: [{ id: "opus", label: "Claude Opus" }] } },
      { instanceId: "grok", displayName: "Grok", models: { options: [{ id: "grok-4", label: "Grok 4" }] } },
    ];
    const pick = { selection: { instanceId: "claude", model: "opus" }, chain: [{ instanceId: "claude", model: "opus" }, { instanceId: "grok", model: "grok-4" }] };
    const preview = async (spent: string[]) => {
      const autoExcluded = vi.fn((_payer: string, _engines: unknown, kind?: string) => new Set(kind === "report" ? spent : []));
      const route = createBotsMutateRoutes(baseDeps({
        autoEnginesFor: vi.fn(() => engines), limitFailover: { autoExcluded, limitedUntil: vi.fn(() => null) },
        autoPickForTurn: vi.fn(() => ({ pick })), autoModelRecord: vi.fn(() => ({ instanceId: "claude", model: "opus", modelLabel: "Claude Opus" })),
        explainPick: vi.fn(() => "Claude Opus is the strongest."),
      } as unknown as Partial<BotsMutateRouteDeps>));
      const { ctx, json } = context("/api/bots/osprey/auto-model");
      await dispatchRoutes([route], ctx);
      return json.mock.calls[0]?.[2] as { pick: unknown; explanation: string };
    };
    expect(await preview(["claude"])).toMatchObject({ pick: { modelLabel: "Claude Opus" }, explanation: "Claude Opus is the strongest." });
    expect(await preview(["claude", "grok"])).toMatchObject({ pick: null, explanation: "" });
  });

  // review M1b: Settings > Models reads the same answer; with every account at
  // its limit it names no model as Auto's order, leaves each account out for
  // its limit, and says when the first one is back
  it("puts every account at its limit under left out, with no order of choice and the first reset", async () => {
    const engines = [
      { instanceId: "claude", displayName: "Claude Code", models: { options: [{ id: "opus", label: "Claude Opus" }] } },
      { instanceId: "grok", displayName: "Grok", models: { options: [{ id: "grok-4", label: "Grok 4" }] } },
    ];
    const pick = { selection: { instanceId: "claude", model: "opus" }, chain: [{ instanceId: "claude", model: "opus" }, { instanceId: "grok", model: "grok-4" }] };
    const preview = async (spent: string[]) => {
      const autoExcluded = vi.fn((_payer: string, _engines: unknown, kind?: string) => new Set(kind === "report" ? spent : []));
      const route = createBotsMutateRoutes(baseDeps({
        autoEnginesFor: vi.fn(() => engines), limitFailover: { autoExcluded, limitedUntil: vi.fn(() => 1_900_000_000_000) },
        autoPickForTurn: vi.fn(() => ({ pick })), autoModelRecord: vi.fn(() => ({ instanceId: "claude", model: "opus", modelLabel: "Claude Opus" })),
        explainPick: vi.fn(() => "Claude Opus is the strongest."),
      } as unknown as Partial<BotsMutateRouteDeps>));
      const { ctx, json } = context("/api/bots/osprey/auto-model");
      await dispatchRoutes([route], ctx);
      return json.mock.calls[0]?.[2] as { chain: unknown[]; excluded: unknown[]; limited?: unknown };
    };
    const all = await preview(["claude", "grok"]);
    expect(all.chain).toEqual([]);
    expect(all.excluded).toEqual([
      { instanceId: "claude", engineLabel: "Claude Code", reason: "limit" },
      { instanceId: "grok", engineLabel: "Grok", reason: "limit" },
    ]);
    expect(all.limited).toEqual({ until: 1_900_000_000_000 });
    // one account with room: the order of choice stays, only the spent one is left out
    const one = await preview(["claude"]);
    expect(one.chain).toHaveLength(2);
    expect(one.excluded).toEqual([{ instanceId: "claude", engineLabel: "Claude Code", reason: "limit" }]);
    expect(one).not.toHaveProperty("limited");
  });
});

// #4527 lot E: the person's own tools left out of a bot's list
describe("PATCH /api/bots/:id toolKeep", () => {
  /** A person's state with one tool left out (the rule's verdict, set directly). */
  const leaveOut = (person: string) => {
    toolKeepTurn({ botId: "osprey", person, threadId: `t-${person}`, prompt: true });
    setToolAlwaysListed("osprey", person, "agents/list_rooms", true);
    setToolAlwaysListed("osprey", person, "agents/list_rooms", false);
    const state = readToolKeep("osprey", person);
    state.leftOut = ["agents/run_routine"];
  };
  const org = (principal: string, level: string | null = "use") => baseDeps({
    IDENTITY: { kind: "perspicax" },
    sessionPrincipal: vi.fn(() => principal),
    viewerBotLevel: vi.fn(() => level),
    effectiveBotOwner: vi.fn(() => "pr_owner"),
  });
  const member = (ctx: RouteContext, principal: string) => { ctx.auth = { kind: "session", scopes: ["client"], session: { principalId: principal } } as never; };

  it("a member brings every tool back for their own list, with no administrator, and nobody else's moves", async () => {
    forgetToolKeepInMemory();
    leaveOut("pr_alice");
    leaveOut("pr_bob");
    const { ctx, json } = context("/api/bots/osprey", "PATCH", { toolKeep: { bringAllBack: true } });
    member(ctx, "pr_alice");
    await createBotsMutateRoutes(org("pr_alice"))(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 200, { toolKeep: { leftOut: [], alwaysListed: [] } });
    expect(readToolKeep("osprey", "pr_alice").restoredAt).toBeGreaterThan(0);
    expect(readToolKeep("osprey", "pr_bob").leftOut).toEqual(["agents/run_routine"]);
  });

  it("keeps one tool listed always, then gives it back to the rule", async () => {
    forgetToolKeepInMemory();
    leaveOut("pr_alice");
    const on = context("/api/bots/osprey", "PATCH", { toolKeep: { tool: "agents/run_routine", alwaysListed: true } });
    member(on.ctx, "pr_alice");
    await createBotsMutateRoutes(org("pr_alice"))(on.ctx);
    expect(on.json).toHaveBeenCalledWith(on.ctx.res, 200, { toolKeep: { leftOut: [], alwaysListed: ["agents/run_routine"] } });
    const off = context("/api/bots/osprey", "PATCH", { toolKeep: { tool: "agents/run_routine", alwaysListed: false } });
    member(off.ctx, "pr_alice");
    await createBotsMutateRoutes(org("pr_alice"))(off.ctx);
    expect(off.json).toHaveBeenCalledWith(off.ctx.res, 200, { toolKeep: { leftOut: [], alwaysListed: [] } });
  });

  it("answers 404 for a bot the person cannot see, and 400 for a malformed change or one with other fields", async () => {
    const hidden = context("/api/bots/osprey", "PATCH", { toolKeep: { bringAllBack: true } });
    member(hidden.ctx, "pr_eve");
    await createBotsMutateRoutes(org("pr_eve", null))(hidden.ctx);
    expect(hidden.json).toHaveBeenCalledWith(hidden.ctx.res, 404, { error: "no such bot" });
    for (const body of [{ toolKeep: { bringAllBack: "yes" } }, { toolKeep: { tool: "list_rooms", alwaysListed: true } }, { toolKeep: { bringAllBack: true }, name: "Renamed" }]) {
      const bad = context("/api/bots/osprey", "PATCH", body);
      member(bad.ctx, "pr_alice");
      await createBotsMutateRoutes(org("pr_alice"))(bad.ctx);
      expect(bad.json).toHaveBeenCalledWith(bad.ctx.res, 400, expect.objectContaining({ error: expect.stringContaining("toolKeep") }));
    }
  });

  it("on a personal server, the bot's owner's list", async () => {
    forgetToolKeepInMemory();
    leaveOut("pr_owner");
    const { ctx, json } = context("/api/bots/osprey", "PATCH", { toolKeep: { bringAllBack: true } });
    await createBotsMutateRoutes(baseDeps({ viewerBotLevel: vi.fn(() => "owner"), effectiveBotOwner: vi.fn(() => "pr_owner") }))(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 200, { toolKeep: { leftOut: [], alwaysListed: [] } });
    expect(readToolKeep("osprey", "pr_owner").leftOut).toEqual([]);
  });
});

// #4527 review: isolation between people, and a card that says what the engine leaves out
describe("PATCH /api/bots/:id toolKeep, review", () => {
  const leaveOut = (person: string, ids: string[]) => {
    toolKeepTurn({ botId: "osprey", person, threadId: `t-${person}`, prompt: true });
    readToolKeep("osprey", person).leftOut = [...ids];
  };
  const org = (principal: string | null, driverKind = "codex") => baseDeps({
    IDENTITY: { kind: "perspicax" },
    sessionPrincipal: vi.fn(() => principal),
    viewerBotLevel: vi.fn(() => "use"),
    effectiveBotOwner: vi.fn(() => "pr_owner"),
    registry: { get: vi.fn(() => ({ driverKind, models: { options: [] }, displayName: "Engine" })) },
  });

  it("on an organization server, a caller who is no signed-in person changes nobody's list, the owner's included", async () => {
    forgetToolKeepInMemory();
    leaveOut("pr_owner", ["agents/run_routine"]);
    const { ctx, json } = context("/api/bots/osprey", "PATCH", { toolKeep: { bringAllBack: true } });
    ctx.auth = { kind: "loopback", trust: "service", scopes: ["admin"] } as never;
    await createBotsMutateRoutes(org(null))(ctx);
    expect(json).toHaveBeenCalledWith(ctx.res, 403, expect.objectContaining({ error: expect.stringContaining("toolKeep") }));
    expect(readToolKeep("osprey", "pr_owner").leftOut).toEqual(["agents/run_routine"]);
  });

  it("shows as left out only what this bot's engine leaves out up front", async () => {
    // #4527 lot D: a connector's tools too, but on Grok, whose own tool search serves them
    const both = ["agents/run_routine", "crm/old_report"];
    for (const [driverKind, shown] of [["codex", both], ["grokAgent", ["agents/run_routine"]], ["museCode", both], ["openai-compat", both], ["claudeAgent", both]] as const) {
      forgetToolKeepInMemory();
      leaveOut("pr_alice", ["agents/run_routine", "crm/old_report"]);
      const { ctx, json } = context("/api/bots/osprey", "PATCH", { toolKeep: { tool: "agents/list_bots", alwaysListed: false } });
      ctx.auth = { kind: "session", scopes: ["client"], session: { principalId: "pr_alice" } } as never;
      await createBotsMutateRoutes(org("pr_alice", driverKind))(ctx);
      expect(json).toHaveBeenCalledWith(ctx.res, 200, { toolKeep: { leftOut: shown, alwaysListed: [] } });
    }
  });
});
