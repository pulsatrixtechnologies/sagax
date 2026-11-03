// The person's background brief (server/proactive/background-brief.ts).
//
//   GET  /api/bots/:id/background-brief
//   PUT  /api/bots/:id/background-brief   { enabled?, everyHours?, subjects?, at?, timeZone? }
//        `at` (HH:MM) in `timeZone` is when the brief runs on its own each
//        day (server/proactive/background-brief-schedule.ts). On by default for a
//        Primary Bot; `enabled: false` turns it off.
//   POST /api/bots/:id/background-brief/pass { costUsd? }
//        Reads the apps already connected. No app: an empty queue.
//   POST /api/bots/:id/background-brief/:suggestionId/reject
//   POST /api/bots/:id/background-brief/:suggestionId/keep
//
// A pass does not invent pieces. It files only what the caller already read,
// and only when every tool named is a read. Keep writes one memory line
// stamped for the person.

import { PASS, type RouteHandler } from "./table.ts";
import type { RequestAuth } from "../request-auth.ts";
import {
  keptMemoryLine,
  readConnectedBrief,
  type BriefAppCall,
  type BriefSettings,
  type BriefStore,
} from "../proactive/background-brief.ts";

export interface BackgroundBriefRouteDeps {
  store: BriefStore;
  /** The signed-in person owns this bot. A bot or a service does not. */
  owns: (auth: RequestAuth, botId: string) => boolean;
  /** The bot's fast model, or null when none is set. */
  fastModel: (botId: string) => string | null;
  /** Write the kept line into the person's memory. */
  keep: (botId: string, line: string) => void;
  /** Names of the apps already connected. Empty: the queue stays empty. */
  connected(botId: string): readonly string[];
  /** A read of those apps. No send, no change, no browser. */
  reads(botId: string): Promise<BriefAppCall>;
}

export function createBackgroundBriefRoutes(deps: BackgroundBriefRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json, readBody, req }) => {
    const match = /^\/api\/bots\/([^/]+)\/background-brief(?:\/([^/]+)(?:\/([^/]+))?)?$/.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "no-store");
    const botId = decodeURIComponent(match[1]!);
    if (!deps.owns(auth, botId)) return json(res, 403, { error: "Sign in as the bot's person." });
    const suggestionId = match[2];
    const action = match[3];

    if (!suggestionId && method === "GET") {
      const apps = deps.connected(botId).length;
      return json(res, 200, { ...deps.store.view(botId), apps, ...(apps ? {} : { notice: "no_apps" as const }) });
    }
    if (!suggestionId && method === "PUT") {
      const body = await readBody(req) as Partial<BriefSettings>;
      const subjects = Array.isArray(body.subjects) ? body.subjects.filter((item): item is string => typeof item === "string") : undefined;
      const settings = deps.store.saveSettings(botId, {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.everyHours === "number" ? { everyHours: body.everyHours } : {}),
        ...(subjects ? { subjects } : {}),
        ...(typeof body.at === "string" ? { at: body.at } : {}),
        ...(typeof body.timeZone === "string" ? { timeZone: body.timeZone } : {}),
      });
      return json(res, 200, { settings });
    }
    if (suggestionId === "pass" && method === "POST") {
      const connected = deps.connected(botId);
      if (!connected.length) return json(res, 200, { added: [], apps: 0, notice: "no_apps" });
      if (!deps.store.due(botId)) return json(res, 409, { error: "This brief is off, or its cadence has not elapsed.", code: "brief_not_due" });
      const body = await readBody(req) as { costUsd?: unknown };
      const costUsd = typeof body.costUsd === "number" ? body.costUsd : 0;
      const call = await deps.reads(botId);
      const pass = await readConnectedBrief(call, { costUsd, fastModel: deps.fastModel(botId) }, deps.store.view(botId).suggestions.filter((item) => item.status === "rejected").map((item) => item.identity));
      if (!pass.ok) return json(res, 400, { error: pass.error, apps: pass.apps });
      if (pass.notice === "no_apps" || !pass.suggestions.length) return json(res, 200, { added: [], apps: pass.apps, ...(pass.notice ? { notice: pass.notice } : {}) });
      return json(res, 200, { model: pass.model, costUsd: pass.costUsd, apps: pass.apps, added: deps.store.recordPass(botId, pass) });
    }
    if (suggestionId && action === "reject" && method === "POST") {
      const rejected = deps.store.reject(botId, suggestionId);
      if (!rejected) return json(res, 404, { error: "No pending suggestion." });
      return json(res, 200, { suggestion: rejected });
    }
    if (suggestionId && action === "keep" && method === "POST") {
      const kept = deps.store.takePending(botId, suggestionId);
      if (!kept) return json(res, 404, { error: "No pending suggestion." });
      deps.keep(botId, kept.text);
      return json(res, 200, { suggestion: kept, line: keptMemoryLine(kept.text) });
    }
    return json(res, 405, { error: "Method not allowed." });
  };
}
