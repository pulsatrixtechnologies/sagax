// join_meeting (server/meetings/meeting-requests.ts), behind the per-turn
// agents capability the internal block of server/index.ts checks first: so
// this module is in INTERNAL_ROUTES, never in ROUTES. The bot and the
// conversation are the capability's, never the body's.
//
//   POST /api/internal/meetings/join   { url, reason }   stage the consent card
import { z } from "zod";

import { PASS } from "./table.ts";
import type { InternalRouteHandler } from "./internal-route.ts";
import type { MeetingService } from "../meetings/meeting-requests.ts";
import { MEETINGS_DISABLED } from "../../shared/meeting-request.ts";

const joinBody = z.object({
  url: z.string().min(1).max(2_048),
  reason: z.string().max(2_000).optional(),
}).strict();

export function createMeetingInternalRoutes(deps: {
  meetings: () => MeetingService;
  /** The conversation belongs to this bot (connectorThread in index.ts). */
  ownsThread(botId: string, threadId: string): boolean;
  /** Meetings join from a direct conversation only: a room has no one owner to consent. */
  isDirect(botId: string, threadId: string): boolean;
  /** Settings > Developer > Experimental > Meeting notetaker. */
  enabled(): boolean;
}): InternalRouteHandler {
  return async ({ res, path, method, json, capability, readBody }) => {
    if (path !== "/api/internal/meetings/join") return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!deps.enabled()) return json(res, 403, { ...MEETINGS_DISABLED });
    if (!deps.ownsThread(capability.botId, capability.threadId)) {
      return json(res, 403, { error: "source conversation does not belong to sender" });
    }
    if (!deps.isDirect(capability.botId, capability.threadId)) {
      return json(res, 409, { error: "A meeting is joined from a direct conversation with the person, not from a room. Ask them there." });
    }
    const parsed = joinBody.safeParse(await readBody());
    if (!parsed.success) return json(res, 400, { error: "join_meeting needs url (the meeting's https link) and reason." });
    const result = deps.meetings().submit({
      botId: capability.botId,
      threadId: capability.threadId,
      url: parsed.data.url,
      reason: parsed.data.reason ?? "",
    });
    if ("error" in result) return json(res, "code" in result && result.code === MEETINGS_DISABLED.code ? 403 : 409, result);
    return json(res, 200, result);
  };
}
