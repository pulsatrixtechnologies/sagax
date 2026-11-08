// Characterization of the I1 internal environment routes moved out of
// server/index.ts (#1388): computer/select, browser/mcp, sandbox/mcp,
// personal-mcp, desktop/mcp, workplace/mcp, computer/mcp, messages/mcp,
// phone/claim, shared-computers, computer-control.
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import type { InternalRouteContext } from "./internal-route.ts";
import {
  createInternalEnvironmentsRoutes,
  type InternalEnvironmentsDeps,
} from "./internal-environments.ts";
import { PASS } from "./table.ts";

const BOT = {
  id: "bot-1",
  name: "Ada",
  color: "#111",
  threadId: "t-1",
  computer: "cloud" as const,
  browser: true as boolean | false,
  browserProfile: undefined as string | undefined,
  allowedRecipients: undefined as string[] | undefined,
  alwaysAllow: [] as string[],
};

function baseDeps(over: Partial<InternalEnvironmentsDeps> = {}): InternalEnvironmentsDeps {
  return {
    bot: (id) => (id === BOT.id ? { ...BOT } : undefined),
    projectBotForTask: (botId, threadId) => (botId === BOT.id && threadId === "t-1" ? { ...BOT } : undefined),
    isConfidentialThread: () => false,
    requireActive: () => undefined,
    isActive: () => true,
    isPerspicax: () => false,
    lendingEnabled: () => true,
    identityKind: () => "solo",
    platform: () => "darwin",
    dataDir: () => "/tmp/data",
    localPrincipalId: () => "pr_local",
    computerSelection: () => ({ generation: "g1", mounted: "cloud", selected: undefined, previousSurface: undefined }),
    selectionStillCurrent: () => true,
    setComputerSelected: (_threadId, _botId, _surface) => undefined,
    autoVmClaim: () => undefined,
    selectableComputers: async () => [{ surface: "cloud" as const, label: "Cloud", available: true, ready: true, canStart: true, canCreate: false }],
    computerPreviewSurface: async () => "cloud",
    builtInBrowserEnabled: () => true,
    effectiveBrowserProfile: (_botId, profile) => profile ?? undefined,
    myChromeUnavailable: () => null,
    myChromeNavigationRefusal: () => null,
    browserNavigationRefusal: () => null,
    browserIntegration: async () => ({ session: "sess-1", spec: {} }),
    currentBrowserSession: () => "sess-1",
    vaultPrincipalForThread: () => "pr_local",
    fillBrowserCredentials: () => undefined,
    claimTurnResource: () => true,
    browserAgentRpc: async () => ({ tools: [] }),
    myChromeMemory: () => ({}),
    myChromeTakeNotes: () => [],
    myChromeToolAllowed: () => true,
    runMyChromeTool: async () => ({ ok: true }),
    confirmHeldCard: async () => "allow" as const,
    sourceApprovalMode: () => "auto",
    userSandboxAvailable: () => true,
    smallTalkTurn: () => undefined,
    activePathLastUserId: () => undefined,
    stagePendingAttachments: async () => undefined,
    syncGithubForTurn: async () => undefined,
    syncPluginsForTurn: async () => undefined,
    sandboxControlHeld: () => false,
    autoComputerSelectionFor: () => null,
    autoComputerToolRefusal: () => null,
    handleUserSandboxMcp: async () => ({ content: [{ type: "text", text: "ok" }] }),
    saveToolResult: () => ({ id: "r-00000000-0000-4000-8000-000000000001" }),
    commandVariablesFor: () => ({}),
    withCommandVariables: (input) => input,
    userSandboxExec: async () => ({ stdout: "", exitCode: 0 }),
    userSandboxOverQuota: () => false,
    enginePluginCommandRefusal: () => null,
    misuseTextRefusal: () => null,
    misusePathRefusal: () => null,
    misuseToolFrameText: () => null,
    misuseRefusal: () => null,
    safetyPrincipal: () => ({ triage: false }),
    misuseActor: () => ({ triage: false }),
    safetyReviewer: () => undefined,
    safetyToolHold: async () => null,
    samePerson: (a, b) => Boolean(a && b && a === b),
    personalMcpServer: () => undefined,
    scopedPluginMcp: () => [],
    stdioRelay: async () => ({ ok: true }),
    desktopConnected: () => false,
    handleDesktopBridgeMcp: async () => ({ content: [{ type: "text", text: "ok" }] }),
    desktopBridgesRequest: async () => ({ ok: true }),
    bridgeAuditRecord: () => undefined,
    broadcast: () => undefined,
    turnWorkplace: () => undefined,
    setTurnWorkplaceAuto: () => undefined,
    appendAdminAction: () => undefined,
    auditBotTarget: (botId) => ({ kind: "bot", id: botId }),
    claimedBoatId: () => "box-1",
    computerCallGate: async () => ({ held: false, helpReason: null }),
    cloudComputerRpc: async () => ({ ok: true }),
    cloudComputerCfg: () => ({}),
    messagesUseMessages: () => false,
    standingGrantsAllowed: () => true,
    autoAnswerStepUp: () => [],
    imessageSender: {},
    handleMessagesMcp: async () => ({ result: "ok" }),
    appendMessage: () => ({ id: "msg-1" }),
    bindImessageMessage: () => undefined,
    workspaceDir: () => "/tmp/ws",
    taskWorkspacesDir: () => "/tmp/tasks",
    sharedComputerPrincipal: () => "pr_local",
    userComputerSpeaking: () => ({ speaker: { origin: "person", principalId: "pr_local" }, context: {} }),
    userComputersList: () => [],
    userComputersRequest: async () => ({ ok: true }),
    sharedComputersList: () => [{ id: "mac-1" }],
    sharedComputersRequest: async () => ({ ok: true }),
    readPersonalCopy: () => null,
    computerOff: () => false,
    gateChecked: () => undefined,
    requestHelpLease: () => ({ snapshot: { held: true, helpReason: "need hands" }, requestId: "req-1" }),
    expireHelp: () => ({ held: false, helpReason: null }),
    activeGroupTurnForBot: () => null,
    blockedTarget: (bot) => ({ threadId: bot.threadId ?? "t-1", group: undefined }),
    computerSelectionMove: () => undefined,
    taskSurfacePin: () => undefined,
    notify: () => undefined,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalEnvironmentsRoutes>,
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
  const res = {
    headersSent: false,
    writableEnded: false,
    once: () => undefined,
  } as unknown as ServerResponse;
  return (async () => {
    try {
      const out = await route({
        res,
        path: opts.path,
        method: opts.method ?? "POST",
        url,
        json: ((_res: ServerResponse, status: number, body: unknown) => {
          sent.push({ status, body });
        }) as InternalRouteContext["json"],
        capability: opts.capability ?? { botId: BOT.id, threadId: "t-1", generation: "g1", browserSession: "sess-1" },
        readBody: async () => opts.body ?? {},
      });
      return { out, sent };
    } catch (error) {
      const status = (error as { status?: number }).status;
      if (typeof status === "number") {
        sent.push({ status, body: { error: (error as Error).message } });
        return { out: undefined, sent };
      }
      throw error;
    }
  })();
}

describe("createInternalEnvironmentsRoutes", () => {
  it("passes foreign paths", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    expect((await call(route, { path: "/api/internal/routines", method: "GET" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/ask-bot", method: "POST" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/memory", method: "POST" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/bots", method: "GET" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/connectors/mcp", method: "POST" })).out).toBe(PASS);
  });

  it("passes when the capability bot is unknown", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({ bot: () => undefined }));
    expect((await call(route, { path: "/api/internal/phone/claim", method: "POST" })).out).toBe(PASS);
  });

  it("GET computer/select happy and POST 403 when selection unavailable", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({
      computerSelection: () => undefined,
    }));
    const get = await call(route, { path: "/api/internal/computer/select", method: "GET" });
    expect(get.out).toBeUndefined();
    expect(get.sent[0]?.status).toBe(200);

    const post = await call(route, {
      path: "/api/internal/computer/select",
      method: "POST",
      body: { surface: "cloud" },
    });
    expect(post.sent[0]).toEqual({
      status: 403,
      body: { error: "Computer selection is only available once per direct user request, with computer access enabled." },
    });
  });

  it("computer/select 403 when there is no project bot", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({
      projectBotForTask: () => undefined,
    }));
    const { sent } = await call(route, { path: "/api/internal/computer/select", method: "GET" });
    expect(sent[0]?.status).toBe(403);
  });

  it("browser/mcp 403 when browser tools are off", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({
      bot: () => ({ ...BOT, browser: false }),
    }));
    const { sent } = await call(route, { path: "/api/internal/browser/mcp", body: { method: "tools/list" } });
    expect(sent[0]).toEqual({ status: 403, body: { error: "browser tools are not enabled for this bot" } });
  });

  it("browser/mcp happy tools/list", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent, out } = await call(route, { path: "/api/internal/browser/mcp", body: { method: "tools/list" } });
    expect(out).toBeUndefined();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toEqual({ result: { tools: [] } });
  });

  it("sandbox/mcp 404 when no user sandbox", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({ userSandboxAvailable: () => false }));
    const { sent } = await call(route, { path: "/api/internal/sandbox/mcp", body: { method: "tools/list" } });
    expect(sent[0]).toEqual({ status: 404, body: { error: "unknown internal endpoint" } });
  });

  it("sandbox/mcp 403 when capability has no sandbox principal", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/sandbox/mcp",
      body: { method: "tools/list" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1" },
    });
    expect(sent[0]?.status).toBe(403);
  });

  it("sandbox/mcp happy tools/list", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/sandbox/mcp",
      body: { method: "tools/list" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1", sandboxPrincipalId: "pr_a" },
    });
    expect(sent[0]?.status).toBe(200);
  });

  it("personal-mcp 404 when not perspicax", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/personal-mcp", body: {} });
    expect(sent[0]).toEqual({ status: 404, body: { error: "unknown internal endpoint" } });
  });

  it("desktop/mcp 404 when not perspicax", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/desktop/mcp", body: { method: "tools/list" } });
    expect(sent[0]?.status).toBe(404);
  });

  it("desktop/mcp happy when perspicax", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({ isPerspicax: () => true }));
    const { sent } = await call(route, {
      path: "/api/internal/desktop/mcp",
      body: { method: "tools/list" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1", desktopPrincipalId: "pr_a" },
    });
    expect(sent[0]?.status).toBe(200);
  });

  it("workplace/mcp 404 when not perspicax", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/workplace/mcp", body: { method: "tools/list" } });
    expect(sent[0]?.status).toBe(404);
  });

  it("workplace/mcp lists computer_select when perspicax", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({ isPerspicax: () => true }));
    const { sent } = await call(route, { path: "/api/internal/workplace/mcp", body: { method: "tools/list" } });
    expect(sent[0]?.status).toBe(200);
    const body = sent[0]?.body as { result: { tools: Array<{ name: string }> } };
    expect(body.result.tools[0]?.name).toBeTruthy();
  });

  it("workplace/mcp counts each move and refuses a third one in the same turn (#2736)", async () => {
    let auto: Record<string, unknown> = { auto: true, selected: "cloud", routine: false, sandboxConfigured: true, desktopMounted: true, routinesAllowed: false, browserAvailable: true };
    const route = createInternalEnvironmentsRoutes(baseDeps({
      isPerspicax: () => true,
      turnWorkplace: () => ({ generation: "g1", decision: { principal: "pr_a" }, auto }) as never,
      setTurnWorkplaceAuto: (_thread: string, next: unknown) => { auto = next as Record<string, unknown>; },
      desktopConnected: () => true,
      appendAdminAction: () => undefined,
    } as never));
    const move = async (target: string) => {
      const { sent } = await call(route, { path: "/api/internal/workplace/mcp", body: { method: "tools/call", params: { name: "computer_select", arguments: { target } } } });
      return (sent[0]!.body as { result: { isError?: boolean; content: Array<{ text: string }> } }).result;
    };
    expect((await move("this_computer")).isError).toBeUndefined();
    expect((await move("cloud")).isError).toBeUndefined();
    expect(auto.switches).toBe(2);
    const third = await move("this_computer");
    expect(third.isError).toBe(true);
    expect(third.content[0]?.text).toContain("You already moved 2 times");
    expect(auto.selected).toBe("cloud");
  });

  it("computer/mcp 403 when turn has no cloud computer", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/computer/mcp",
      body: {},
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1" },
    });
    expect(sent[0]).toEqual({ status: 403, body: { error: "this turn has no cloud computer" } });
  });

  it("computer/mcp happy", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, {
      path: "/api/internal/computer/mcp",
      body: { method: "tools/list" },
      capability: { botId: BOT.id, threadId: "t-1", generation: "g1", boxId: "box-1" },
    });
    expect(sent[0]?.status).toBe(200);
  });

  it("messages/mcp happy", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/messages/mcp", body: { method: "tools/list" } });
    expect(sent[0]?.status).toBe(200);
  });

  it("phone/claim happy and 409 when resource held", async () => {
    const ok = createInternalEnvironmentsRoutes(baseDeps());
    expect((await call(ok, { path: "/api/internal/phone/claim" })).sent[0]).toEqual({
      status: 200,
      body: { claimed: true },
    });
    const busy = createInternalEnvironmentsRoutes(baseDeps({ claimTurnResource: () => false }));
    expect((await call(busy, { path: "/api/internal/phone/claim" })).sent[0]?.status).toBe(409);
  });

  it("shared-computers PASS when lending is off", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({ lendingEnabled: () => false }));
    expect((await call(route, { path: "/api/internal/shared-computers", method: "GET" })).out).toBe(PASS);
    expect((await call(route, { path: "/api/internal/shared-computers", method: "POST", body: {} })).out).toBe(PASS);
  });

  it("shared-computers GET happy", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/shared-computers", method: "GET" });
    expect(sent[0]).toEqual({ status: 200, body: { computers: [{ id: "mac-1" }] } });
  });

  it("shared-computers POST 400 on bad body", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/shared-computers", method: "POST", body: { action: "nope" } });
    expect(sent[0]?.status).toBe(400);
  });

  it("computer-control 404 when bot missing", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const { sent } = await call(route, { path: "/api/internal/computer-control", method: "GET", query: "botId=missing" });
    expect(sent[0]).toEqual({ status: 404, body: { error: "no such bot" } });
  });

  it("computer-control GET/POST/DELETE happy", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps());
    const get = await call(route, { path: "/api/internal/computer-control", method: "GET", query: "botId=bot-1" });
    expect(get.sent[0]?.status).toBe(200);
    const post = await call(route, {
      path: "/api/internal/computer-control",
      method: "POST",
      query: "botId=bot-1",
      body: { reason: "stuck" },
    });
    expect(post.sent[0]?.status).toBe(200);
    expect((post.sent[0]!.body as { requestId: string }).requestId).toBe("req-1");
    const del = await call(route, {
      path: "/api/internal/computer-control",
      method: "DELETE",
      query: "botId=bot-1",
      body: { requestId: "req-1" },
    });
    expect(del.sent[0]?.status).toBe(200);
  });

  it("surfaces 401 when requireActive throws", async () => {
    const route = createInternalEnvironmentsRoutes(baseDeps({
      requireActive: () => {
        throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      },
    }));
    const { sent } = await call(route, { path: "/api/internal/phone/claim" });
    expect(sent[0]?.status).toBe(401);
  });
});
