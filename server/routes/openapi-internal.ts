// POST /api/internal/openapi: one operation of the turn's person's API.
// The headers stored with the spec are added here and never returned.
// The call uses the address that was checked (server/vault/credential-http.ts
// sendPinnedHttp): one resolution, every address classified, no second
// lookup, a byte cap, no redirect. Headers are not written to a log.
import { isIP } from "node:net";

import { wrapUntrusted } from "../../shared/safety-review.ts";
import { sendPinnedHttp } from "../vault/credential-http.ts";
import { buildOpenApiRequest, type OpenApiRecord } from "../mcp/openapi-connector.ts";
import { isOpenApiTool } from "../mcp/openapi-tools.ts";
import type { InternalCapabilityView, InternalRouteHandler } from "./internal-route.ts";
import { PASS } from "./table.ts";

export const OPENAPI_INTERNAL_PATH = "/api/internal/openapi";
const SHOWN_CHARS = 8_000;
const MAX_BYTES = 64 * 1024;

export interface OpenApiInternalDeps {
  /** The spec of the person this turn is for, or null when they have none
   * or this turn must not use it (a room, another member). */
  record(capability: InternalCapabilityView): OpenApiRecord | null;
  organization(): boolean;
  resolve?(host: string): Promise<string[]>;
}

export function createOpenApiInternalRoutes(deps: OpenApiInternalDeps): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (!(method === "POST" && path === OPENAPI_INTERNAL_PATH)) return PASS;
    const body = await readBody();
    const name = typeof body.name === "string" ? body.name : "";
    if (!isOpenApiTool(name)) return json(res, 400, { error: "name must be one of this person's operations." });
    const record = deps.record(capability);
    const operation = record?.operations.find((item) => `openapi_${item.name}` === name);
    if (!record || !operation) return json(res, 404, { error: "The person speaking has no API document with this operation (their own, in Settings, never the bot owner's). Ask them to add it there." });
    const args = body.arguments && typeof body.arguments === "object" && !Array.isArray(body.arguments) ? body.arguments as Record<string, unknown> : {};
    const request = buildOpenApiRequest({ operation, baseUrl: record.baseUrl, headers: record.headers, args });
    if (typeof request === "string") return json(res, 400, { error: request });
    const sent = await sendPinnedHttp({
      method: request.method,
      url: request.url,
      headers: request.headers,
      ...(request.body !== undefined ? { body: request.body } : {}),
    }, {
      allowNonPublic: !deps.organization(),
      timeoutMs: 20_000,
      maxResponseBytes: MAX_BYTES,
      ...(deps.resolve ? { resolve: async (host: string) => (await deps.resolve!(host)).map((address) => ({ address, family: isIP(address) || 4 })) } : {}),
    });
    if (!sent.ok) {
      const status = sent.code === "blocked_address" || sent.code === "invalid_request" ? 403 : 502;
      return json(res, status, { error: sent.message });
    }
    const text = sent.body.slice(0, SHOWN_CHARS);
    const cut = sent.truncated || sent.body.length > SHOWN_CHARS ? "\n(the answer was cut)" : "";
    const wrapped = wrapUntrusted("api", `HTTP ${sent.status}\n${text}${cut}`);
    if (sent.status >= 400) return json(res, 502, { error: wrapped });
    return json(res, 200, { text: wrapped });
  };
}
