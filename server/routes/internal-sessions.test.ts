// Characterization of the I4 internal session/file routes moved out of
// server/index.ts (#1388): agents, threads, close, attach-file, vm-exec,
// rooms, session-search, session-read, skills, skills/stage.
import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import { createInternalSessionsRoutes, type InternalSessionsDeps } from "./internal-sessions.ts";
import { PASS } from "./table.ts";

const BOT = {
  id: "bot-1",
  name: "Ledger",
  color: "#111",
  section: "Finance",
  title: "Books",
  description: "Keeps the books",
  modelSelection: { model: "m1" },
  activity: undefined as undefined,
  busy: false,
  threadId: "t-main",
  tasks: [{ threadId: "t-1" }],
  memoryEnabled: true,
};

function baseDeps(over: Partial<InternalSessionsDeps> = {}): InternalSessionsDeps {
  return {
    bot: (id) => (id === BOT.id ? { ...BOT } : undefined),
    bots: () => [{ ...BOT }],
    tasks: (botId) => (botId === BOT.id
      ? [{ threadId: "t-1", title: "Task one", createdAt: 1, openedBy: { botId: BOT.id, at: 1 } }]
      : []),
    taskByThread: (botId, threadId) =>
      botId === BOT.id && threadId === "t-1"
        ? { threadId: "t-1", title: "Task one", createdAt: 1, openedBy: { botId: BOT.id, at: 1 } }
        : undefined,
    groups: () => [],
    groupByThread: () => undefined,
    isConfidentialThread: () => false,
    ownsThread: (botId, threadId) => (botId === BOT.id && (threadId === "t-1" || threadId === "t-main") ? { group: undefined } : null),
    threadBusy: () => false,
    awaitingAnswer: () => false,
    activeDirect: () => false,
    appendMessage: () => ({ id: "msg-1" }),
    patchTask: () => undefined,
    setTaskClosedBy: () => undefined,
    roomPostEligibility: () => ({ ok: true as const }),
    attachmentVm: async () => undefined,
    personDirectTurn: () => false,
    messageFileRoots: () => ["/tmp/bot-files"],
    dataDir: () => "/tmp/data",
    isActive: () => true,
    requireActive: () => undefined,
    computerHeld: () => false,
    commandVariables: () => ({}),
    touchVmIdle: () => undefined,
    containerRuntime: async () => "docker",
    containerExec: async () => ({ stdout: "ok", exitCode: 0 }),
    roomFeedsBot: () => true,
    privateRecallFilter: () => null,
    turnSpeaker: () => undefined,
    localPrincipalId: () => "pr_local",
    isPerspicax: () => false,
    runningTurnInstance: () => ({ driverKind: "claudeAgent" }),
    scopedSkillInventory: () => ({ rows: [], incomplete: false }),
    stagedSkillListing: (staged) => ({ id: staged.id, name: staged.name, action: staged.action }),
    skillAuthoringEnabled: () => true,
    vaultPrincipal: () => "pr_local",
    personalFeatureOn: () => true,
    appliesDirectly: () => "self",
    skillProposalPersistence: () => ({ ok: true as const }),
    recordSkillLearned: () => undefined,
    keptCardRule: () => undefined,
    appendSkillRequestCard: () => ({ requestId: "req-1", summary: "Enable skill" }),
    applyOwnStagedSkill: () => ({ result: { name: "demo", action: "create" as const } }),
    appendDecision: () => undefined,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalSessionsRoutes>,
  opts: {
    path: string;
    method: string;
    body?: Record<string, unknown>;
    query?: string;
    capability?: InternalRouteContext["capability"];
  },
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const url = new URL(`http://x${opts.path}${opts.query ? `?${opts.query}` : ""}`);
  return (async () => {
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
  })();
}

describe("createInternalSessionsRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createInternalSessionsRoutes(baseDeps());
    expect((await call(route, { path: "/api/internal/routines", method: "GET" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/ask-bot", method: "POST" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/memory", method: "POST" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/bots", method: "GET" })).out).toBe(PASS);
  });

  it("GET /agents lists reachable peers (happy)", async () => {
    const route = createInternalSessionsRoutes(baseDeps());
    const { sent, out } = await call(route, { path: "/api/internal/agents", method: "GET" });
    expect(out).toBeUndefined();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.status).toBe(200);
    const body = sent[0]!.body as { bots: Array<{ id: string; name: string }> };
    expect(body.bots.some((b) => b.id === BOT.id)).toBe(false); // peers only, not self
  });

  it("GET /threads refuses a foreign source conversation (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({
      ownsThread: () => null,
    }));
    const { sent, out } = await call(route, { path: "/api/internal/threads", method: "GET" });
    expect(out).toBeUndefined();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("GET /threads lists the caller's threads (happy)", async () => {
    const route = createInternalSessionsRoutes(baseDeps());
    const { sent, out } = await call(route, { path: "/api/internal/threads", method: "GET" });
    expect(out).toBeUndefined();
    expect(sent[0]!.status).toBe(200);
    const body = sent[0]!.body as { threads: Array<{ threadId: string; own: boolean }> };
    expect(body.threads.some((t) => t.threadId === "t-1" && t.own)).toBe(true);
  });

  it("POST /threads/:id/close refuses a foreign source (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, { path: "/api/internal/threads/t-other/close", method: "POST" });
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /attach-file refuses a foreign source (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, {
      path: "/api/internal/attach-file",
      method: "POST",
      body: { path: "/home/cua/workspace/a.txt" },
    });
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /vm-exec refuses a foreign source (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, {
      path: "/api/internal/vm-exec",
      method: "POST",
      body: { command: "true" },
    });
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /vm-exec surfaces an expired capability as 401", async () => {
    const route = createInternalSessionsRoutes(baseDeps({
      attachmentVm: async () => ({ workspaceDir: "/tmp/vm" }),
      requireActive: () => {
        throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      },
    }));
    const { sent, out } = await call(route, {
      path: "/api/internal/vm-exec",
      method: "POST",
      body: { command: "true" },
    });
    expect(out).toBeUndefined();
    expect(sent).toEqual([{ status: 401, body: { error: "the internal turn capability has expired" } }]);
  });

  it("POST /vm-exec runs a command when a Local VM is claimed (happy)", async () => {
    const exec = vi.fn(async () => ({ stdout: "hi", exitCode: 0 }));
    const route = createInternalSessionsRoutes(baseDeps({
      attachmentVm: async () => ({ workspaceDir: "/tmp/vm" }),
      containerExec: exec,
    }));
    const { sent } = await call(route, {
      path: "/api/internal/vm-exec",
      method: "POST",
      body: { command: "printf hi" },
    });
    expect(sent).toEqual([{ status: 200, body: { stdout: "hi", exitCode: 0 } }]);
    expect(exec).toHaveBeenCalledOnce();
  });

  it("GET /rooms refuses a foreign source (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, { path: "/api/internal/rooms", method: "GET" });
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("GET /rooms lists postable rooms (happy)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({
      groups: () => [{
        id: "g1",
        name: "Ops",
        memberIds: [BOT.id],
        threadId: "t-room",
      }],
    }));
    const { sent } = await call(route, { path: "/api/internal/rooms", method: "GET" });
    expect(sent[0]!.status).toBe(200);
    expect(sent[0]!.body).toEqual({
      rooms: [{ id: "g1", name: "Ops", members: ["Ledger"] }],
      unpostable: [],
    });
  });

  it("GET /session-search refuses an unknown sender (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/session-search",
      method: "GET",
      query: "fromBotId=nope&q=hello",
    });
    expect(sent).toEqual([{ status: 403, body: { error: "unknown sender" } }]);
  });

  it("GET /session-search refuses a foreign source (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, {
      path: "/api/internal/session-search",
      method: "GET",
      query: `fromBotId=${BOT.id}&q=hello`,
    });
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("GET /session-read refuses an unknown sender (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/session-read",
      method: "GET",
      query: "fromBotId=nope&threadId=t-1&messageId=m1",
    });
    expect(sent).toEqual([{ status: 403, body: { error: "unknown sender" } }]);
  });

  it("GET /skills refuses a foreign source (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({ ownsThread: () => null }));
    const { sent } = await call(route, { path: "/api/internal/skills", method: "GET" });
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("GET /skills returns the discovery page (happy)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({
      scopedSkillInventory: () => ({
        rows: [{
          id: "bot:file-expense",
          name: "file-expense",
          kind: "skill" as const,
          scope: "bot" as const,
          source: "bot",
          enabled: true,
          description: "Files an expense",
        }],
        incomplete: false,
      }),
    }));
    const { sent } = await call(route, { path: "/api/internal/skills", method: "GET", query: "query=&offset=0" });
    expect(sent[0]!.status).toBe(200);
    const body = sent[0]!.body as { skills?: unknown; incomplete: boolean; staged: unknown[] };
    expect(body.incomplete).toBe(false);
    expect(Array.isArray(body.staged)).toBe(true);
  });

  it("POST /skills/stage refuses when skill authoring is off (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps({
      personalFeatureOn: () => false,
    }));
    const { sent } = await call(route, {
      path: "/api/internal/skills/stage",
      method: "POST",
      body: { action: "create", skill_md: "---\nname: x\n---\n", source: "conversation" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1", skillAuthoring: true },
    });
    expect(sent).toEqual([{ status: 403, body: { error: "skill authoring is not enabled in Settings" } }]);
  });

  it("POST /skills/stage refuses when the turn has no skillAuthoring grant (403)", async () => {
    const route = createInternalSessionsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/skills/stage",
      method: "POST",
      body: { action: "create", skill_md: "---\nname: x\n---\n", source: "conversation" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1", skillAuthoring: false },
    });
    expect(sent).toEqual([{ status: 403, body: { error: "skill authoring is not enabled for this turn" } }]);
  });
});
