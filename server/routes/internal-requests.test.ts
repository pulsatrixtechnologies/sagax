// Characterization of the I3 internal request routes moved out of
// server/index.ts (#1388): routines list, routine/profile/model/rule
// proposals, team-setup catalog and requests, bot-deletion requests.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import { createInternalRequestsRoutes, type InternalRequestsDeps } from "./internal-requests.ts";
import { PASS } from "./table.ts";

const BOT = {
  id: "bot-1",
  name: "Ledger",
  color: "#111",
  title: "Books",
  section: "Finance",
  chiefOfStaff: true,
  hidden: false,
  modelSelection: { instanceId: "eng-1", model: "m1" },
};

function baseDeps(over: Partial<InternalRequestsDeps> = {}): InternalRequestsDeps {
  const proposed = {
    requestId: "req-1",
    messageId: "msg-1",
    state: "pending" as const,
    summary: "summary",
    detail: "detail",
  };
  return {
    bot: (id) => (id === BOT.id ? { ...BOT } : undefined),
    bots: () => [{ ...BOT }],
    ownsThread: (botId, threadId) => (botId === BOT.id && threadId === "t-1" ? { group: undefined } : null),
    messagesFor: () => [],
    listRoutines: () => [{
      id: "r1",
      botId: BOT.id,
      name: "Daily",
      prompt: "do it",
      enabled: true,
      runOn: "schedule",
      durationMinutes: 30,
      nextRunAt: null,
      schedule: { type: "cron", expression: "0 9 * * *" },
      continuity: false,
      overlap: "skip",
      skippedRuns: 0,
      failureStreak: 0,
    }],
    listRuns: () => [],
    listWebhooks: () => [],
    timeZone: () => "America/Toronto",
    canReachPeer: () => true,
    primaryBotSameOwner: () => false,
    peerAccessHelp: "call list_bots",
    proposalPersistence: () => ({ ok: true as const }),
    safetyPrincipal: () => ({ triage: false }),
    safetyPermissionEffect: () => null,
    primaryAskedProposal: () => "no quote",
    journalRefusedQuote: () => undefined,
    withPrimaryAsked: async (_proof, _scope, submit) => submit(false),
    settleProposalByRule: () => undefined,
    safetyArm: () => undefined,
    appendDecision: () => undefined,
    submitRoutine: async () => proposed,
    resolveRoutine: () => ({ claimed: false }),
    submitProfile: async () => ({ ...proposed, detail: "profile" }),
    resolveProfile: () => ({ claimed: false, state: "pending" as const, targetBotId: BOT.id }),
    submitModel: async () => ({ ...proposed, detail: "model" }),
    resolveModel: () => ({ claimed: false, state: "pending" as const, targetBotId: BOT.id }),
    engineDisplayName: () => "Engine",
    primaryTurnGate: () => ({ error: "no turn" }),
    checkPersonQuote: () => ({ ok: false as const, reason: "no" }),
    effectiveBotOwner: () => "pr_owner",
    customRuleWhen: () => undefined,
    askedChange: () => "not asked",
    submitRule: () => ({ ...proposed, detail: "rule" }),
    resolveRule: () => ({ claimed: false, state: "pending" as const }),
    appendAdminAction: () => undefined,
    identityKind: () => "solo" as const,
    isActive: () => true,
    requireActive: () => undefined,
    describeInstances: async () => [{
      instanceId: "eng-1",
      driverKind: "claudeAgent",
      displayName: "Engine",
      snapshot: { state: "ready" },
      models: ["m1"],
      capabilities: { effortLevels: [] },
    }],
    canAccessBot: () => true,
    peerAllowed: () => true,
    peerInScope: () => true,
    archivedAgent: () => false,
    teamSetupTeams: (_owner) => ["Finance"],
    canAccessTeam: () => true,
    orgOfferedEngines: (instances) => instances,
    consoleEngineAllowed: () => true,
    orgOwnAccountsOutsideList: () => false,
    personPaysEngine: () => false,
    ownerBotsReadOnly: () => false,
    botsReadOnlyBody: { error: "org_bots_read_only", message: "read only" },
    submitTeamSetup: async () => ({ ...proposed, detail: "setup", state: "pending" as const }),
    submitBotDeletion: async () => ({ ...proposed, detail: "delete", state: "pending" as const }),
    fullAccessForSource: () => false,
    broadcastBot: () => undefined,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalRequestsRoutes>,
  opts: { path: string; method: string; body?: Record<string, unknown>; query?: string; capability?: InternalRouteContext["capability"] },
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const url = new URL(`http://x${opts.path}${opts.query ? `?${opts.query}` : ""}`);
  const run = async () => {
    const out = await route({
      res: {} as ServerResponse,
      path: opts.path,
      method: opts.method,
      url,
      json: ((_res: ServerResponse, status: number, body: unknown) => {
        sent.push({ status, body });
      }) as InternalRouteContext["json"],
      capability: opts.capability ?? { botId: BOT.id, threadId: "t-1", generation: "g1" },
      readBody: async () => opts.body ?? {},
    });
    return { out, sent };
  };
  return run();
}

describe("createInternalRequestsRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createInternalRequestsRoutes(baseDeps());
    expect((await call(route, { path: "/api/internal/team-memory", method: "POST" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/agents", method: "GET" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/routines", method: "GET" })).out).toBe(PASS);
  });

  it("GET /routines refuses a foreign source conversation (403)", async () => {
    const route = createInternalRequestsRoutes(baseDeps({
      ownsThread: () => null,
    }));
    const { sent, out } = await call(route, { path: "/api/internal/routines", method: "GET" });
    expect(out).toBeUndefined();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("GET /routines lists the calling bot's routines (happy)", async () => {
    const route = createInternalRequestsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/routines", method: "GET" });
    expect(sent[0]?.status).toBe(200);
    const body = sent[0]?.body as { timeZone: string; routines?: unknown[]; total?: number };
    expect(body.timeZone).toBe("America/Toronto");
    expect(Array.isArray(body.routines) || typeof body.total === "number" || "items" in (body as object)).toBe(true);
  });

  it("POST /routine-requests refuses a foreign thread (403)", async () => {
    const route = createInternalRequestsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, {
      path: "/api/internal/routine-requests",
      method: "POST",
      body: { fromBotId: BOT.id, fromThreadId: "t-1", action: "pause", routineId: "r1" },
    });
    expect(sent[0]).toEqual({ status: 403, body: { error: "source conversation does not belong to sender" } });
  });

  it("POST /routine-requests submits a pause (happy)", async () => {
    const submitRoutine = vi.fn(async () => ({
      requestId: "req-r",
      messageId: "msg-r",
      state: "pending" as const,
      summary: "Pause Daily",
      detail: "Pause Daily",
    }));
    const route = createInternalRequestsRoutes(baseDeps({ submitRoutine }));
    const { sent } = await call(route, {
      path: "/api/internal/routine-requests",
      method: "POST",
      body: { fromBotId: BOT.id, fromThreadId: "t-1", action: "pause", routineId: "r1" },
    });
    expect(sent[0]?.status).toBe(201);
    expect(submitRoutine).toHaveBeenCalled();
  });

  it("POST /profile-requests refuses an unknown sender (403)", async () => {
    const route = createInternalRequestsRoutes(baseDeps({
      bot: () => undefined,
    }));
    const { sent } = await call(route, {
      path: "/api/internal/profile-requests",
      method: "POST",
      body: { fromBotId: "missing", fromThreadId: "t-1", changes: { name: "X" }, reason: "n" },
    });
    expect(sent[0]).toEqual({ status: 403, body: { error: "unknown sender" } });
  });

  it("POST /profile-requests submits (happy)", async () => {
    const submitProfile = vi.fn(async () => ({
      requestId: "req-p",
      messageId: "msg-p",
      state: "pending" as const,
      summary: "s",
      detail: "Rename",
    }));
    const route = createInternalRequestsRoutes(baseDeps({ submitProfile }));
    const { sent } = await call(route, {
      path: "/api/internal/profile-requests",
      method: "POST",
      body: { fromBotId: BOT.id, fromThreadId: "t-1", changes: { name: "X" }, reason: "n" },
    });
    expect(sent[0]?.status).toBe(201);
    expect(submitProfile).toHaveBeenCalled();
  });

  it("POST /model-requests submits (happy)", async () => {
    const submitModel = vi.fn(async () => ({
      requestId: "req-m",
      messageId: "msg-m",
      state: "pending" as const,
      summary: "s",
      detail: "Model",
    }));
    const route = createInternalRequestsRoutes(baseDeps({ submitModel }));
    const { sent } = await call(route, {
      path: "/api/internal/model-requests",
      method: "POST",
      body: {
        fromBotId: BOT.id,
        fromThreadId: "t-1",
        modelSelection: { instanceId: "eng-1", model: "m1" },
        reason: "n",
      },
    });
    expect(sent[0]?.status).toBe(201);
    expect(submitModel).toHaveBeenCalled();
  });

  it("POST /rule-requests refuses a foreign thread (403)", async () => {
    const route = createInternalRequestsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, {
      path: "/api/internal/rule-requests",
      method: "POST",
      body: {
        fromBotId: BOT.id,
        fromThreadId: "t-1",
        action: "add",
        when: "when files change",
        behavior: "allow",
        reason: "n",
      },
    });
    expect(sent[0]).toEqual({ status: 403, body: { error: "source conversation does not belong to sender" } });
  });

  it("GET /team-setup-catalog refuses a non-Primary Bot (403)", async () => {
    const route = createInternalRequestsRoutes(baseDeps({
      bot: () => ({ ...BOT, chiefOfStaff: false }),
    }));
    const { sent } = await call(route, { path: "/api/internal/team-setup-catalog", method: "GET" });
    expect(sent[0]).toEqual({ status: 403, body: { error: "Only an active Primary Bot may plan team setup" } });
  });

  it("GET /team-setup-catalog surfaces an expired capability as 401", async () => {
    const route = createInternalRequestsRoutes(baseDeps({
      requireActive: (_capability) => {
        throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      },
    }));
    await expect(call(route, { path: "/api/internal/team-setup-catalog", method: "GET" }))
      .rejects.toMatchObject({ status: 401 });
  });

  it("GET /team-setup-catalog returns the catalog (happy)", async () => {
    const route = createInternalRequestsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/team-setup-catalog", method: "GET" });
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({
      teams: ["Finance"],
      bots: [expect.objectContaining({ id: BOT.id, name: BOT.name })],
    });
  });

  it("POST /team-setup-requests refuses org bots read-only (403)", async () => {
    const route = createInternalRequestsRoutes(baseDeps({
      ownerBotsReadOnly: () => true,
    }));
    const { sent } = await call(route, {
      path: "/api/internal/team-setup-requests",
      method: "POST",
      body: { plan: { bots: [] } },
    });
    expect(sent[0]).toEqual({
      status: 403,
      body: { error: "org_bots_read_only", message: "read only" },
    });
  });

  it("POST /bot-deletion-requests submits (happy)", async () => {
    const submitBotDeletion = vi.fn(async () => ({
      requestId: "req-d",
      messageId: "msg-d",
      state: "pending" as const,
      summary: "s",
      detail: "Delete X",
    }));
    const route = createInternalRequestsRoutes(baseDeps({ submitBotDeletion }));
    const { sent } = await call(route, {
      path: "/api/internal/bot-deletion-requests",
      method: "POST",
      body: { targetBotId: "bot-2", reason: "retired" },
    });
    expect(sent[0]?.status).toBe(201);
    expect(submitBotDeletion).toHaveBeenCalled();
  });
});
