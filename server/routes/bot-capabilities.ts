// A bot's capabilities: the one resolved list of what it receives on top of
// its engine (shared/capabilities.ts, server/capabilities/capabilities.ts).
//
//   GET /api/bots/:id/capabilities[?engine=<instanceId>]   -> BotCapabilities
//
// Read only. A person who may use the bot reads it (member scope on an
// organization server: request-auth.ts CLIENT_ALLOW, feature orgDirectory);
// the handler checks the bot level (`resolve` answers null for a bot the
// caller cannot see). `engine` previews the list on another engine instance
// of this server, for the bot's model picker and the plugin pages.
import type { RequestAuth } from "../request-auth.ts";
import type { BotCapabilities } from "../../shared/capabilities.ts";
import { PASS, type RouteHandler } from "./table.ts";

const CAPABILITIES_PATH = /^\/api\/bots\/([\w-]{1,128})\/capabilities$/;
const ENGINE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export type BotCapabilitiesAnswer =
  | { ok: true; capabilities: BotCapabilities }
  | { ok: false; status: 400 | 404; error: string; code: string };

export interface BotCapabilitiesRouteDeps {
  resolve: (auth: RequestAuth, botId: string, engine: string | undefined) => BotCapabilitiesAnswer;
}

export function createBotCapabilitiesRoutes(deps: BotCapabilitiesRouteDeps): RouteHandler {
  return async ({ res, url, path, method, auth, json }) => {
    const match = CAPABILITIES_PATH.exec(path);
    if (!match) return PASS;
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    const engine = url.searchParams.get("engine")?.trim() || undefined;
    if (engine !== undefined && !ENGINE_ID.test(engine)) return json(res, 400, { error: "Unknown engine.", code: "unknown_engine" });
    const answer = deps.resolve(auth, match[1]!, engine);
    if (!answer.ok) return json(res, answer.status, { error: answer.error, code: answer.code });
    return json(res, 200, answer.capabilities);
  };
}
