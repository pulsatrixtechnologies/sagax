// Content between people (App Store guideline 1.2, server/safety/moderation.ts).
//
//   POST   /api/threads/:threadId/messages/:messageId/report { reason, note? }
//          Report a message someone else wrote. The author comes from the
//          stored message, the reporter from the session. The thread gates
//          in server/index.ts ran first: only someone who reads the thread
//          gets here. The organization's admins (a solo server's owner) are
//          told at once and find it in GET /api/moderation/reports.
//   GET    /api/me/blocks                 the person's own blocked people
//   POST   /api/me/blocks { id, name }    block one (personal: nobody else changes)
//   DELETE /api/me/blocks/:id             unblock
//   GET    /api/me/terms                  whether the person accepted the terms
//   POST   /api/me/terms { version }      accept them, once per person
//   GET    /api/moderation/reports        admins: every report, newest first
//   POST   /api/moderation/reports/:id/resolve   admins: mark one handled
//
// The /api/me and report routes are member scope (request-auth.ts
// CLIENT_ALLOW): everyone keeps their own. The /api/moderation routes are
// admin scope (not listed), and the handler checks again.
import { z } from "zod";

import {
  REPORT_REASONS,
  TERMS_URL,
  TERMS_VERSION,
  moderationPersonKey,
  type ModerationReport,
  type ModerationStore,
} from "../safety/moderation.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export const REPORT_ROUTE = /^\/api\/threads\/([\w-]+)\/messages\/([\w-]+)\/report$/;
/** A report is a reader's mark, like a reaction: a read-only member of a
 * shared room may send one (server/index.ts read-only gate). */
export function isReportPath(path: string): boolean {
  return REPORT_ROUTE.test(path);
}
const BLOCK_ROUTE = /^\/api\/me\/blocks\/([^/]{1,600})$/;
const RESOLVE_ROUTE = /^\/api\/moderation\/reports\/(rep_[a-f0-9]{1,64})\/resolve$/;

/** The message being reported, as the server stored it. */
export interface ReportedMessage {
  /** Who wrote it; null when nobody can be named (a system line). */
  author: { id: string; name: string; kind: "person" | "bot" } | null;
  text: string;
  /** The room or direct conversation the thread belongs to. */
  group?: { id: string; name: string; peopleDm: boolean };
}

export interface ModerationRouteDeps {
  store: ModerationStore;
  /** The person acting: the session's principal, or the operator here. */
  viewer(auth: RequestAuth): { id: string; name: string } | null;
  /** An organization admin, or a solo server's owner. */
  isAdmin(auth: RequestAuth): boolean;
  message(threadId: string, messageId: string): ReportedMessage | null;
  /** Tell the admins (a live notice); the report is already stored. */
  notifyAdmins(report: ModerationReport): void;
}

const reportBody = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(4_000).optional(),
}).strict();
const blockBody = z.object({ id: z.string().min(1).max(200), name: z.string().max(200).optional() }).strict();
const termsBody = z.object({ version: z.string().min(1).max(40).optional() }).strict();

function isJson(req: { headers: Record<string, unknown> }): boolean {
  return /^application\/json\b/i.test(String(req.headers["content-type"] ?? ""));
}

function statusOf(error: unknown): number {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : 500;
}

