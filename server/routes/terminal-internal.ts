// The bot's two terminal tools (list_terminal_resources, offer_shell_terminal),
// served behind the per-turn agents capability the internal block of
// server/index.ts checks first (bearer, bot, live turn): so this module is in
// INTERNAL_ROUTES, never in ROUTES. The bot and the conversation are the
// capability's, never the body's; the person is the conversation's owner.
//
//   GET  /api/internal/terminal/resources   what this person may open here
//   POST /api/internal/terminal/offer       stage the approval card
import { z } from "zod";

import type { TerminalProviderKind } from "../../shared/terminal-resources.ts";
import { PASS } from "./table.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import type { createTerminalRequestService } from "../terminal-requests.ts";

const offerBody = z.object({
  /** Older proxies still send these; the capability's own values win. */
  fromBotId: z.string().optional(),
  fromThreadId: z.string().optional(),
  resourceId: z.string().min(1).max(200).optional(),
  provider: z.string().min(1).max(40).optional(),
  reason: z.string().max(2_000).optional(),
}).strict();

export function createTerminalInternalRoutes(deps: {
  requests: ReturnType<typeof createTerminalRequestService>;
  /** The conversation belongs to this bot (connectorThread in index.ts). */
  ownsThread(botId: string, threadId: string): boolean;
  /** A connected Tailcat session opens at once when the offer names no destination. */
  openRemoteShell?(args: { botId: string; threadId: string }): Promise<{ hostLabel: string; messageId: string } | { error: string } | null>;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/terminal/resources" && path !== "/api/internal/terminal/offer") return PASS;
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    if (path === "/api/internal/terminal/resources" && method === "GET") {
      const { resources, defaultResource } = await deps.requests.destinations({ botId: capability.botId, threadId: capability.threadId });
      return json(res, 200, {
        resources,
        ...(defaultResource ? { default: { provider: defaultResource.provider, resourceId: defaultResource.id } } : {}),
      });
    }
    if (path === "/api/internal/terminal/offer" && method === "POST") {
      const parsed = offerBody.safeParse(await readBody());
      if (!parsed.success) return json(res, 400, { error: "Invalid terminal offer" });
      if (!parsed.data.provider && !parsed.data.resourceId && deps.openRemoteShell) {
        const opened = await deps.openRemoteShell({ botId: capability.botId, threadId: capability.threadId });
        if (opened && "error" in opened) return json(res, 409, { error: opened.error });
        if (opened && "hostLabel" in opened) {
          return json(res, 200, { opened: true, hostLabel: opened.hostLabel, messageId: opened.messageId });
        }
      }
      const result = await deps.requests.submit({
        botId: capability.botId,
        threadId: capability.threadId,
        ...(parsed.data.resourceId ? { resourceId: parsed.data.resourceId } : {}),
        ...(parsed.data.provider ? { provider: parsed.data.provider as TerminalProviderKind } : {}),
        reason: parsed.data.reason ?? "",
      });
      if ("error" in result) return json(res, 404, { error: result.error });
      return json(res, 200, {
        requestId: result.requestId,
        messageId: result.messageId,
        destination: { provider: result.resource.provider, resourceId: result.resource.id, label: result.resource.label, hostLabel: result.resource.hostLabel },
      });
    }
    return json(res, 405, { error: "method not allowed" });
  };
}
