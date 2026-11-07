// In-app feedback (#2618): open the Feedback bot's conversation with what the
// app attaches on its own, list the person's own reports and their status,
// and (admin) set the GitHub token the server files with. The token is never
// sent back: the view only says whether one is set.
//
//   POST /api/feedback/start          (client)
//   GET  /api/feedback                (client: the session person's reports)
//   GET  /api/admin/feedback-config   (admin)
//   PUT  /api/admin/feedback-config   (admin)
import { FEEDBACK_SOURCES, type FeedbackPlatform, type FeedbackSource, type FeedbackStartRequest } from "../../shared/feedback.ts";
import { feedbackConfigView, readFeedbackConfig, writeFeedbackConfig } from "../feedback/config.ts";
import type { FeedbackService } from "../feedback/service.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface FeedbackRouteDeps {
  dataDir: string;
  service: FeedbackService;
  actorPrincipalId: (auth: RequestAuth) => string;
}

const PLATFORMS: readonly FeedbackPlatform[] = ["desktop", "ios", "web"];
const MAX_BODY = 12 * 1024 * 1024;

export function parseFeedbackStart(body: unknown): FeedbackStartRequest | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  const source = FEEDBACK_SOURCES.includes(raw.source as FeedbackSource) ? raw.source as FeedbackSource : "menu";
  const platform = PLATFORMS.includes(raw.platform as FeedbackPlatform) ? raw.platform as FeedbackPlatform : "web";
  const text = (value: unknown, max: number) => (typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined);
  const request: FeedbackStartRequest = { source, platform, locale: raw.locale === "en" ? "en" : "fr" };
  const appVersion = text(raw.appVersion, 80);
  const os = text(raw.os, 120);
  const page = text(raw.page, 120);
  const error = text(raw.error, 4000);
  if (appVersion) request.appVersion = appVersion;
  if (os) request.os = os;
  if (page) request.page = page;
  if (error) request.error = error;
  if (Array.isArray(raw.clientLogs)) request.clientLogs = raw.clientLogs.filter((line): line is string => typeof line === "string").slice(-60);
  if (typeof raw.screenshot === "string" && raw.screenshot.startsWith("data:image/png;base64,")) request.screenshot = raw.screenshot;
  return request;
}

export function createFeedbackRoutes(deps: FeedbackRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    if (path === "/api/feedback/start" && method === "POST") {
      const request = parseFeedbackStart(await readBody(req, MAX_BODY));
      if (!request) return json(res, 400, { error: "a JSON body is required" });
      return json(res, 200, deps.service.start(deps.actorPrincipalId(auth) || null, request));
    }
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
