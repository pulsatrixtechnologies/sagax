// Characterization of the B3 bots-messages routes moved out of server/index.ts
// (#1388): browser live/action and messages(/guarded), queue, edit, respond,
// interrupt. Auth gate already ran; fake deps cover PASS, refusals, and
// happy paths.
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createBotsMessagesRoutes,
  type BotsMessagesRouteDeps,
} from "./bots-messages.ts";
import { PASS, type RouteContext } from "./table.ts";

type Sent = { status: number; body: unknown };

const bot = {
  id: "b1",
  name: "Ada",
  threadId: "t1",
  browser: true,
  browserProfile: undefined,
  busy: false,
  ownerUserId: "pr_owner",
} as const;

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

function baseDeps(over: Partial<BotsMessagesRouteDeps> = {}): BotsMessagesRouteDeps {
  return {
    store: {
      bot: (id: string) => (id === "b1" ? { ...bot } : null),
      bots: [{ ...bot }],
      botByThread: (tid: string) => (tid === "t1" ? { ...bot } : null),
      groupByThread: () => null,
      messagesFor: () => [],
      appendMessage: (_t: string, message: Record<string, unknown>) => ({ id: "m1", ...message }),
      activeLeaf: () => null,
      patchMessage: () => ({ id: "m1" }),
      projectBotForTask: () => ({ ...bot }),
      taskByThread: () => ({ threadId: "t1", title: "Chat" }),
    },
    cfg: { profile: { name: "Ann" }, features: { browser: true } },
    IDENTITY: { kind: "solo" },
    HOSTED_WORKSPACE: false,
    DESKTOP_MANAGED: false,
    workspaceAccess: null,
    sessions: { isLive: () => true },
    viewerBotLevel: () => "owner",
    orgAdminCaller: () => false,
    browserIntegration: vi.fn(async () => null),
    browserLive: { open: vi.fn(), action: vi.fn() },
    currentBrowserSession: () => "sess-1",
    requirePinnedClientThread: () => undefined,
    startTurn: vi.fn(),
    startOrQueueDirectMessage: vi.fn(async () => ({ status: 200, body: { ok: true } })),
    startParallelTask: vi.fn(),
    startDuplexCallTurn: vi.fn(),
    stopDirectThreadByPerson: vi.fn(async () => undefined),
    stopParallelTask: vi.fn(async () => ({ ok: true })),
    threadBusy: () => false,
    requestedTaskBot: () => ({ ...bot }),
    messageSender: () => undefined,
    actorPrincipalId: () => "pr_owner",
    misuseActor: () => ({ triage: false }),
    usageTriggerFor: () => undefined,
    sendSequencer: { run: async (_k: string, _f: string, work: () => Promise<unknown>) => work() },
    guardedSendSchema: { safeParse: () => ({ success: false }) },
    liveTurnByThread: { get: () => undefined },
    liveVoiceUtteranceByThread: { get: () => undefined },
    voiceCalls: { claimUtterance: () => null },
    routines: null,
    routableSteers: { forgetThread: () => undefined },
    drainQueuedSends: () => undefined,
    noteStreamSend: () => undefined,
    ...over,
  };
}

function call(
  deps: BotsMessagesRouteDeps,
  opts: { method?: string; path?: string; auth?: RequestAuth; body?: unknown; query?: string } = {},
) {
  const sent: Sent[] = [];
  const path = opts.path ?? "/api/bots/b1/messages";
  const url = new URL(`http://x${path}${opts.query ? `?${opts.query}` : ""}`);
  const route = createBotsMessagesRoutes(deps);
  return (async () => {
    const out = await route({
      req: { headers: {}, socket: { setTimeout: () => undefined } } as unknown as IncomingMessage,
      res: {
        setHeader: () => undefined,
        headersSent: false,
        writableEnded: false,
      } as unknown as ServerResponse,
      url,
      path: url.pathname,
      method: opts.method ?? "POST",
      auth: opts.auth ?? sessionOwner,
      json: ((_r, status, body) => { sent.push({ status, body }); }) as RouteContext["json"],
      readBody: (async () => opts.body ?? { text: "hi", threadId: "t1" }) as RouteContext["readBody"],
    });
    return { out, sent: sent[0] };
  })();
}

describe("createBotsMessagesRoutes", () => {
  it("returns PASS for foreign paths", async () => {
    const deps = baseDeps();
    expect((await call(deps, { path: "/api/search" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/threads/t1/files" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/threads/t1/events" })).out).toBe(PASS);
    expect((await call(deps, { path: "/api/events" })).out).toBe(PASS);
  });

  it("returns PASS for other bot routes it does not own", async () => {
    const result = await call(baseDeps(), { path: "/api/bots/b1/profile", method: "PATCH" });
    expect(result.out).toBe(PASS);
    expect(result.sent).toBeUndefined();
  });

  it("404s browser live for an unknown bot", async () => {
    const result = await call(baseDeps(), {
      path: "/api/bots/missing/browser/live",
      method: "GET",
    });
    expect(result.sent?.status).toBe(404);
  });

  it("409s browser live when the bot browser is disabled", async () => {
    const deps = baseDeps({
      store: {
        ...baseDeps().store,
        bot: () => ({ ...bot, browser: false }),
      },
    });
    const result = await call(deps, { path: "/api/bots/b1/browser/live", method: "GET" });
    expect(result.sent?.status).toBe(409);
  });

  it("503s browser live when the engine is not installed", async () => {
    const deps = baseDeps({
      browserIntegration: vi.fn(async () => null),
    });
    const result = await call(deps, { path: "/api/bots/b1/browser/live", method: "GET" });
    expect(result.sent?.status).toBe(503);
  });

  it("404s messages for an unknown bot", async () => {
    const result = await call(baseDeps(), {
      path: "/api/bots/missing/messages",
      body: { text: "hi" },
    });
    expect(result.sent?.status).toBe(404);
  });
});
