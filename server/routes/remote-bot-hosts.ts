// Bot Computer tab: attach enrolled unattended hosts so the bot has access
// by default (2026-11-01). Person isolation is enforced in remote-bot-hosts.ts.
import { z } from "zod";

import { PASS, type RouteHandler } from "./table.ts";
import type { RequestAuth } from "../request-auth.ts";
import type { RemoteBotHosts } from "../remote-bot-hosts.ts";
import { UNATTENDED_HOST_ID } from "../../shared/remote-unattended-host.ts";

const LIST = /^\/api\/bots\/([\w-]{1,80})\/remote-hosts$/;
const ONE = /^\/api\/bots\/([\w-]{1,80})\/remote-hosts\/(h_[0-9a-f]{32})$/;
const OPEN = /^\/api\/bots\/([\w-]{1,80})\/remote-hosts\/(h_[0-9a-f]{32})\/open$/;

const attachBody = z.object({ hostId: z.string().regex(UNATTENDED_HOST_ID) }).strict();
const openBody = z.object({
  scope: z.enum(["full-control", "view-only", "shell-only"]).optional(),
  rights: z.enum(["standard", "elevated"]).optional(),
}).strict();

export function createRemoteBotHostsRoutes(deps: {
  hosts: RemoteBotHosts;
  principalId(auth: RequestAuth): string | undefined;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const list = LIST.exec(path);
    const one = ONE.exec(path);
    const open = OPEN.exec(path);
    if (!list && !one && !open) return PASS;

    const principalId = deps.principalId(auth);
    if (!principalId) return json(res, 401, { error: "Sign in to manage remote hosts." });

    if (list) {
      const botId = list[1]!;
      if (method === "GET") {
        const out = await deps.hosts.forBot(principalId, botId);
        if (!out.available && out.reason === "You cannot change that bot.") return json(res, 403, { error: out.reason });
        return json(res, 200, {
          available: out.available,
          hosts: out.hosts,
          catalog: out.catalog,
          attached: out.attached,
          ...(out.reason ? { reason: out.reason } : {}),
        });
      }
      if (method === "POST") {
        const parsed = attachBody.safeParse(await readBody(req));
        if (!parsed.success) return json(res, 400, { error: "Send hostId (h_ and 32 hex)." });
        const out = await deps.hosts.attach(principalId, botId, parsed.data.hostId);
        if (!out.ok) {
          const status = out.error === "forbidden" ? 403 : out.error === "invalid" ? 400 : out.error === "not_found" ? 404 : 409;
          return json(res, status, { error: out.message, code: out.error });
        }
        return json(res, 200, { remoteHosts: out.remoteHosts });
      }
      return json(res, 405, { error: "method not allowed" });
    }

    if (open) {
      if (method !== "POST") return json(res, 405, { error: "method not allowed" });
      const botId = open[1]!;
      const hostId = open[2]!;
      const parsed = openBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: "Send scope and rights, or nothing." });
      const out = await deps.hosts.open(principalId, botId, hostId, parsed.data);
      if (!out.ok) {
        const status = out.error === "forbidden" ? 403 : out.error === "invalid" ? 400 : out.error === "not_found" ? 404 : out.error === "unavailable" ? 409 : 502;
        return json(res, status, { error: out.message, code: out.error });
      }
      if ("code" in out) return json(res, 200, { code: out.code, botId: out.botId, threadId: out.threadId });
      return json(res, 502, { error: "Could not open that host." });
    }

    if (one) {
      if (method !== "DELETE") return json(res, 405, { error: "method not allowed" });
      const botId = one[1]!;
      const hostId = one[2]!;
      const out = await deps.hosts.detach(principalId, botId, hostId);
      if (!out.ok) {
        const status = out.error === "forbidden" ? 403 : out.error === "invalid" ? 400 : 404;
        return json(res, status, { error: out.message, code: out.error });
      }
      return json(res, 200, { remoteHosts: out.remoteHosts });
    }

    return PASS;
  };
}
