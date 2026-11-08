// APNs relay endpoint (#2697): POST /api/push/relay
//
// A Sagax without the APNs key forwards each prepared push here
// (server/push/relay.ts). Authenticated by a shared secret
// (SAGAX_APNS_RELAY_TOKENS, Bearer, constant-time match). No session
// (PRE_AUTH_ROUTES). Off (404) when no secret is set or this server has no
// APNs key. Never logs a device token or a secret.
import type { IncomingMessage } from "node:http";

import { bearerToken, secureTokenMatch } from "../auth/request-auth.ts";
import type { SendOutcome } from "../push/apns.ts";
import type { ApnsEnvironment } from "../push/config.ts";
import type { ApnsRequest } from "../push/payload.ts";
import { APNS_RELAY_MAX_REQUEST, APNS_RELAY_PATH, parseRelayEnvelope, RelayRateLimiter } from "../push/relay.ts";
import { PASS, type PreAuthRouteHandler } from "./table.ts";

export interface PushRelayRouteDeps {
  /** Accepted secrets; empty means the relay is off. */
  tokens: readonly string[];
  /** The app topic of this server's key. */
  topic(): string;
  /** Null when this server holds no APNs key. */
  send(device: { token: string; environment: ApnsEnvironment }, request: ApnsRequest): Promise<SendOutcome> | null;
  limiter?: RelayRateLimiter;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > APNS_RELAY_MAX_REQUEST) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes).toString("utf8");
}

export function createPushRelayRoutes(deps: PushRelayRouteDeps): PreAuthRouteHandler {
  const limiter = deps.limiter ?? new RelayRateLimiter();
  return async ({ req, res, path, method, json }) => {
    if (path !== APNS_RELAY_PATH) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.tokens.length) return json(res, 404, { error: "Not found" });
    if (method !== "POST") return json(res, 405, { error: "POST" });
    const presented = bearerToken(req.headers.authorization);
    const index = deps.tokens.findIndex((token) => secureTokenMatch(presented, token));
    if (index < 0) return json(res, 401, { error: "Unauthorized" });
    if (!limiter.allow(String(index))) return json(res, 429, { error: "Too many pushes" });
    let raw: unknown;
    try {
      raw = JSON.parse(await readBody(req));
    } catch (error) {
      const status = (error as { status?: number }).status === 413 ? 413 : 400;
      return json(res, status, { error: status === 413 ? "Body too large" : "Body must be JSON" });
    }
    const topic = deps.topic();
    const parsed = parseRelayEnvelope(raw, topic);
    if (!parsed.ok) return json(res, 400, { error: parsed.error });
    const { token, environment, headers, body } = parsed.envelope;
    const pending = topic ? deps.send({ token, environment }, { headers, body }) : null;
    if (!pending) return json(res, 503, { error: "APNs is not configured on this relay" });
    const outcome = await pending;
    return json(res, 200, outcome);
  };
}
