// In-app feedback (#2618, #3299): list the person's own reports and their
// status, and (admin) set the GitHub token the server files with. The token
// is never sent back: the view only says whether one is set. A report starts
// from /feedback typed in a chat (POST /api/bots/:id/messages, with what the
// app attaches in its `feedback` field, read by parseFeedbackAppContext).
//
//   GET  /api/feedback                (client: the session person's reports)
//   GET  /api/admin/feedback-config   (admin)
//   PUT  /api/admin/feedback-config   (admin)
import { FEEDBACK_PLATFORMS, type FeedbackAppContext, type FeedbackPlatform } from "../../shared/feedback.ts";
import { feedbackConfigView, readFeedbackConfig, writeFeedbackConfig } from "../feedback/config.ts";
import type { FeedbackService } from "../feedback/service.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface FeedbackRouteDeps {
  dataDir: string;
  service: FeedbackService;
  actorPrincipalId: (auth: RequestAuth) => string;
}

/** The `feedback` field the app attaches to a /feedback message
 * (POST /api/bots/:id/messages), cut to size; undefined when absent. */
export function parseFeedbackAppContext(raw: unknown): FeedbackAppContext | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const body = raw as Record<string, unknown>;
  const platform = FEEDBACK_PLATFORMS.includes(body.platform as FeedbackPlatform) ? body.platform as FeedbackPlatform : "web";
  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
  const context: FeedbackAppContext = { platform };
  if (body.locale === "en" || body.locale === "fr") context.locale = body.locale;
  const appVersion = text(body.appVersion, 80);
  const os = text(body.os, 120);
  const page = text(body.page, 120);
  if (appVersion) context.appVersion = appVersion;
  if (os) context.os = os;
  if (page) context.page = page;
  if (Array.isArray(body.clientLogs)) context.clientLogs = body.clientLogs.filter((line): line is string => typeof line === "string").slice(-60);
  return context;
}

export function createFeedbackRoutes(deps: FeedbackRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/feedback" && method === "GET") {
      res.setHeader("cache-control", "no-store");
      return json(res, 200, { reports: deps.service.list(deps.actorPrincipalId(auth) || null) });
    }
    if (path === "/api/admin/feedback-config") {
      if (method === "GET") return json(res, 200, feedbackConfigView(readFeedbackConfig(deps.dataDir)));
      if (method === "PUT") {
        const body = (await readBody(req)) as { repo?: unknown; token?: unknown } | null;
        const patch: { repo?: string; token?: string | null } = {};
        if (typeof body?.repo === "string") patch.repo = body.repo.trim();
        if (body?.token === null || body?.token === "") patch.token = null;
        else if (typeof body?.token === "string") patch.token = body.token.trim();
        try {
          writeFeedbackConfig(deps.dataDir, patch);
        } catch (error) {
          return json(res, 400, { error: error instanceof Error ? error.message : "invalid feedback settings" });
        }
        return json(res, 200, feedbackConfigView(readFeedbackConfig(deps.dataDir)));
      }
    }
    return PASS;
  };
}
