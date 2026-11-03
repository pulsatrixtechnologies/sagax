/**
 * Public scheduled room session routes (#1388 wave 2 P2): /api/calendar-calls*.
 *
 * Registered in ROUTES after the auth gate. Never imports server/index.ts.
 */
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  calendarCallRefusal,
  visibleCalendarCalls,
  type CalendarCallAccess,
} from "../calendar-call-access.ts";
import type { CalendarCall } from "../calendar-calls.ts";
import { PASS, type RouteHandler } from "./table.ts";

/** A scheduled call with several bots opens a room, so its bots keep one audience too. */
export function calendarAudienceConflict(
  body: unknown,
  roomAudienceConflict: (botIds: readonly string[]) => string | null,
): string | null {
  const botIds = body && typeof body === "object" ? (body as { botIds?: unknown }).botIds : undefined;
  if (!Array.isArray(botIds) || botIds.length < 2 || botIds.some((id) => typeof id !== "string")) return null;
  return roomAudienceConflict(botIds as string[]);
}

export interface CalendarCallsRouteDeps {
  list(): CalendarCall[];
  get(id: string): CalendarCall | null;
  create(body: unknown): CalendarCall;
  update(id: string, body: unknown): CalendarCall;
  remove(id: string): boolean;
  /** An admin or this computer's owner (viewerFor(...).kind === "all"). */
  viewerEverything(auth: RequestAuth, path: string): boolean;
  botVisible(auth: RequestAuth, botId: string): boolean;
  needsRun(auth: RequestAuth, botId: string): boolean;
  roomAudienceConflict(botIds: readonly string[]): string | null;
  ensureRoom(call: CalendarCall): { id: string; threadId: string; memberIds: string[]; [key: string]: unknown };
  publicGroup(group: { id: string; threadId: string; memberIds: string[]; [key: string]: unknown }): object;
  projectMessages(threadId: string, messages: unknown[], viewer: unknown): unknown[];
  approvalViewer(auth: RequestAuth): unknown;
  messagesFor(threadId: string): unknown[];
}

export function createCalendarCallsRoutes(deps: CalendarCallsRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (!path.startsWith("/api/calendar-calls")) return PASS;

    const callAccess: CalendarCallAccess = {
      everything: deps.viewerEverything(auth, path),
      botVisible: (botId) => deps.botVisible(auth, botId),
      needsRun: (botId) => deps.needsRun(auth, botId),
    };

    if (path === "/api/calendar-calls" && method === "GET") {
      return json(res, 200, { calls: visibleCalendarCalls(deps.list(), callAccess) });
    }

    if (path === "/api/calendar-calls" && method === "POST") {
      try {
        const body = await readBody(req);
        const refusal = calendarCallRefusal(callAccess, null, body);
        if (refusal) return json(res, refusal.status, refusal.body);
        const conflict = calendarAudienceConflict(body, deps.roomAudienceConflict);
        if (conflict) return json(res, 400, { error: conflict });
        return json(res, 201, { call: deps.create(body) });
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status: 400 });
      }
    }

    const calendarCallRoomMatch = path.match(/^\/api\/calendar-calls\/([\w-]+)\/room$/);
    if (calendarCallRoomMatch && method === "POST") {
      const call = deps.get(calendarCallRoomMatch[1]!);
      if (!call) return json(res, 404, { error: "no such scheduled call" });
      const refusal = calendarCallRefusal(callAccess, call);
      if (refusal) return json(res, refusal.status, refusal.body);
      if (call.botIds.length < 2) {
        return json(res, 400, { error: "single-bot events open that bot's chat directly" });
      }
      const group = deps.ensureRoom(call);
      return json(res, 200, {
        group: {
          ...deps.publicGroup(group),
          messages: deps.projectMessages(group.threadId, deps.messagesFor(group.threadId), deps.approvalViewer(auth)),
        },
      });
    }

    const calendarCallMatch = path.match(/^\/api\/calendar-calls\/([\w-]+)$/);
    if (calendarCallMatch && method === "PATCH") {
      const existing = deps.get(calendarCallMatch[1]!);
      if (!existing) return json(res, 404, { error: "no such scheduled call" });
      try {
        const body = await readBody(req);
        const refusal = calendarCallRefusal(callAccess, existing, body);
        if (refusal) return json(res, refusal.status, refusal.body);
        const conflict = calendarAudienceConflict(body, deps.roomAudienceConflict);
        if (conflict) return json(res, 400, { error: conflict });
        return json(res, 200, { call: deps.update(calendarCallMatch[1]!, body) });
      } catch (error) {
        throw Object.assign(error instanceof Error ? error : new Error(String(error)), { status: 400 });
      }
    }

    if (calendarCallMatch && method === "DELETE") {
      const existing = deps.get(calendarCallMatch[1]!);
      const refusal = existing ? calendarCallRefusal(callAccess, existing) : null;
      if (refusal) return json(res, refusal.status, refusal.body);
      return deps.remove(calendarCallMatch[1]!)
        ? json(res, 200, { ok: true })
        : json(res, 404, { error: "no such scheduled call" });
    }

    return PASS;
  };
}
