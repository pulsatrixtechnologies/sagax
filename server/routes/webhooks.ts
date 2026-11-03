/**
 * Public webhook management routes (#1388 wave 2 P2): /api/webhooks*.
 *
 * Management stays on the app-only server. Deliveries land on the webhook-only
 * loopback listener. Registered in ROUTES after the auth gate. Never imports
 * server/index.ts.
 */
import type { RequestAuth } from "../auth/request-auth.ts";
import { pollerCredentialInputSchema } from "../triggers/trigger-poller-credentials.ts";
import { triggerSourceSetup, webhookCredential } from "../triggers/webhook-ingress.ts";
import { isRelaySource, type TriggerSourceType } from "../../shared/trigger-sources.ts";
import { BOT_ACT_ROUTE_HEADER } from "./remote-session-files.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** A webhook whose run target is the shared organization server: only an
 * admin (or a server.settings delegate) may create it. One on the bot's own
 * computer (This computer or its cloud computer) is the owner's own. */
export const WEBHOOK_SERVER_TARGET_ADMIN_ONLY = {
  error: "Only an organization admin can create a webhook that runs on the organization's server. A webhook on this bot's own computer needs no admin.",
  code: "server_target_admin_only",
} as const;

/** Pulls the write-only poller credential out of a webhook body. */
export function takePollerCredentials(body: unknown): { rest: unknown; credentials?: { password?: string; url?: string } } {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Object.hasOwn(body, "pollerCredentials")) {
    return { rest: body };
  }
  const { pollerCredentials, ...rest } = body as Record<string, unknown>;
  const parsed = pollerCredentialInputSchema.safeParse(pollerCredentials);
  if (!parsed.success) throw Object.assign(new Error("The poller password or link is not valid"), { status: 400 });
  return { rest, credentials: parsed.data };
}

export interface WebhooksRouteDeps {
  list(): Array<{ id: string; botId: string; endpointId: string; source?: { type?: string }; [key: string]: unknown }>;
  listAttempts(): Array<{ webhookId: string; [key: string]: unknown }>;
  create(input: unknown): {
    webhook: { id: string; botId: string; endpointId: string; source?: { type?: string }; [key: string]: unknown };
    secret: string;
    signingSecret?: string;
  };
  update(id: string, input: unknown): { id: string; botId: string; endpointId: string; [key: string]: unknown } | null;
  remove(id: string): boolean;
  revealPendingToken(id: string): {
    webhook: { id: string; botId: string; endpointId: string; source?: { type?: string }; [key: string]: unknown };
    secret: string;
  } | null;
  test(id: string, body: unknown): unknown | null;
  rotatePending(id: string): { webhook: { id: string; botId: string; endpointId: string; [key: string]: unknown } } | null;
  rotateSecret(id: string): {
    webhook: { id: string; botId: string; endpointId: string; source?: { type?: string }; [key: string]: unknown };
    secret: string;
  } | null;
  isPerspicax(): boolean;
  channelViewerId(auth: RequestAuth): string | undefined;
  botVisible(auth: RequestAuth, botId: string): boolean;
  webhookSeenBy(botId: unknown, viewerId: string): boolean;
  everything(auth: RequestAuth): boolean;
  orgAdmin(auth: RequestAuth): boolean;
  ingressStatus(): { available: boolean; baseUrl: string; error?: string };
  graphConnectorOptions(): unknown[];
  delegateRefusal(
    auth: RequestAuth,
    webhookIds: string[],
    body: unknown,
  ): { status: number; error: string; code: string } | null;
  execTargetAdminOnly(runOn: string | undefined): boolean;
  adminOrDelegate(auth: RequestAuth): boolean;
  savePollerCredentials(id: string, credentials: { password?: string; url?: string }): void;
  isBotAct(auth: RequestAuth): boolean;
}

