// The remote file browser of a Tailcat session: lists one folder of the
// remote computer for the person who owns the session, read only. The path
// comes in the body (not the URL, so it stays out of access logs); the tunnel
// address, the node key and the session id never come back.
import type { IncomingMessage } from "node:http";

import { PASS } from "./table.ts";
import type { RouteHandler } from "./table.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { RemoteSessionService } from "../remote-sessions.ts";

/** Set by performBotActRoute (server/index.ts) on every request a bot makes
 * through `act`. It only ever narrows what a request may do, so it needs no
 * secret: a caller that adds it restricts itself. */
export const BOT_ACT_ROUTE_HEADER = "x-sagax-bot-act";

/** A bot or a tool calls, not the person at the screen: a bot's `act` call,
 * a short-lived session copy (bot act, member API), or a loopback caller that
 * is a bot's shell on a shared server. Such a caller may upload only into the
 * transfer folder and never replace a file. */
export function remoteCallerIsAgent(req: Pick<IncomingMessage, "headers">, auth: RequestAuth): boolean {
  if (req.headers[BOT_ACT_ROUTE_HEADER] !== undefined) return true;
  if (auth.kind === "session") return auth.session.ephemeral === true;
  return auth.trust === "service";
}

const LS = /^\/api\/bots\/([\w-]{1,80})\/remote-sessions\/([a-f0-9]{12})\/ls$/;

export function createRemoteSessionFileRoutes(deps: {
  sessions: Pick<RemoteSessionService, "listDir">;
  principalId(auth: RequestAuth): string | undefined;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody: readJson }) => {
    const match = LS.exec(path);
    if (!match) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to use a remote session." });
    let body: unknown;
    try {
      body = await readJson(req, 4_000);
    } catch {
      return json(res, 400, { error: "That folder path cannot be listed." });
    }
    const record = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
    if (!record || Object.keys(record).some((key) => key !== "path")) return json(res, 400, { error: "Send only the folder path." });
    const listed = await deps.sessions.listDir(principalId, match[1]!, match[2]!, record.path);
    if ("error" in listed) return json(res, listed.status, { error: listed.error });
    return json(res, 200, listed.listing);
  };
}
