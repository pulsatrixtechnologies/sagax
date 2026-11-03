// Characterization of the P3 search route moved out of server/index.ts
// (#1388): GET /api/search. Auth gate already ran; these tests cover PASS,
// conversation refusals, re-auth after the scan, and the happy path.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { SearchHit } from "../messages/message-search-query.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { createSearchRoutes, type SearchRouteDeps } from "./search.ts";
import { PASS, type RouteContext } from "./table.ts";

type Sent = { status: number; body: unknown };

const HIT: SearchHit = {
  threadId: "t-1",
  messageId: "m-1",
  at: 1,
  role: "user",
  kind: "text",
  snippet: "hello world",
  matchStart: 0,
  matchLength: 5,
};

function baseDeps(over: Partial<SearchRouteDeps> = {}): SearchRouteDeps {
  const authOk = { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth;
  return {
    botByThread: (id) => (id === "t-1" ? { id: "bot-1", name: "Ledger" } : undefined),
    groupByThread: () => undefined,
    taskByThread: () => ({ title: "Books" }),
    groupTaskByThread: () => undefined,
    activePath: () => [{ id: "m-1" }],
    messagesFor: () => [{ id: "m-1" }],
    visibleFor: () => ({ everything: true, thread: () => true }),
    viewerId: () => undefined,
    privateThreads: () => false,
    searchMessages: vi.fn(async () => [HIT]),
    resolveAuth: () => ({ auth: authOk, status: 200, error: "" }),
    visibleNow: () => ({ everything: true, thread: () => true }),
    channelFilterViewerId: () => undefined,
    hitVisibleNow: () => true,
    privateRowHidden: () => false,
    viewerForApproval: () => ({ id: "pr_local" }),
    ...over,
  };
}

function call(
  deps: SearchRouteDeps,
  opts: { method?: string; path?: string; query?: string; auth?: RequestAuth } = {},
) {
  const sent: Sent[] = [];
  const path = opts.path ?? "/api/search";
  const url = new URL(`http://x${path}${opts.query ? `?${opts.query}` : ""}`);
  const route = createSearchRoutes(deps);
  return (async () => {
    const out = await route({
      req: { headers: {} } as IncomingMessage,
      res: {} as ServerResponse,
      url,
      path: url.pathname,
      method: opts.method ?? "GET",
      auth: opts.auth ?? { kind: "loopback", scopes: ["admin", "client"] } as RequestAuth,
      json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: (async () => ({})) as RouteContext["readBody"],
    });
    return { out, sent: sent[0] };
  })();
}

describe("createSearchRoutes", () => {
  it("returns PASS for foreign paths and methods", async () => {
    const deps = baseDeps();
    expect((await call(deps, { path: "/api/attachments" })).out).toBe(PASS);
    expect((await call(deps, { method: "POST", query: "q=hi" })).out).toBe(PASS);
  });

  it("404s an unknown or invisible threadId before scanning", async () => {
    const searchMessages = vi.fn(async () => [HIT]);
    const missing = await call(baseDeps({ searchMessages }), { query: "q=hi&threadId=missing" });
    expect(missing.sent).toEqual({ status: 404, body: { error: "no such conversation" } });
    expect(searchMessages).not.toHaveBeenCalled();

    const hidden = await call(baseDeps({
      searchMessages,
      visibleFor: () => ({ everything: false, thread: () => false }),
    }), { query: "q=hi&threadId=t-1" });
    expect(hidden.sent).toEqual({ status: 404, body: { error: "no such conversation" } });
    expect(searchMessages).not.toHaveBeenCalled();
  });

  it("refuses when re-auth after the scan fails", async () => {
    const deps = baseDeps({
      resolveAuth: () => ({ auth: null, status: 401, error: "session ended" }),
    });
    const result = await call(deps, { query: "q=hello" });
    expect(result.sent).toEqual({ status: 401, body: { error: "session ended" } });
  });

  it("refuses when workspace authorization fails after the scan", async () => {
    const deps = baseDeps({
      authorizeWorkspace: async () => ({ status: 503, error: "Workspace sign-in is unavailable." }),
    });
    const result = await call(deps, {
      query: "q=hello",
      auth: { kind: "session", scopes: ["client"], session: { id: "s1", scopes: ["client"] }, via: "cookie" } as unknown as RequestAuth,
    });
    expect(result.sent).toEqual({ status: 503, body: { error: "Workspace sign-in is unavailable." } });
  });

  it("returns enriched hits on the happy path", async () => {
    const deps = baseDeps();
    const result = await call(deps, { query: "q=hello&limit=10" });
    expect(result.sent?.status).toBe(200);
    expect(result.sent?.body).toEqual({
      hits: [{
        ...HIT,
        botId: "bot-1",
        name: "Ledger",
        task: "Books",
        onActivePath: true,
      }],
    });
    expect(deps.searchMessages).toHaveBeenCalledWith("hello", 10, undefined);
  });

  it("drops hits the viewer may not see after re-auth", async () => {
    const deps = baseDeps({
      hitVisibleNow: () => false,
    });
    const result = await call(deps, { query: "q=hello" });
    expect(result.sent).toEqual({ status: 200, body: { hits: [] } });
  });

  it("404s when the scoped thread is gone after re-auth", async () => {
    const deps = baseDeps({
      visibleNow: () => ({ everything: true, thread: () => false }),
    });
    const result = await call(deps, { query: "q=hello&threadId=t-1" });
    expect(result.sent).toEqual({ status: 404, body: { error: "no such conversation" } });
  });
});
