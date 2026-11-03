import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { z } from "zod";

import { parseJson, type JsonValue } from "../schema.ts";
import type { TriggerSourceSetup } from "../../shared/trigger-sources.ts";
import { handshakeBeforeAuth } from "./trigger-sources.ts";
import type { WebhookManager } from "./webhooks.ts";

export const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const statusErrorSchema = z.object({ status: z.number().int().optional() });
const serverAddressSchema = z.object({ port: z.number().int().min(1).max(65_535) });

export interface WebhookIngress {
  server: Server;
  host: string;
  port: number;
  baseUrl: string;
}

function json(res: ServerResponse, status: number, body: JsonValue): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > MAX_WEBHOOK_BODY_BYTES) {
        throw Object.assign(new Error("Webhook body is too large"), { status: 413 });
      }
      chunks.push(buffer);
    }
  } catch (error) {
    const parsed = statusErrorSchema.safeParse(error);
    if (parsed.success && parsed.data.status === 413) throw error;
    throw Object.assign(new Error("Could not read webhook body"), { status: 400 });
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

function parsePayload(raw: string, contentType: string): JsonValue {
  if (!raw) return {};
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    try {
      return parseJson(raw);
    } catch {
      throw Object.assign(new Error("Invalid JSON webhook body"), { status: 400 });
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return raw;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/** The only place a webhook token is read from. Never the URL (path or query)
 * and never the body: those end up in logs, proxies and chat history. */
function bearerToken(req: IncomingMessage): string {
  const match = (header(req, "authorization") ?? "").match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? "";
}

/** Failed authentications one bucket may take in the window before it is
 * answered 429 (even with a good token) until the window passes. */
export const WEBHOOK_AUTH_FAILURE_LIMIT = 10;
export const WEBHOOK_AUTH_FAILURE_WINDOW_MS = 60_000;

/** Failure counter per bucket. Both webhook paths key it by endpoint id
 * (`hook:<id>`, `source:<id>`), never by the caller's address: behind the
 * reverse proxy every sender has the same socket address, and a forwarded
 * header is attacker-controlled. Ids that name nothing share one bucket per
 * path, so made-up ids never grow the map and never block a real endpoint. */
export class AuthFailureLimiter {
  private failures = new Map<string, number[]>();
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  // No parameter properties: the server runs under node's strip-only type mode.
  constructor(limit = WEBHOOK_AUTH_FAILURE_LIMIT, windowMs = WEBHOOK_AUTH_FAILURE_WINDOW_MS, now: () => number = Date.now) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.now = now;
  }

  private recent(source: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const recent = (this.failures.get(source) ?? []).filter((at) => at > cutoff);
    if (recent.length) this.failures.set(source, recent);
    else this.failures.delete(source);
    return recent;
  }

  blocked(source: string): boolean {
    return this.recent(source).length >= this.limit;
  }

  fail(source: string): void {
    const recent = this.recent(source);
    recent.push(this.now());
    this.failures.set(source, recent);
    if (this.failures.size > 5_000) for (const key of this.failures.keys()) this.recent(key);
  }
}

function deliveryId(req: IncomingMessage): string | undefined {
  return (
    header(req, "idempotency-key") ??
    header(req, "x-webhook-id") ??
    header(req, "x-github-delivery") ??
    header(req, "webhook-id")
  )?.trim() || undefined;
}

function eventName(req: IncomingMessage): string | undefined {
  return (
    header(req, "x-github-event") ??
    header(req, "x-webhook-event") ??
    header(req, "x-event-type") ??
    header(req, "ce-type")
  )?.trim() || undefined;
}

function lowerHeaders(req: IncomingMessage): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(req.headers)) out[name.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  return out;
}

/** Receivers that are not triggers, on the same listener: "Me joindre" by
 * WhatsApp (server/reach-me/whatsapp.ts), Meta's subscription check (GET)
 * and the person's messages (POST, signed with their app secret). */
export interface WebhookIngressReceivers {
  reachMeWhatsApp?(endpointId: string, request: { method: string; query: URLSearchParams; headers: Record<string, string | undefined>; rawBody: string }): Promise<{ status: number; contentType: string; body: string }>;
}

export function createWebhookIngressHandler(
  manager: WebhookManager,
  claimRequest?: () => () => void,
  limiter: AuthFailureLimiter = new AuthFailureLimiter(),
  receivers: WebhookIngressReceivers = {},
) {
  /** `/reach-me/whatsapp/<endpoint>`: refusals count like a bad token. */
  const handleReachMeWhatsApp = async (endpointId: string, url: URL, req: IncomingMessage, res: ServerResponse) => {
    const bucket = `reach-me-whatsapp:${endpointId}`;
    if (limiter.blocked(bucket)) {
      res.setHeader("retry-after", String(Math.ceil(WEBHOOK_AUTH_FAILURE_WINDOW_MS / 1000)));
      return json(res, 429, { error: "Too many failed attempts" });
    }
    if (!receivers.reachMeWhatsApp) return json(res, 404, { error: "Unknown webhook endpoint" });
    try {
      const rawBody = req.method === "POST" ? await readRawBody(req) : "";
      const answer = await receivers.reachMeWhatsApp(endpointId, { method: req.method ?? "GET", query: url.searchParams, headers: lowerHeaders(req), rawBody });
      if (answer.status === 401 || answer.status === 403 || answer.status === 404) limiter.fail(bucket);
      res.writeHead(answer.status, { "content-type": answer.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
      return res.end(answer.body);
    } catch (error) {
      const parsedError = statusErrorSchema.safeParse(error);
      const status = parsedError.success ? parsedError.data.status ?? 500 : 500;
      return json(res, status, { error: status === 413 || status === 400 ? (error as Error).message : "The webhook could not be accepted. Try again later." });
    }
  };
  /** A typed trigger (`/sources/<endpointId>`): the provider proves itself
   * with its own signature scheme (GitHub, Slack, Sentry, PagerDuty and
   * Linear HMAC; GitLab token; Microsoft Graph clientState), because none of
   * them can send a bearer token. Same failure counter, same body cap, same
   * answer for every kind of refusal. */
  const handleSource = async (endpointId: string, url: URL, req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") return json(res, 405, { error: "Webhooks accept POST requests" });
    let release: (() => void) | undefined;
    try {
      release = claimRequest?.();
      // Behind the deployment's reverse proxy every caller has the same
      // socket address, so failures are counted per endpoint: a flood on one
      // trigger (or on made-up ids, one shared bucket) never locks out the
      // others. Endpoint ids are random, so only someone who knows one can
      // slow that one down.
      const trigger = manager.sourceTrigger(endpointId);
      const bucket = trigger?.source ? `source:${endpointId}` : "source:unknown";
      if (limiter.blocked(bucket)) {
        res.setHeader("retry-after", String(Math.ceil(WEBHOOK_AUTH_FAILURE_WINDOW_MS / 1000)));
        return json(res, 429, { error: "Too many failed attempts" });
      }
      if (!trigger?.source) {
        limiter.fail(bucket);
        return json(res, 401, { error: "Unauthorized" });
      }
      const headers = lowerHeaders(req);
      const early = handshakeBeforeAuth(trigger.source.type, { headers, rawBody: "", query: url.searchParams, now: Date.now() });
      if (early) {
        res.writeHead(early.status, { "content-type": early.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return res.end(early.body);
      }
      const rawBody = await readRawBody(req);
      const outcome = manager.receiveSource(endpointId, { headers, rawBody, query: url.searchParams, now: Date.now() });
      if (outcome.kind === "unauthorized") {
        limiter.fail(bucket);
        manager.recordUnauthorized(endpointId, { eventName: headers["x-github-event"] ?? headers["x-gitlab-event"] ?? headers["sentry-hook-resource"] },
          `Signature check failed: ${outcome.reason}`);
        return json(res, 401, { error: "Unauthorized" });
      }
      if (outcome.kind === "handshake") {
        res.writeHead(outcome.handshake.status, { "content-type": outcome.handshake.contentType, "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return res.end(outcome.handshake.body);
      }
      return json(res, 202, { accepted: true, results: outcome.results as unknown as JsonValue });
    } catch (error) {
      const parsedError = statusErrorSchema.safeParse(error);
      const status = parsedError.success ? parsedError.data.status ?? 500 : 500;
      const message = error instanceof Error ? error.message : String(error);
      if (status === 400 || status === 413) manager.recordRejected(endpointId, status, message);
      const deliberate = parsedError.success && parsedError.data.status !== undefined;
      return json(res, status, { error: deliberate ? message : "The webhook could not be accepted. Try again later." });
    } finally {
      release?.();
    }
  };

  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, 200, { app: "openmausbot-webhooks", ready: true });
    }
    const sourceMatch = url.pathname.match(/^\/sources\/(wh_[A-Za-z0-9_-]+)$/);
    if (sourceMatch) return handleSource(sourceMatch[1]!, url, req, res);
    const reachMatch = url.pathname.match(/^\/reach-me\/whatsapp\/(rmwa_[A-Za-z0-9_-]{16,64})$/);
    if (reachMatch) return handleReachMeWhatsApp(reachMatch[1]!, url, req, res);
    const match = url.pathname.match(/^\/hooks\/(wh_[A-Za-z0-9_-]+)(?:\/([^/]+))?$/);
    if (!match) return json(res, 404, { error: "Unknown webhook endpoint" });
    if (req.method !== "POST") return json(res, 405, { error: "Webhooks accept POST requests" });

    let release: (() => void) | undefined;
    try {
      release = claimRequest?.();
      // Counted per endpoint like the typed path: behind the reverse proxy
      // every sender has the same socket address, so a per-address bucket let
      // one noisy caller lock out every webhook. A flood on one id (or on
      // made-up ids, one shared bucket) never blocks another webhook.
      const bucket = manager.hasBearerEndpoint(match[1]) ? `hook:${match[1]}` : "hook:unknown";
      if (limiter.blocked(bucket)) {
        res.setHeader("retry-after", String(Math.ceil(WEBHOOK_AUTH_FAILURE_WINDOW_MS / 1000)));
        return json(res, 429, { error: "Too many failed attempts" });
      }
      // A token in the path (the old capability URL) is never read: it is a
      // failure like any other call without the right Authorization header.
      const token = match[2] ? "" : bearerToken(req);
      // Reject before buffering or parsing attacker input. The response never
      // says whether the endpoint, the header or the token was wrong.
      if (!manager.authorize(match[1], token)) {
        limiter.fail(bucket);
        // one rolling record per webhook, so a flood never pushes real deliveries out
        manager.recordUnauthorized(match[1], {
          contentType: header(req, "content-type"),
          eventName: eventName(req),
          deliveryId: deliveryId(req),
        });
        return json(res, 401, { error: "Unauthorized" });
      }
      const raw = await readRawBody(req);
      const contentType = header(req, "content-type")?.split(";")[0]?.trim().toLowerCase() ?? "text/plain";
      const payload = parsePayload(raw, contentType);
      const result = manager.receive(match[1], token, {
        payload,
        contentType,
        eventName: eventName(req),
        userAgent: header(req, "user-agent"),
        deliveryId: deliveryId(req),
      });
      return json(res, 202, { accepted: true, ...result });
    } catch (error) {
      const parsedError = statusErrorSchema.safeParse(error);
      const status = parsedError.success ? parsedError.data.status ?? 500 : 500;
      const message = error instanceof Error ? error.message : String(error);
      // Manager-level validation records its own rejection with the parsed
      // payload. Receiver-level failures happen earlier, so record metadata
      // here without buffering untrusted data a second time.
      if (status === 400 || status === 413) {
        manager.recordRejected(match[1], status, message, {
          contentType: header(req, "content-type"),
          eventName: eventName(req),
          deliveryId: deliveryId(req),
        });
      }
      // An error without a status is not one this code meant to show: its
      // message may name a file path or an internal detail, and this
      // listener answers the internet. The sender gets a generic line.
      const deliberate = parsedError.success && parsedError.data.status !== undefined;
      return json(res, status, { error: deliberate ? message : "The webhook could not be accepted. Try again later." });
    } finally {
      release?.();
    }
  };
}

/** Which absolute http(s) origin senders should use for `/hooks` and
 * `/sources`. Prefers the dedicated webhook URL; falls back to the server's
 * public origin (same host the UI serves, with `/hooks` routed to the
 * receiver). Blank values are unset. Pairing custom domains are not consulted. */
export function resolveWebhookPublicUrl(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): string | undefined {
  const dedicated = env.SAGAX_WEBHOOK_PUBLIC_URL?.trim();
  if (dedicated) return dedicated;
  const publicUrl = env.SAGAX_PUBLIC_URL?.trim();
  if (publicUrl) return publicUrl;
  return undefined;
}

/** The base senders are told to use. Behind a proxy or tunnel the listening
 * address is unreachable from outside, so the operator supplies the public
 * one; a trailing slash is tolerated because every hook path adds its own. */
export function advertisedWebhookBase(raw: string): string {
  let parsed: URL | undefined;
  try {
    parsed = new URL(raw);
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== "http:" && parsed.protocol !== "https:")) {
    throw new Error(
      `webhook public base URL must be an absolute http(s) URL such as https://bots.example.com, got "${raw}"`,
    );
  }
  return raw.replace(/\/+$/, "");
}

export async function listenWebhookIngress(
  manager: WebhookManager,
  options: { host?: string; port: number; publicBaseUrl?: string; claimRequest?: () => () => void; limiter?: AuthFailureLimiter; receivers?: WebhookIngressReceivers },
): Promise<WebhookIngress> {
  const host = options.host ?? "127.0.0.1";
  const advertised = options.publicBaseUrl === undefined ? undefined : advertisedWebhookBase(options.publicBaseUrl);
  const server = createServer(createWebhookIngressHandler(manager, options.claimRequest, options.limiter, options.receivers));
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(options.port, host, () => {
      server.off("error", onError);
      resolve();
    });
  });
  const address = serverAddressSchema.safeParse(server.address());
  if (!address.success) {
    server.close();
    throw new Error("Webhook receiver did not get a TCP address");
  }
  return {
    server,
    host,
    port: address.data.port,
    baseUrl: advertised ?? `http://${host}:${address.data.port}`,
  };
}

/** What the owner copies once: the endpoint and the bearer token. The URL
 * carries no secret; the token travels only in the Authorization header. */
export function webhookCredential(baseUrl: string, endpointId: string, token: string) {
  const endpointUrl = `${baseUrl.replace(/\/$/, "")}/hooks/${endpointId}`;
  return {
    endpointUrl,
    token,
    command: webhookCurlCommand(endpointUrl, token),
  };
}

export function webhookCurlCommand(endpointUrl: string, token: string): string {
  return `curl -X POST ${endpointUrl} -H "Authorization: Bearer ${token}"`;
}

/** What the owner pastes into the provider once: the source URL, and the
 * signing secret when Sagax made it. */
export function triggerSourceSetup(baseUrl: string, endpointId: string, secret?: string): TriggerSourceSetup {
  return { endpointUrl: `${baseUrl.replace(/\/$/, "")}/sources/${endpointId}`, ...(secret ? { secret } : {}) };
}
