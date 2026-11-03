// The live meeting card's Leave button (server/meetings/meeting-requests.ts).
//
//   POST /api/meetings/leave   { threadId, requestId }
//
// Whoever may answer the card may make the bot leave (the same check as the
// card's answer: the bot's owner, or on a shared server the person who asked).
import { z } from "zod";

import type { RequestAuth } from "../auth/request-auth.ts";
import type { MeetingService } from "../meetings/meeting-requests.ts";
import { MEETINGS_DISABLED } from "../../shared/meeting-request.ts";
import { PASS, type RouteHandler } from "./table.ts";

const leaveBody = z.object({
  threadId: z.string().min(1).max(128),
  requestId: z.string().min(1).max(128),
}).strict();

export function createMeetingRoutes(deps: {
  meetings: () => MeetingService;
  /** Why this caller may not act on the card, or null. */
  refusal(auth: RequestAuth, threadId: string, requestId: string): string | null;
  /** Settings > Experimental > Meeting notetaker. */
  enabled(): boolean;
}): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path !== "/api/meetings/leave" && !path.startsWith("/api/meetings/")) return PASS;
    if (!deps.enabled()) return json(res, 403, { ...MEETINGS_DISABLED });
    if (path !== "/api/meetings/leave") return json(res, 404, { error: "not found" });
    if (method !== "POST") return json(res, 405, { error: "POST only" });
    if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const parsed = leaveBody.safeParse(await readBody(req));
    if (!parsed.success) return json(res, 400, { error: "send { threadId, requestId }" });
    const { threadId, requestId } = parsed.data;
    if (!deps.meetings().isMeetingCard(threadId, requestId)) return json(res, 404, { error: "no such meeting" });
    const refused = deps.refusal(auth, threadId, requestId);
    if (refused) return json(res, 403, { error: refused });
    const left = deps.meetings().leave(threadId, requestId);
    if (!left.ok) return json(res, left.status, { error: left.error, ...(left.code ? { code: left.code } : {}) });
    return json(res, 200, { ok: true });
  };
}
