import type { ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";

import type { RequestAuth } from "../auth/request-auth.ts";
import {
  createWebhooksRoutes,
  takePollerCredentials,
  WEBHOOK_SERVER_TARGET_ADMIN_ONLY,
  type WebhooksRouteDeps,
} from "./webhooks.ts";
import type { RouteContext } from "./table.ts";
import { PASS } from "./table.ts";

const member: RequestAuth = {
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
    principalId: "pr_member",
  } as never,
};

const hook = {
  id: "w1",
  botId: "b1",
  endpointId: "ep1",
  name: "Hook",
};

function deps(over: Partial<WebhooksRouteDeps> = {}): WebhooksRouteDeps {
  return {
    list: () => [hook as never],
    listAttempts: () => [{ webhookId: "w1", at: 1 } as never],
    create: () => ({ webhook: hook, secret: "sec", signingSecret: "sig" } as never),
    update: () => hook as never,
    remove: (id) => id === "w1",
    revealPendingToken: () => ({ webhook: hook, secret: "sec" } as never),
    test: () => ({ ok: true } as never),
    rotatePending: () => ({ webhook: hook } as never),
    rotateSecret: () => ({ webhook: hook, secret: "new" } as never),
    isPerspicax: () => false,
    channelViewerId: () => undefined,
    botVisible: () => true,
    webhookSeenBy: () => true,
    everything: () => true,
    orgAdmin: () => false,
    ingressStatus: () => ({ available: true, baseUrl: "http://127.0.0.1:8800" }),
    graphConnectorOptions: () => [],
    delegateRefusal: () => null,
    execTargetAdminOnly: () => false,
    adminOrDelegate: () => false,
    savePollerCredentials: () => undefined,
    isBotAct: () => false,
    ...over,
  };
}

function call(
  route: ReturnType<typeof createWebhooksRoutes>,
  over: Partial<RouteContext> & { body?: unknown; headers?: Record<string, string> } = {},
) {
  const sent: Array<{ status: number; body: unknown }> = [];
  const { body, headers, ...rest } = over;
  const path = rest.path ?? "/api/webhooks";
  const ctx: RouteContext = {
    req: { headers: headers ?? {} } as RouteContext["req"],
    res: {} as ServerResponse,
    url: new URL(`http://local${path}`),
    path,
    method: rest.method ?? "GET",
    auth: rest.auth ?? member,
    json: ((_res, status, out) => {
      sent.push({ status, body: out });
    }) as RouteContext["json"],
    readBody: async () => body ?? {},
    ...rest,
  };
  return { ctx, sent, run: () => route(ctx) };
}

describe("takePollerCredentials", () => {
  it("passes the body through when no pollerCredentials", () => {
    expect(takePollerCredentials({ name: "x" })).toEqual({ rest: { name: "x" } });
  });
});

describe("createWebhooksRoutes", () => {
  it("PASS for foreign paths", async () => {
    const route = createWebhooksRoutes(deps());
    expect(await route(call(route, { path: "/api/routines" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/calendar-calls" }).ctx)).toBe(PASS);
    expect(await route(call(route, { path: "/api/bots" }).ctx)).toBe(PASS);
  });

  it("GET /api/webhooks lists visible hooks", async () => {
    const route = createWebhooksRoutes(deps());
    const { sent, run } = call(route, { path: "/api/webhooks" });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({
      webhooks: [hook],
      attempts: [{ webhookId: "w1", at: 1 }],
      ingress: { available: true },
    });
  });

  it("POST /api/webhooks refuses when delegateRefusal says so", async () => {
    const route = createWebhooksRoutes(deps({
      delegateRefusal: () => ({ status: 403, error: "no", code: "target_is_admin" }),
    }));
    const { sent, run } = call(route, { path: "/api/webhooks", method: "POST", body: { botId: "b1" } });
    await run();
    expect(sent[0]).toEqual({ status: 403, body: { error: "no", code: "target_is_admin" } });
  });

  it("POST /api/webhooks refuses server exec target without admin", async () => {
    const route = createWebhooksRoutes(deps({
      execTargetAdminOnly: () => true,
      adminOrDelegate: () => false,
    }));
    const { sent, run } = call(route, {
      path: "/api/webhooks",
      method: "POST",
      body: { botId: "b1", runOn: "server" },
    });
    await run();
    expect(sent[0]).toEqual({ status: 403, body: WEBHOOK_SERVER_TARGET_ADMIN_ONLY });
  });

  it("POST /api/webhooks creates and returns credential", async () => {
    const create = vi.fn(() => ({ webhook: hook, secret: "sec" } as never));
    const route = createWebhooksRoutes(deps({ create }));
    const { sent, run } = call(route, { path: "/api/webhooks", method: "POST", body: { botId: "b1" } });
    await run();
    expect(create).toHaveBeenCalled();
    expect(sent[0]?.status).toBe(201);
    expect(sent[0]?.body).toMatchObject({
      webhook: hook,
      credential: expect.objectContaining({ token: "sec" }),
    });
  });

  it("POST /api/webhooks/:id/reveal returns credential", async () => {
    const route = createWebhooksRoutes(deps());
    const { sent, run } = call(route, { path: "/api/webhooks/w1/reveal", method: "POST" });
    await run();
    expect(sent[0]?.status).toBe(200);
    expect(sent[0]?.body).toMatchObject({
      webhook: hook,
      credential: expect.objectContaining({ token: "sec" }),
    });
  });

  it("DELETE /api/webhooks/:id happy path", async () => {
    const route = createWebhooksRoutes(deps());
    const { sent, run } = call(route, { path: "/api/webhooks/w1", method: "DELETE" });
    await run();
    expect(sent[0]).toEqual({ status: 200, body: { ok: true } });
  });

  it("DELETE /api/webhooks/:id refuses when delegateRefusal says so", async () => {
    const route = createWebhooksRoutes(deps({
      delegateRefusal: () => ({ status: 404, error: "no such webhook", code: "no_such_webhook" }),
    }));
    const { sent, run } = call(route, { path: "/api/webhooks/w1", method: "DELETE" });
    await run();
    expect(sent[0]).toEqual({ status: 404, body: { error: "no such webhook", code: "no_such_webhook" } });
  });
});