export function createModerationRoutes(deps: ModerationRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const report = path.match(REPORT_ROUTE);
    if (report) {
      if (method !== "POST") return json(res, 405, { error: "POST" });
      const viewer = deps.viewer(auth);
      const viewerKey = viewer ? moderationPersonKey(viewer.id) : null;
      if (!viewer || !viewerKey) return json(res, 403, { error: "Sign in to report a message.", code: "session_required" });
      if (!isJson(req)) return json(res, 415, { error: "send the report as JSON (content-type: application/json)" });
      const parsed = reportBody.safeParse(await readBody(req));
      if (!parsed.success) return json(res, 400, { error: `send { reason: ${REPORT_REASONS.join(" | ")}, note? }`, code: "report_invalid" });
      const [, threadId, messageId] = report;
      const message = deps.message(threadId!, messageId!);
      if (!message) return json(res, 404, { error: "no such message" });
      if (!message.author) return json(res, 400, { error: "This line has no author to report.", code: "report_no_author" });
      if (moderationPersonKey(message.author.id) === viewerKey) return json(res, 400, { error: "You cannot report your own message.", code: "report_own_message" });
      const saved = deps.store.addReport({
        threadId: threadId!,
        messageId: messageId!,
        ...(message.group ? { groupId: message.group.id, groupName: message.group.name, ...(message.group.peopleDm ? { peopleDm: true } : {}) } : {}),
        reportedId: message.author.kind === "person" ? moderationPersonKey(message.author.id) ?? message.author.id : message.author.id,
        reportedName: message.author.name,
        reportedKind: message.author.kind,
        reason: parsed.data.reason,
        ...(parsed.data.note ? { note: parsed.data.note } : {}),
        ...(message.text ? { excerpt: message.text } : {}),
        reporterId: viewerKey,
        reporterName: viewer.name,
      });
      try {
        deps.notifyAdmins(saved);
      } catch (error) {
        // the report is stored: the admins still find it in the list
        console.warn(`moderation: admins not notified (${error instanceof Error ? error.message : String(error)})`);
      }
      return json(res, 201, { report: { id: saved.id, at: saved.at, status: saved.status } });
    }

    if (path === "/api/me/blocks" || BLOCK_ROUTE.test(path)) {
      const viewer = deps.viewer(auth);
      if (!viewer || !moderationPersonKey(viewer.id)) return json(res, 403, { error: "Sign in to manage the people you blocked.", code: "session_required" });
      try {
        if (path === "/api/me/blocks") {
          if (method === "GET") return json(res, 200, { people: deps.store.blocks(viewer.id) });
          if (method === "POST") {
            if (!isJson(req)) return json(res, 415, { error: "send { id, name } as JSON" });
            const parsed = blockBody.safeParse(await readBody(req));
            const target = parsed.success ? moderationPersonKey(parsed.data.id) : null;
            if (!parsed.success || !target) return json(res, 400, { error: "send { id, name } of the person to block", code: "block_invalid" });
            if (target === moderationPersonKey(viewer.id)) return json(res, 400, { error: "You cannot block yourself.", code: "block_self" });
            return json(res, 200, { people: deps.store.block(viewer.id, { id: target, name: parsed.data.name ?? "" }) });
          }
          return json(res, 405, { error: "GET or POST" });
        }
        if (method !== "DELETE") return json(res, 405, { error: "DELETE" });
        let id: string;
        try {
          id = decodeURIComponent(path.match(BLOCK_ROUTE)![1]!);
        } catch {
          return json(res, 400, { error: "not a person", code: "block_invalid" });
        }
        return json(res, 200, { people: deps.store.unblock(viewer.id, id) });
      } catch (error) {
        const status = statusOf(error);
        return json(res, status, { error: status === 500 ? "The list could not be saved." : (error as Error).message });
      }
    }

    if (path === "/api/me/terms") {
      const viewer = deps.viewer(auth);
      if (!viewer || !moderationPersonKey(viewer.id)) return json(res, 403, { error: "Sign in to accept the terms.", code: "session_required" });
      if (method === "GET") {
        const accepted = deps.store.terms(viewer.id);
        return json(res, 200, { accepted: Boolean(accepted), current: TERMS_VERSION, url: TERMS_URL, ...(accepted ? { version: accepted.version, acceptedAt: accepted.acceptedAt } : {}) });
      }
      if (method === "POST") {
        const body = isJson(req) ? await readBody(req) : {};
        const parsed = termsBody.safeParse(body ?? {});
        if (!parsed.success) return json(res, 400, { error: "send { version }", code: "terms_invalid" });
        try {
          const saved = deps.store.acceptTerms(viewer.id, parsed.data.version ?? TERMS_VERSION);
          return json(res, 200, { accepted: true, current: TERMS_VERSION, url: TERMS_URL, version: saved.version, acceptedAt: saved.acceptedAt });
        } catch (error) {
          const status = statusOf(error);
          return json(res, status, { error: status === 500 ? "The acceptance could not be saved." : (error as Error).message });
        }
      }
      return json(res, 405, { error: "GET or POST" });
    }

    if (path === "/api/moderation/reports" || RESOLVE_ROUTE.test(path)) {
      if (!deps.isAdmin(auth)) return json(res, 403, { error: "Reports are for the organization's admins.", code: "admin_required" });
      if (path === "/api/moderation/reports") {
        if (method !== "GET") return json(res, 405, { error: "GET" });
        return json(res, 200, { reports: deps.store.reports() });
      }
      if (method !== "POST") return json(res, 405, { error: "POST" });
      const viewer = deps.viewer(auth);
      const resolved = deps.store.resolveReport(path.match(RESOLVE_ROUTE)![1]!, viewer?.name || viewer?.id || "admin");
      if (!resolved) return json(res, 404, { error: "no such report" });
      return json(res, 200, { report: resolved });
    }
    return PASS;
  };
}
