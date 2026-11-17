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
    pageSource: () => null,
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
    setReplyNotify: () => undefined,
    roomFeedsBot: () => true,
    turnSpeaker: () => undefined,
    localPrincipalId: () => "local",
    skillsLibraryEnabled: () => false,
    personalSkillInputs: () => [],
    resolvedLibrarySkill: () => null,
    scopedPluginFolders: () => [],
    turnPluginFolders: () => [],
    personalSkillsRoot: () => undefined,
    readWorkspaceText: () => ({ path: "RULES.md", text: "hi", bytes: 2, offset: 0, nextOffset: null }),
    updateGroupMemory: () => ({ ok: true as const }),
    updateMemory: () => ({ ok: true as const }),
    appendMemoryLog: () => ({ ok: true as const }),
    updateRules: () => ({ ok: true as const, path: "RULES.md" }),
    updateDoc: () => ({ ok: true as const, path: "docs/a.md" }),
    searchDocs: () => [{ path: "docs/a.md", line: 1, text: "hit" }],
    markWorkspaceUse: () => undefined,
    saveTeamMemory: () => ({ entry: { id: "e1", kind: "term", name: "VPN", detail: "corp", aliases: [] } }),
    appendDecision: () => undefined,
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
  it("POST /api/internal/reply-notify silences this turn's reply, and a thread only when this bot opened it", async () => {
    const setReplyNotify = vi.fn();
    const taskByThread = vi.fn((_botId: string, threadId: string) => (threadId === "t-opened" ? { openedBy: { botId: "bot-1" } } : { openedBy: { botId: "other" } }));
    const route = createInternalMemoryRoutes(deps({ setReplyNotify, taskByThread } as Partial<InternalMemoryDeps>));
    const own = call(route, { path: "/api/internal/reply-notify", body: { notify: false } });
    await own.run();
    expect(own.sent).toEqual([{ status: 200, body: { ok: true, notify: false, threadId: "t-1" } }]);
    expect(setReplyNotify).toHaveBeenLastCalledWith("t-1", false, false);
    const opened = call(route, { path: "/api/internal/reply-notify", body: { notify: false, threadId: "t-opened", toBotId: "bot-2" } });
    await opened.run();
    expect(setReplyNotify).toHaveBeenLastCalledWith("t-opened", false, false);
    const foreign = call(route, { path: "/api/internal/reply-notify", body: { notify: false, threadId: "t-x", toBotId: "bot-2" } });
    await foreign.run();
    expect(foreign.sent[0]?.status).toBe(403);
    const bad = call(route, { path: "/api/internal/reply-notify", body: { notify: "no" } });
    await bad.run();
    expect(bad.sent[0]?.status).toBe(400);
    expect(setReplyNotify).toHaveBeenCalledTimes(2);
    // #2695: FYI waits for the person's next brief
    const fyi = call(route, { path: "/api/internal/reply-notify", body: { notify: false, fyi: true } });
    await fyi.run();
    expect(fyi.sent).toEqual([{ status: 200, body: { ok: true, notify: false, fyi: true, threadId: "t-1" } }]);
    expect(setReplyNotify).toHaveBeenLastCalledWith("t-1", false, true);
  });
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

  // #4475: the card tool's result reads what the card call returned: a bot
  // whose turn ends with its first card is told so (and to raise its other
  // items with wait false), never asked to call ask_choice again into a turn
  // that is already over
  it("POST /api/internal/options-card passes on what the card call says to the bot", async () => {
    const createCard = vi.fn(() => ({ ok: true as const, messageId: "m-card", turnEnds: true as const, holds: false as const, replaced: true as const, addressedTo: "Sam" }));
    const route = createInternalMemoryRoutes(deps({ createCard: createCard as unknown as InternalMemoryDeps["createCard"] }));
    const { sent, run } = call(route, { path: "/api/internal/options-card", body: { tool: "ask_choice", question: "Which?", options: ["A", "B"] } });
    await run();
    expect(sent).toEqual([{ status: 201, body: { messageId: "m-card", turnEnds: true, holds: false, replaced: true, addressedTo: "Sam" } }]);
  });

  describe("propose_page replace (#4099): the bot changes the selected words in place", () => {
    const source = "# Report\n\nClosed tickets, response times and backlog.\n\nClosed tickets again.\n";
    const page = { id: "page_12345678", botId: "bot-1", threadId: "t-1", versions: [{ n: 1 }, { n: 2 }] };
    const read = (n: number) => ({ version: { n, kind: "markdown" as const, title: "Report", bytes: 1, sha256: "x" }, content: source, offset: 0, nextOffset: null });
    function propose(replace: { quote: string; with: string }, over: Partial<InternalMemoryDeps> = {}, kind = "markdown") {
      const proposePublishedPage = vi.fn((_input: Parameters<InternalMemoryDeps["proposePublishedPage"]>[0]) => ({ ok: true as const, page: { id: page.id }, version: { n: 3 } }));
      let answer: unknown;
      const route = createInternalMemoryRoutes(deps({
        getPage: (id) => (id === page.id ? page : null),
        pageSource: vi.fn((_id: string, n: number) => read(n)),
        proposePublishedPage,
        createCard: ({ proposePage }) => {
          answer = proposePage({ pageId: page.id, title: "Report", kind, content: "", replace });
          return { ok: true, messageId: "m1" };
        },
        ...over,
      }));
      return { proposePublishedPage, route, answer: () => answer };
    }

    it("saves the latest version with the words replaced, the rest kept", async () => {
      const { route, proposePublishedPage, answer } = propose({ quote: "response times", with: "median response times" });
      await call(route, { path: "/api/internal/options-card", body: { tool: "propose_page" } }).run();
      expect(answer()).toMatchObject({ ok: true, pageId: page.id, version: 3 });
      expect(proposePublishedPage.mock.calls[0]![0]).toMatchObject({
        pageId: page.id, kind: "markdown",
        content: "# Report\n\nClosed tickets, median response times and backlog.\n\nClosed tickets again.\n",
      });
    });

    it("keeps the kind of the page it changes, whatever kind the bot sent", async () => {
      // a passage of a Markdown page never turns it into a deck, nor a deck into a document
      const { route, proposePublishedPage, answer } = propose({ quote: "response times", with: "median response times" }, {}, "slides");
      await call(route, { path: "/api/internal/options-card", body: {} }).run();
      expect(answer()).toMatchObject({ ok: true });
      expect(proposePublishedPage.mock.calls[0]![0]).toMatchObject({ kind: "markdown" });
    });

    it("refuses words not found, or found more than once, and says to send the whole page", async () => {
      const missing = propose({ quote: "no such words", with: "x" });
      await call(missing.route, { path: "/api/internal/options-card", body: {} }).run();
      expect(missing.answer()).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("whole page") });
      expect(missing.proposePublishedPage).not.toHaveBeenCalled();
      const twice = propose({ quote: "Closed tickets", with: "x" });
      await call(twice.route, { path: "/api/internal/options-card", body: {} }).run();
      expect(twice.answer()).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("more than once") });
      expect(twice.proposePublishedPage).not.toHaveBeenCalled();
    });

    it("never reads another person's page of the same bot: the 404 of propose, before any read", async () => {
      // Perspicax: one bot, several people; the page is person B's, in B's conversation
      const pageSource = vi.fn((_id: string, n: number) => read(n));
      const theirs = { ...page, threadId: "t-other", ownerId: "person-b" };
      for (const quote of ["no such words", "Closed tickets", "response times"]) {
        const other = propose({ quote, with: "x" }, {
          isPerspicax: () => true,
          taskByThread: () => ({ ownerPrincipalId: "person-a" }) as never,
          getPage: () => theirs,
          pageSource,
        });
        await call(other.route, { path: "/api/internal/options-card", body: {} }).run();
        expect(other.answer()).toEqual({ ok: false, status: 404, error: "page_id: no page of this conversation has that id. Leave it out to propose a new page." });
        expect(other.proposePublishedPage).not.toHaveBeenCalled();
      }
      expect(pageSource).not.toHaveBeenCalled();
      // the same person's page of this bot, opened from another topic, is revised
      const mine = propose({ quote: "response times", with: "x" }, {
        isPerspicax: () => true,
        taskByThread: () => ({ ownerPrincipalId: "person-b" }) as never,
        getPage: () => theirs,
      });
      await call(mine.route, { path: "/api/internal/options-card", body: {} }).run();
      expect(mine.answer()).toMatchObject({ ok: true });
    });

    it("reads only a page this bot may revise, and only Markdown or slides", async () => {
      const foreign = propose({ quote: "response times", with: "x" }, { getPage: () => ({ ...page, botId: "other", threadId: "t-other", ownerId: "someone" }) });
      await call(foreign.route, { path: "/api/internal/options-card", body: {} }).run();
      expect(foreign.answer()).toMatchObject({ ok: false, status: 404 });
      const html = propose({ quote: "response times", with: "x" }, { pageSource: (_id, n) => ({ ...read(n), version: { ...read(n).version, kind: "html" } }) });
      await call(html.route, { path: "/api/internal/options-card", body: {} }).run();
      expect(html.answer()).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("whole page") });
    });
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

  it("GET /api/internal/workspace/read reads the plugin folders of the turn (#4082)", async () => {
    const turnPlugins = [{ name: "helper", dir: "/copy/helper", scope: "organization" }];
    const turnPluginFolders = vi.fn(() => turnPlugins);
    const readWorkspaceText = vi.fn((_botId: string, path: string, _offset: number, _plugins: unknown) => ({ path, text: "ok", bytes: 2, offset: 0, nextOffset: null }));
    const route = createInternalMemoryRoutes(deps({ readWorkspaceText, turnPluginFolders }));
    const { sent, run } = call(route, {
      path: "/api/internal/workspace/read",
      method: "GET",
      url: new URL("http://local/api/internal/workspace/read?path=/workspace/sagax-plugins/helper/skills/tidy/SKILL.md"),
    });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(turnPluginFolders).toHaveBeenCalledWith(expect.objectContaining({ id: expect.any(String) }), expect.anything(), expect.any(String));
    expect(readWorkspaceText.mock.calls[0]?.[3]).toBe(turnPlugins);
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

  // #4439: the bot saves it itself, at once: no card, no notification, no wait
  it("POST /api/internal/team-memory saves the entry at once, with the bot that saved it and when, and raises no card", async () => {
    const appendMessage = vi.fn(() => ({ id: "card-9" }));
    const notify = vi.fn();
    const appendDecision = vi.fn();
    const saveTeamMemory = vi.fn((_section: string | undefined, entry: { kind: string; name: string; detail: string }, _meta: { botId: string; botName: string; threadId: string; at: number }) => ({ entry: { id: "e9", ...entry, aliases: [] as string[] } }));
    // what raised the card and its notification before #4439, watched so neither comes back
    const route = createInternalMemoryRoutes({ ...deps({ appendDecision, saveTeamMemory } as Partial<InternalMemoryDeps>), appendMessage, notify } as InternalMemoryDeps);
    const before = Date.now();
    const { sent, run } = call(route, {
      path: "/api/internal/team-memory",
      body: { fromBotId: "bot-1", fromThreadId: "t-1", kind: "term", name: "VPN", detail: "corp network" },
    });
    await run();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({ status: "saved", entryId: "e9" });
    expect(saveTeamMemory).toHaveBeenCalledOnce();
    const meta = saveTeamMemory.mock.calls[0]![2];
    expect(meta).toMatchObject({ botId: "bot-1", botName: bot.name, threadId: "t-1" });
    expect(meta.at).toBeGreaterThanOrEqual(before);
    expect(appendMessage).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(appendDecision).toHaveBeenCalledWith(expect.objectContaining({ tool: "save_team_memory", decision: "auto-approved", requestId: "e9" }));
  });
});
