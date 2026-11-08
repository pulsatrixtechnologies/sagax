// APNs relay (#2697). Only a server holding the APNs key (.p8) can talk to
// Apple. A Sagax without that key (a desktop on its own) prepares each push
// as usual (./payload.ts) and hands it to a relay: a Sagax server that has
// the key and answers POST /api/push/relay. Proactive cards, approvals and
// questions then reach the phone even while the desktop app has no key.
//
//   client:  SAGAX_APNS_RELAY_URL    https://relay.example (http only on loopback)
//            SAGAX_APNS_RELAY_TOKEN  shared secret, one line, 32 to 256 characters
//   relay:   SAGAX_APNS_RELAY_TOKENS the accepted secrets, comma separated
//
// The relay never sees the key's owner data: only the device token, the
// environment and the prepared request. It never logs a token or a secret.
import type { ApnsEnvironment } from "./config.ts";
import type { SendOutcome } from "./apns.ts";
import type { ApnsRequest } from "./payload.ts";

export const APNS_RELAY_PATH = "/api/push/relay";
export const APNS_RELAY_MAX_BODY = 4096;
const MAX_REQUEST_BYTES = 16 * 1024;
const TOKEN_MIN = 32;
const TOKEN_MAX = 256;
const HEADER_ALLOWLIST = new Set(["apns-push-type", "apns-priority", "apns-collapse-id", "apns-expiration", "apns-topic"]);

export type ApnsRelayConfigResult =
  | { configured: true; url: string; token: string }
  | { configured: false; reason: string };

const isLoopbackHost = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";

const validSecret = (value: string) => value.length >= TOKEN_MIN && value.length <= TOKEN_MAX && /^[\x21-\x7e]+$/.test(value);

/** Reads the relay a keyless server forwards its pushes to. Never logs the token. */
export function readApnsRelayConfig(env: NodeJS.ProcessEnv = process.env): ApnsRelayConfigResult {
  const rawUrl = env.SAGAX_APNS_RELAY_URL?.trim();
  if (!rawUrl) return { configured: false, reason: "SAGAX_APNS_RELAY_URL is not set" };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { configured: false, reason: "SAGAX_APNS_RELAY_URL is not a URL" };
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopbackHost(url.hostname))) {
    return { configured: false, reason: "SAGAX_APNS_RELAY_URL must be https (http only on loopback)" };
  }
  const token = env.SAGAX_APNS_RELAY_TOKEN?.trim() ?? "";
  if (!validSecret(token)) return { configured: false, reason: `SAGAX_APNS_RELAY_TOKEN must be one line of ${TOKEN_MIN} to ${TOKEN_MAX} characters` };
  const base = url.toString().replace(/\/+$/, "");
  return { configured: true, url: `${base}${APNS_RELAY_PATH}`, token };
}

/** The secrets a relay accepts. Invalid entries are skipped. */
export function readApnsRelayTokens(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.SAGAX_APNS_RELAY_TOKENS ?? "").split(",").map((entry) => entry.trim()).filter(validSecret);
}

export interface ApnsRelayEnvelope {
  token: string;
  environment: ApnsEnvironment;
  headers: Record<string, string>;
  body: string;
}

/** Checks what a relay client sent: a hex device token, a known environment,
 * only the APNs headers a push needs (the topic must be the relay's own
 * app), and a body APNs accepts. */
export function parseRelayEnvelope(raw: unknown, bundleId: string): { ok: true; envelope: ApnsRelayEnvelope } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "body must be a JSON object" };
  const input = raw as Record<string, unknown>;
  const token = typeof input.token === "string" ? input.token.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64,200}$/.test(token)) return { ok: false, error: "token must be a hex APNs device token" };
  const environment = input.environment;
  if (environment !== "sandbox" && environment !== "production") return { ok: false, error: "environment must be sandbox or production" };
  if (!input.headers || typeof input.headers !== "object" || Array.isArray(input.headers)) return { ok: false, error: "headers must be an object" };
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    if (!HEADER_ALLOWLIST.has(lower)) return { ok: false, error: `header ${lower} is not allowed` };
    if (typeof value !== "string" || value.length > 200 || /[\r\n]/.test(value)) return { ok: false, error: `header ${lower} is not valid` };
    headers[lower] = value;
  }
  const topic = headers["apns-topic"] ?? "";
  const allowedTopics = [bundleId, `${bundleId}.push-type.liveactivity`];
  if (!allowedTopics.includes(topic)) return { ok: false, error: "apns-topic must be this relay's app" };
  if (typeof input.body !== "string" || !input.body) return { ok: false, error: "body must be a string" };
  if (Buffer.byteLength(input.body) > APNS_RELAY_MAX_BODY) return { ok: false, error: `body is over ${APNS_RELAY_MAX_BODY} bytes` };
  try {
    JSON.parse(input.body);
  } catch {
    return { ok: false, error: "body must be JSON" };
  }
  return { ok: true, envelope: { token, environment, headers, body: input.body } };
}

export type RelayFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ status: number; json(): Promise<unknown> }>;

/** Same send() as ApnsSender, through the relay. */
export class ApnsRelaySender {
  private readonly url: string;
  private readonly token: string;
  private readonly fetch: RelayFetch;
  private readonly timeoutMs: number;

  constructor(input: { url: string; token: string; fetch?: RelayFetch; timeoutMs?: number }) {
    this.url = input.url;
    this.token = input.token;
    this.fetch = input.fetch ?? ((url, init) => globalThis.fetch(url, init));
    this.timeoutMs = input.timeoutMs ?? 10_000;
  }

  async send(device: { token: string; environment: ApnsEnvironment }, request: ApnsRequest): Promise<SendOutcome> {
    const envelope: ApnsRelayEnvelope = { token: device.token, environment: device.environment, headers: request.headers, body: request.body };
    let response: { status: number; json(): Promise<unknown> };
    try {
      response = await this.fetch(this.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(envelope),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      return { ok: false, status: 0, reason: `relay unreachable (${error instanceof Error ? error.name : "error"})`, prune: false };
    }
    let data: Record<string, unknown> = {};
    try {
      const parsed = await response.json();
      if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
    } catch {
      // a relay that answered without JSON: the status alone tells
    }
    if (response.status === 200 && data.ok === true) return { ok: true };
    if (response.status === 200 && data.ok === false) {
      return { ok: false, status: Number(data.status) || 0, reason: String(data.reason ?? "relay refused"), prune: data.prune === true };
    }
    return { ok: false, status: response.status, reason: `relay ${response.status}${typeof data.error === "string" ? ` (${data.error.slice(0, 120)})` : ""}`, prune: false };
  }
}

/** A fixed window per secret, so one leaked secret cannot flood Apple. */
export class RelayRateLimiter {
  private readonly hits = new Map<string, { start: number; count: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(max = 600, windowMs = 60_000, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  allow(id: string): boolean {
    const at = this.now();
    const entry = this.hits.get(id);
    if (!entry || at - entry.start >= this.windowMs) {
      this.hits.set(id, { start: at, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }
}

export const APNS_RELAY_MAX_REQUEST = MAX_REQUEST_BYTES;
