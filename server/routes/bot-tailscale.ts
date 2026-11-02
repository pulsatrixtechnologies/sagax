// Connect apps > Tailscale: the person's own bot computer joins their
// private tailnet. Credentials stay sealed; answers never carry them.
//
//   GET    /api/me/tailscale              status view
//   POST   /api/me/tailscale/setup        { mode: "authKey"|"oauth", ... }
//   POST   /api/me/tailscale/join         { computerId, keyKind?, hostname? }
//   POST   /api/me/tailscale/refresh      poll while Waiting for admin approval
//   POST   /api/me/tailscale/disconnect   leave the tailnet, keep credentials
//   DELETE /api/me/tailscale              forget credentials and disconnect
//
// Solo and organization: the signed-in person (or the local owner) manages
// their own connection. No admin step for a personal tailnet. Org Ask/Deny
// and person isolation stay elsewhere.
import type { BotTailscaleJoinInput, BotTailscaleSetupInput } from "../../shared/bot-tailscale.ts";
import {
  BotTailscaleError,
  botTailscaleScope,
  type BotTailscaleScope,
  type BotTailscaleService,
} from "../bot-tailscale.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const BOT_TAILSCALE_PATH = "/api/me/tailscale";

export interface BotTailscaleRouteDeps {
  service: BotTailscaleService;
  /** Solo: { organization: false }. Org: principal of the session. */
  scope(auth: RequestAuth): BotTailscaleScope | null;
  /** 403 body when the caller lacks apps.ownIntegrations, else null. */
  ownIntegrationsRefusal?: (auth: RequestAuth) => Record<string, unknown> | null;
}

export function createBotTailscaleRoutes(deps: BotTailscaleRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== BOT_TAILSCALE_PATH && !path.startsWith(`${BOT_TAILSCALE_PATH}/`)) return PASS;
    res.setHeader("cache-control", "private, no-store");
    const scope = deps.scope(auth);
    if (!scope) {
      return json(res, 401, { error: "Sign in to connect your bot computer to Tailscale.", code: "not_signed_in" });
    }

    const action = path === BOT_TAILSCALE_PATH ? "" : path.slice(BOT_TAILSCALE_PATH.length + 1);
    try {
      if (path === BOT_TAILSCALE_PATH && method === "GET") {
        return json(res, 200, await deps.service.view(scope));
      }
      if (path === BOT_TAILSCALE_PATH && method === "DELETE") {
        const refusal = deps.ownIntegrationsRefusal?.(auth) ?? null;
        if (refusal) return json(res, 403, refusal);
        return json(res, 200, await deps.service.clear(scope));
      }
      if (action === "setup" && method === "POST") {
        const refusal = deps.ownIntegrationsRefusal?.(auth) ?? null;
        if (refusal) return json(res, 403, refusal);
        requireJson(req);
        return json(res, 200, await deps.service.setup(scope, parseSetup(await readBody(req))));
      }
      if (action === "join" && method === "POST") {
        const refusal = deps.ownIntegrationsRefusal?.(auth) ?? null;
        if (refusal) return json(res, 403, refusal);
        requireJson(req);
        return json(res, 200, await deps.service.join(scope, parseJoin(await readBody(req))));
      }
      if (action === "refresh" && method === "POST") {
        return json(res, 200, await deps.service.refresh(scope));
      }
      if (action === "disconnect" && method === "POST") {
        const refusal = deps.ownIntegrationsRefusal?.(auth) ?? null;
        if (refusal) return json(res, 403, refusal);
        return json(res, 200, await deps.service.disconnect(scope));
      }
      if (path === BOT_TAILSCALE_PATH || action) {
        return json(res, 405, { error: "Use GET, DELETE, or POST on setup|join|refresh|disconnect." });
      }
      return PASS;
    } catch (error) {
      if (error instanceof BotTailscaleError) {
        const status = error.code === "invalid_input" || error.code === "unknown_computer" ? 400
          : error.code === "not_setup" ? 409
            : error.code === "busy" ? 409
              : 400;
        return json(res, status, { error: error.message, code: error.code });
      }
      throw error;
    }
  };
}

export function botTailscaleScopeFor(
  organization: boolean,
  principalId: string | null | undefined,
): BotTailscaleScope | null {
  return botTailscaleScope(organization, principalId);
}

function requireJson(req: { headers: Record<string, string | string[] | undefined> }): void {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
    throw new BotTailscaleError("content-type must be application/json", "invalid_input");
  }
}

function parseSetup(body: unknown): BotTailscaleSetupInput {
  if (!body || typeof body !== "object") throw new BotTailscaleError("Send a JSON body.", "invalid_input");
  const row = body as Record<string, unknown>;
  const mode = row.mode;
  if (mode !== "authKey" && mode !== "oauth") {
    throw new BotTailscaleError('mode must be "authKey" or "oauth".', "invalid_input");
  }
  const tags = Array.isArray(row.tags)
    ? row.tags.filter((t): t is string => typeof t === "string")
    : undefined;
  if (mode === "authKey") {
    return {
      mode,
      authKey: typeof row.authKey === "string" ? row.authKey : undefined,
      tags,
    };
  }
  return {
    mode,
    clientId: typeof row.clientId === "string" ? row.clientId : undefined,
    clientSecret: typeof row.clientSecret === "string" ? row.clientSecret : undefined,
    tags,
  };
}

function parseJoin(body: unknown): BotTailscaleJoinInput {
  if (!body || typeof body !== "object") throw new BotTailscaleError("Send a JSON body.", "invalid_input");
  const row = body as Record<string, unknown>;
  if (typeof row.computerId !== "string" || !row.computerId.trim()) {
    throw new BotTailscaleError("computerId is required.", "invalid_input");
  }
  const keyKind = row.keyKind === "reusable" || row.keyKind === "ephemeral" ? row.keyKind : undefined;
  return {
    computerId: row.computerId.trim(),
    keyKind,
    hostname: typeof row.hostname === "string" ? row.hostname : undefined,
  };
}
