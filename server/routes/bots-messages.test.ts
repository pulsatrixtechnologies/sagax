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
  describe("approval views in the human initiating chat", () => {
    function approvalDeps(over: Partial<BotsMessagesRouteDeps> = {}) {
      const sourceBot = { ...bot, id: "worker", threadId: "work", modelSelection: { instanceId: "claude", model: "fake" } };
      return baseDeps({
        originApprovals: { sourceFor: (threadId: string) => threadId === "t1" ? { threadId: "work", requestId: "request-1" } : null },
        store: { ...baseDeps().store, botByThread: (threadId: string) => threadId === "work" ? sourceBot : bot },
        botForThread: (_botId: string, threadId: string) => threadId === "work" ? sourceBot : bot,
        requestBehavior: (behavior: string) => behavior,
        stepUpGate: vi.fn(() => null), ruleManager: () => "pr_owner", stepUpAnswerOf: () => ({}),
        delegatedRequest: () => false, isConfidentialMemoryCard: () => false, isBotActCard: () => false,
        adminApprovalCheck: () => null, approvalAnswerRefusal: vi.fn(() => null), cardAnswerRefusal: () => null,
        saveOwnerRuleFromCard: vi.fn(() => null), answeringCardAs: async (_auth: unknown, _thread: string, _request: string, work: () => unknown) => work(),
        resolveAndSendTrust: () => false, resolveAndSendCwAction: () => false, resolveAndSendEmailDraft: () => false,
        resolveImessageCard: () => false, resolveAndSendMeeting: () => false, resolveAndSendPhoneCallConsent: () => false,
        answerRequest: vi.fn(async () => "allowed-once"),
        ...over,
      });
    }

    it.each(["/api/threads/t1/respond", "/api/bots/b1/respond"])("%s answers through the original owner, key, rule and engine checks", async path => {
      const deps = approvalDeps();
      const result = await call(deps, { path, body: { threadId: "t1", requestId: "view-1", behavior: "allow", rule: "allow", stepUp: "signed-key" } });
      expect(result.sent).toEqual({ status: 200, body: { ok: true, outcome: "allowed-once" } });
      expect(deps.stepUpGate).toHaveBeenCalledWith("pr_owner", "work", "request-1", "allow", {}, "signed-key");
      expect(deps.approvalAnswerRefusal).toHaveBeenCalledWith(sessionOwner, "work", "request-1");
      expect(deps.saveOwnerRuleFromCard).toHaveBeenCalledWith(sessionOwner, "work", "request-1", "allow", "allow", undefined);
      expect(deps.answerRequest).toHaveBeenCalledOnce();
      expect(deps.answerRequest).toHaveBeenCalledWith("work", "claude", "request-1", "allow", undefined, { id: "worker", name: "Ada" }, false, false);
    });

    it("a card in another chat never bypasses the source answerer or security key", async () => {
      const deps = approvalDeps({ approvalAnswerRefusal: () => "Only the original owner may answer." });
      const refused = await call(deps, { path: "/api/threads/t1/respond", body: { requestId: "request-1", behavior: "allow" } });
      expect(refused.sent?.status).toBe(403);
      expect(deps.saveOwnerRuleFromCard).not.toHaveBeenCalled();
      expect(deps.answerRequest).not.toHaveBeenCalled();
      deps.stepUpGate = () => ({ status: 403, body: { error: "A security key is required." } });
      const needsKey = await call(deps, { path: "/api/threads/t1/respond", body: { requestId: "request-1", behavior: "allow" } });
      expect(needsKey.sent).toEqual({ status: 403, body: { error: "A security key is required." } });
      expect(deps.answerRequest).not.toHaveBeenCalled();
    });

    it.each(["/api/threads/work/respond", "/api/bots/worker/respond"])("%s: a declined question is told in the person's language and never posted as their message (#2633, #2634)", async path => {
      const rows = [{ id: "q1", role: "bot", kind: "options", card: { requestId: "request-1", requestType: "question", title: "Your bot has a question", subtitle: "Quel créneau?", options: ["Lundi", "Mardi"] } }];
      const patched: Array<Record<string, unknown>> = [];
      const sourceBot = { ...bot, id: "worker", threadId: "work", modelSelection: { instanceId: "claude", model: "fake" } };
      const deps = approvalDeps({
        originApprovals: { sourceFor: () => null },
        store: {
          ...baseDeps().store,
          bot: (id: string) => (id === "worker" ? sourceBot : null),
          botByThread: () => sourceBot,
          messagesFor: () => rows,
          patchMessage: (_t: string, id: string, patch: { card: Record<string, unknown> }) => { patched.push({ id, ...patch.card }); rows[0]!.card = patch.card as never; return { id }; },
        },
        requestedTaskBot: () => sourceBot,
        answerRequest: vi.fn(async () => "unavailable"),
        deliverLateQuestionAnswer: vi.fn(async () => ({ queued: false })),
        questionDeclinedText: () => "La personne a refusé de répondre.",
        teamSetupApplyRefusal: () => null, cloudOwnerSession: () => null, commandRememberRefusal: () => null,
        resolveAndSendTeamSetup: () => false, resolveAndSendModel: () => false, resolveAndSendProfile: () => false, resolveAndSendRoutine: () => false, resolveAndSendRule: () => false,
        sendSkillResolution: () => false, resolveSkillRequest: () => null, routineActor: () => null, routineKeyReveal: () => false,
      });
      const result = await call(deps, { path, body: { threadId: "work", requestId: "request-1", behavior: "answer", message: "The person declined to answer this question from their AI client.", declined: true } });
      expect(result.sent).toEqual({ status: 200, body: { ok: true, outcome: "declined" } });
      expect(deps.answerRequest).toHaveBeenCalledWith("work", "claude", "request-1", "answer", "La personne a refusé de répondre.", expect.anything(), false, false);
      // never a message under the person's name, never a new turn
      expect(deps.deliverLateQuestionAnswer).not.toHaveBeenCalled();
      expect(patched).toEqual([expect.objectContaining({ id: "q1", answered: "deny", dismissed: true })]);
      // a second decline finds the card closed
      const again = await call(deps, { path, body: { threadId: "work", requestId: "request-1", behavior: "answer", declined: true } });
      expect(again.sent?.status).toBe(409);
    });

    it("a settled or revoked view cannot save a rule or answer again", async () => {
      const deps = approvalDeps({ originApprovals: { sourceFor: () => false } });
      const result = await call(deps, { path: "/api/threads/t1/respond", body: { requestId: "request-1", behavior: "allow", rule: "allow" } });
      expect(result.sent?.status).toBe(409);
      expect(deps.saveOwnerRuleFromCard).not.toHaveBeenCalled();
      expect(deps.answerRequest).not.toHaveBeenCalled();
    });
  });

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