export function createWebhooksRoutes(deps: WebhooksRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/webhooks")) return PASS;

    if (path === "/api/webhooks" && method === "GET") {
      const hookViewer = deps.isPerspicax() && auth.kind === "session" ? deps.channelViewerId(auth) : undefined;
      const shownHooks = deps.list().filter((webhook) =>
        deps.botVisible(auth, webhook.botId) && (!hookViewer || deps.webhookSeenBy(webhook.botId, hookViewer)));
      const shownIds = new Set(shownHooks.map((webhook) => webhook.id));
      return json(res, 200, {
        webhooks: shownHooks,
        attempts: deps.listAttempts().filter((attempt) =>
          (deps.everything(auth) && !hookViewer) || shownIds.has(attempt.webhookId)),
        ingress: deps.ingressStatus(),
        ...(deps.everything(auth) && (!hookViewer || deps.orgAdmin(auth))
          ? { graphConnectors: deps.graphConnectorOptions() }
          : {}),
      });
    }

    if (path === "/api/webhooks" && method === "POST") {
      const body = await readBody(req);
      const webhookRefused = deps.delegateRefusal(auth, [], body);
      if (webhookRefused) return json(res, webhookRefused.status, { error: webhookRefused.error, code: webhookRefused.code });
      const createRunOn = body && typeof body === "object" && !Array.isArray(body)
        ? (body as { runOn?: unknown }).runOn
        : undefined;
      if (deps.execTargetAdminOnly(typeof createRunOn === "string" ? createRunOn : undefined) && !deps.adminOrDelegate(auth)) {
        return json(res, 403, WEBHOOK_SERVER_TARGET_ADMIN_ONLY);
      }
      const taken = takePollerCredentials(body);
      const created = deps.create(taken.rest);
      if (taken.credentials) {
        try {
          deps.savePollerCredentials(created.webhook.id, taken.credentials);
        } catch (error) {
          deps.remove(created.webhook.id);
          throw error;
        }
      }
      const ingress = deps.ingressStatus();
      if (created.webhook.source) {
        if (created.webhook.source.type && isRelaySource(created.webhook.source.type as TriggerSourceType)) {
          return json(res, 201, { webhook: created.webhook, ingress });
        }
        return json(res, 201, {
          webhook: created.webhook,
          ingress,
          sourceSetup: triggerSourceSetup(ingress.baseUrl, created.webhook.endpointId, created.signingSecret),
        });
      }
      return json(res, 201, {
        webhook: created.webhook,
        ingress,
        credential: webhookCredential(ingress.baseUrl, created.webhook.endpointId, created.secret),
      });
    }

    let webhookMatch = path.match(/^\/api\/webhooks\/([\w-]+)\/(rotate|test|reveal)$/);
    if (webhookMatch && method === "POST") {
      const webhookRefused = deps.delegateRefusal(auth, [webhookMatch[1]!], null);
      if (webhookRefused) return json(res, webhookRefused.status, { error: webhookRefused.error, code: webhookRefused.code });
      if (webhookMatch[2] === "reveal") {
        const revealed = deps.revealPendingToken(webhookMatch[1]!);
        if (!revealed) return json(res, 404, { error: "no token to reveal" });
        const ingress = deps.ingressStatus();
        return json(res, 200, {
          webhook: revealed.webhook,
          ingress,
          credential: webhookCredential(ingress.baseUrl, revealed.webhook.endpointId, revealed.secret),
        });
      }
      if (webhookMatch[2] === "test") {
        const result = deps.test(webhookMatch[1]!, await readBody(req));
        return result ? json(res, 202, result) : json(res, 404, { error: "no such webhook" });
      }
      if (req.headers[BOT_ACT_ROUTE_HEADER] !== undefined || deps.isBotAct(auth)) {
        const kept = deps.rotatePending(webhookMatch[1]!);
        if (!kept) return json(res, 404, { error: "no such webhook" });
        return json(res, 200, { webhook: kept.webhook, ingress: deps.ingressStatus(), tokenWaiting: true });
      }
      const rotated = deps.rotateSecret(webhookMatch[1]!);
      if (!rotated) return json(res, 404, { error: "no such webhook" });
      const ingress = deps.ingressStatus();
      if (rotated.webhook.source) {
        return json(res, 200, {
          webhook: rotated.webhook,
          ingress,
          sourceSetup: triggerSourceSetup(ingress.baseUrl, rotated.webhook.endpointId, rotated.secret),
        });
      }
      return json(res, 200, {
        webhook: rotated.webhook,
        ingress,
        credential: webhookCredential(ingress.baseUrl, rotated.webhook.endpointId, rotated.secret),
      });
    }

    webhookMatch = path.match(/^\/api\/webhooks\/([\w-]+)$/);
    if (webhookMatch && method === "PATCH") {
      const body = await readBody(req);
      const webhookRefused = deps.delegateRefusal(auth, [webhookMatch[1]!], body);
      if (webhookRefused) return json(res, webhookRefused.status, { error: webhookRefused.error, code: webhookRefused.code });
      const patchRunOn = body && typeof body === "object" && !Array.isArray(body)
        ? (body as { runOn?: unknown }).runOn
        : undefined;
      if (typeof patchRunOn === "string" && deps.execTargetAdminOnly(patchRunOn) && !deps.adminOrDelegate(auth)) {
        return json(res, 403, WEBHOOK_SERVER_TARGET_ADMIN_ONLY);
      }
      const taken = takePollerCredentials(body);
      const webhook = deps.update(webhookMatch[1]!, taken.rest);
      if (!webhook) return json(res, 404, { error: "no such webhook" });
      if (taken.credentials) deps.savePollerCredentials(webhookMatch[1]!, taken.credentials);
      return json(res, 200, {
        webhook: deps.list().find((hook) => hook.id === webhookMatch![1]) ?? webhook,
      });
    }

    if (webhookMatch && method === "DELETE") {
      const webhookRefused = deps.delegateRefusal(auth, [webhookMatch[1]!], null);
      if (webhookRefused) return json(res, webhookRefused.status, { error: webhookRefused.error, code: webhookRefused.code });
      return deps.remove(webhookMatch[1]!)
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "no such webhook" });
    }

    return PASS;
  };
}
