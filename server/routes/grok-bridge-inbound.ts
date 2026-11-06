// Signed inbound envelopes from a linked Grok (#2193):
//
//   POST /api/bridge/grok/:linkId
//
// Authenticated by X-Bridge-Signature (HMAC of the exact body). No session
// (PRE_AUTH_ROUTES). Replays and bad signatures → 401. Rate limit → 429.
// Disabled link → 403.
import type { IncomingMessage } from "node:http";

import { BRIDGE_SIGNATURE_HEADER } from "../../shared/grok-bridge.ts";
import type { GrokBridgeService } from "../grok-bridge/service.ts";
import { PASS, type PreAuthRouteHandler } from "./table.ts";

export const GROK_BRIDGE_INBOUND = /^\/api\/bridge\/grok\/([a-f0-9]{32})$/;
const MAX_BODY = 256 * 1024;

export interface GrokBridgeInboundDeps {
  service: GrokBridgeService;
}

async function readRawBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_BODY) throw Object.assign(new Error("Body too large"), { status: 413 });
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, bytes);
}

export function createGrokBridgeInboundRoutes(deps: GrokBridgeInboundDeps): PreAuthRouteHandler {
  return async ({ req, res, path, method, json }) => {
    const match = GROK_BRIDGE_INBOUND.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "POST" });
    res.setHeader("cache-control", "no-store");
    const linkId = match[1]!;
    let raw: Buffer;
    try {
      raw = await readRawBody(req);
    } catch (error) {
      const status = (error as { status?: number }).status ?? 400;
      return json(res, status, { error: error instanceof Error ? error.message : "Could not read body." });
    }
    const header = req.headers[BRIDGE_SIGNATURE_HEADER];
    const signature = typeof header === "string" ? header : Array.isArray(header) ? header[0] : null;
    const result = await deps.service.acceptInbound({ linkId, rawBody: raw, signature });
    if (!result.ok) {
      if (result.status === 429) res.setHeader("retry-after", "60");
      return json(res, result.status, { error: result.error });
    }
    return json(res, 200, {
      ok: true,
      ...(result.duplicate ? { duplicate: true } : {}),
      ...(result.sagaxThreadId ? { thread_id: result.sagaxThreadId } : {}),
    });
  };
}
