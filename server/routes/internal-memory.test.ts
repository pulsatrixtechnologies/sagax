import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  createInternalMemoryRoutes,
  type InternalMemoryBot,
  type InternalMemoryDeps,
} from "./internal-memory.ts";
import type { InternalRouteContext } from "./internal-route.ts";
import { PASS } from "./table.ts";

const bot: InternalMemoryBot = {
  id: "bot-1",
  name: "Ada",
  color: "blue",
  threadId: "t-main",
  memoryEnabled: true,
};

function deps(over: Partial<InternalMemoryDeps> = {}): InternalMemoryDeps {
  return {
    bot: (id) => (id === bot.id ? bot : null),
    botByThread: () => bot,
    groupByThread: () => null,
    taskByThread: () => null,
    isConfidentialThread: () => false,
    ownsThread: (botId, threadId) => botId === bot.id && threadId === "t-1",
    requireActive: () => undefined,
    ingestHook: () => ({ ok: true }),
    saveToolResult: () => ({ id: "r-00000000-0000-4000-8000-000000000001", length: 3 }),
    readToolResult: () => ({ id: "r-1", text: "hi" }),
    checkWidget: async () => ({ status: 200, body: { ok: true } }),
    createCard: () => ({ ok: true, messageId: "m1" }),
    authored: () => undefined,
    proposePublishedPage: () => ({ ok: true, page: { id: "p1" }, version: { n: 1 } }),
    getPage: () => null,
    replyPage: () => ({ ok: true }),
    resolvePageThread: () => ({ ok: true }),
    markBotRead: () => undefined,
    pageChanged: () => undefined,
    pageThreadName: () => "Ada",
    isPerspicax: () => false,
    botOwner: () => "owner",
    groupMemoryWritable: () => true,
    memorySource: () => "thread t-1",
    voiceCallActive: () => false,
    botReaction: () => ({ ok: true, messageId: "m1", emoji: "👍", changed: true }),
    recordPlacedReaction: () => undefined,
    roomFeedsBot: () => true,
    turnSpeaker: () => undefined,
    localPrincipalId: () => "local",
    skillsLibraryEnabled: () => false,
    personalSkillInputs: () => [],
    resolvedLibrarySkill: () => null,
    scopedPluginFolders: () => [],
    personalSkillsRoot: () => undefined,
    readWorkspaceText: () => ({ path: "RULES.md", text: "hi", bytes: 2, offset: 0, nextOffset: null }),
    updateGroupMemory: () => ({ ok: true as const }),
    updateMemory: () => ({ ok: true as const }),
    appendMemoryLog: () => ({ ok: true as const }),
    updateRules: () => ({ ok: true as const, path: "RULES.md" }),
    updateDoc: () => ({ ok: true as const, path: "docs/a.md" }),
    searchDocs: () => [{ path: "docs/a.md", line: 1, text: "hit" }],
    markWorkspaceUse: () => undefined,
    proposeTeamMemory: () => ({ entry: { id: "e1", kind: "term", name: "VPN", detail: "corp", aliases: [] } }),
    appendMessage: () => ({ id: "card-1" }),
    appendDecision: () => undefined,
    notify: () => undefined,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createInternalMemoryRoutes>,
  over: Partial<InternalRouteContext> & { body?: Record<string, unknown> } = {},
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const { body, ...rest } = over;
  const ctx: InternalRouteContext = {
    res: {} as ServerResponse,
    path: "/api/internal/memory",
    method: "POST",
    url: new URL("http://local/api/internal/memory"),
    json: ((_res, status, out) => { sent.push({ status, body: out }); }) as InternalRouteContext["json"],
    capability: { botId: "bot-1", threadId: "t-1", generation: "g-1" },
    readBody: async () => body ?? {},
    ...rest,
  };
  return { ctx, sent, run: () => route(ctx) };
}

describe("createInternalMemoryRoutes", () => {
  it("passes foreign paths and methods", async () => {
    const route = createInternalMemoryRoutes(deps());
    expect(await route(call(route, { path: "/api/internal/browser/mcp" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/memory", method: "GET" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/internal/agents" }).ctx)).toBe(PASS);
  });

  it("POST /api/internal/hook returns the ingest result", async () => {
    const ingestHook = vi.fn(() => ({ ok: true, ignored: "x" }));
    const route = createInternalMemoryRoutes(deps({ ingestHook }));
    const { sent, run } = call(route, { path: "/api/internal/hook", body: { event: "PostToolUse" } });
    await run();
    expect(ingestHook).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ status: 200, body: { ok: true, ignored: "x" } }]);
  });

  it("POST /api/internal/tool-result validates and saves", async () => {
    const saveToolResult = vi.fn(() => ({ id: "r-1" }));
    const route = createInternalMemoryRoutes(deps({ saveToolResult }));
    const bad = call(route, { path: "/api/internal/tool-result", body: {} });
    await bad.run();
    expect(bad.sent[0]?.status).toBe(400);
    const ok = call(route, { path: "/api/internal/tool-result", body: { text: "out" } });
    await ok.run();
    expect(saveToolResult).toHaveBeenCalledOnce();
    expect(ok.sent[0]?.status).toBe(201);
  });

  it("GET /api/internal/tool-result reads by id", async () => {
    const readToolResult = vi.fn(() => ({ text: "chunk" }));
    const route = createInternalMemoryRoutes(deps({ readToolResult }));
    const bad = call(route, {
      path: "/api/internal/tool-result",
      method: "GET",
      url: new URL("http://local/api/internal/tool-result?id=bad&offset=0"),
    });
    await bad.run();
    expect(bad.sent[0]?.status).toBe(400);
    const id = "r-00000000-0000-4000-8000-000000000001";
    const ok = call(route, {
      path: "/api/internal/tool-result",
      method: "GET",
      url: new URL(`http://local/api/internal/tool-result?id=${id}&offset=0`),
    });
    await ok.run();
    expect(ok.sent[0]).toEqual({ status: 200, body: { text: "chunk" } });
  });

  it("POST /api/internal/widget-check requires an active turn (401)", async () => {
    const route = createInternalMemoryRoutes(deps({
      requireActive: () => { throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 }); },
    }));
    const { run } = call(route, { path: "/api/internal/widget-check", body: {} });
    await expect(run()).rejects.toMatchObject({ status: 401 });
  });

  it("POST /api/internal/options-card refuses a foreign conversation (403)", async () => {
    const route = createInternalMemoryRoutes(deps({ ownsThread: () => false }));
    const { sent, run } = call(route, { path: "/api/internal/options-card", body: { tool: "show_widget" } });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "source conversation does not belong to sender" } }]);
  });

  it("POST /api/internal/options-card happy path", async () => {
    const createCard = vi.fn(() => ({ ok: true as const, messageId: "m-card" }));
    const route = createInternalMemoryRoutes(deps({ createCard }));
    const { sent, run } = call(route, { path: "/api/internal/options-card", body: { title: "Pick", options: ["A"] } });
    await run();
    expect(createCard).toHaveBeenCalledOnce();
    expect(sent).toEqual([{ status: 201, body: { messageId: "m-card" } }]);
  });

  it("POST /api/internal/page-comments refuses rooms (409)", async () => {
    const route = createInternalMemoryRoutes(deps({
      groupByThread: () => ({ id: "g1", name: "Room", memberIds: ["bot-1"] }),
    }));
    const { sent, run } = call(route, { path: "/api/internal/page-comments", body: { action: "list", page_id: "p1" } });
    await run();
    expect(sent[0]?.status).toBe(409);
  });

  it("POST /api/internal/group-memory refuses when not writable (403)", async () => {
    const route = createInternalMemoryRoutes(deps({
      groupByThread: () => ({ id: "g1", name: "Room", memberIds: ["bot-1"] }),
      groupMemoryWritable: () => false,
    }));
    const { sent, run } = call(route, { path: "/api/internal/group-memory", body: { action: "append", text: "note" } });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("POST /api/internal/reaction happy path records a placed reaction", async () => {
    const recordPlacedReaction = vi.fn();
    const capability = { botId: "bot-1", threadId: "t-1", generation: "g-1", reactions: 0 };
    const route = createInternalMemoryRoutes(deps({ recordPlacedReaction }));
    const { sent, run } = call(route, { path: "/api/internal/reaction", body: { emoji: "👍" }, capability });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(capability.reactions).toBe(1);
    expect(recordPlacedReaction).toHaveBeenCalledOnce();
  });

  it("POST /api/internal/memory refuses when memory is disabled (403)", async () => {
    const route = createInternalMemoryRoutes(deps({
      bot: () => ({ ...bot, memoryEnabled: false }),
    }));
    const { sent, run } = call(route, { path: "/api/internal/memory", body: { action: "append", text: "x" } });
    await run();
    expect(sent).toEqual([{ status: 403, body: { error: "Memory is disabled for this bot." } }]);
  });

  it("POST /api/internal/memory happy path", async () => {
    const updateMemory = vi.fn(() => ({ ok: true as const, truncated: false, moved: [] }));
    const route = createInternalMemoryRoutes(deps({ updateMemory }));
    const { sent, run } = call(route, { path: "/api/internal/memory", body: { action: "append", text: "fact" } });
    await run();
    expect(updateMemory).toHaveBeenCalledOnce();
    expect(sent[0]?.status).toBe(200);
  });

  it("POST /api/internal/memory/log happy path", async () => {
    const appendMemoryLog = vi.fn(() => ({ ok: true as const, file: "f", line: "l" }));
    const route = createInternalMemoryRoutes(deps({ appendMemoryLog }));
    const { sent, run } = call(route, { path: "/api/internal/memory/log", body: { text: "logged" } });
    await run();
    expect(appendMemoryLog).toHaveBeenCalledOnce();
    expect(sent[0]?.status).toBe(200);
  });

  it("POST /api/internal/workspace/rules refuses a narrow room (403)", async () => {
    const route = createInternalMemoryRoutes(deps({
      groupByThread: () => ({ id: "g1", name: "Private", memberIds: ["bot-1"] }),
      roomFeedsBot: () => false,
    }));
    const { sent, run } = call(route, { path: "/api/internal/workspace/rules", body: { action: "append", text: "rule" } });
    await run();
    expect(sent[0]?.status).toBe(403);
  });

  it("GET /api/internal/workspace/read happy path", async () => {
    const readWorkspaceText = vi.fn(() => ({ path: "RULES.md", text: "ok", bytes: 2, offset: 0, nextOffset: null }));
    const markWorkspaceUse = vi.fn();
    const route = createInternalMemoryRoutes(deps({ readWorkspaceText, markWorkspaceUse }));
    const { sent, run } = call(route, {
      path: "/api/internal/workspace/read",
      method: "GET",
      url: new URL("http://local/api/internal/workspace/read?path=RULES.md"),
    });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(markWorkspaceUse).toHaveBeenCalledOnce();
  });

  it("GET /api/internal/workspace/search needs a query", async () => {
    const route = createInternalMemoryRoutes(deps());
    const { sent, run } = call(route, {
      path: "/api/internal/workspace/search",
      method: "GET",
      url: new URL("http://local/api/internal/workspace/search"),
    });
    await run();
    expect(sent[0]?.status).toBe(400);
  });

  it("POST /api/internal/team-memory refuses unknown sender (403)", async () => {
    const route = createInternalMemoryRoutes(deps({
      bot: (id) => (id === "bot-1" ? bot : null),
    }));
    const { sent, run } = call(route, {
      path: "/api/internal/team-memory",
      body: { fromBotId: "missing", fromThreadId: "t-1", kind: "term", name: "VPN", detail: "corp" },
    });
    await run();
    expect(sent[0]).toEqual({ status: 403, body: { error: "unknown sender" } });
  });

  it("POST /api/internal/team-memory happy path", async () => {
    const appendMessage = vi.fn(() => ({ id: "card-9" }));
    const notify = vi.fn();
    const route = createInternalMemoryRoutes(deps({ appendMessage, notify }));
    const { sent, run } = call(route, {
      path: "/api/internal/team-memory",
      body: { fromBotId: "bot-1", fromThreadId: "t-1", kind: "term", name: "VPN", detail: "corp network" },
    });
    await run();
    expect(sent[0]?.status).toBe(201);
    expect(appendMessage).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
  });
});
