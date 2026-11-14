// The person's background brief (server/proactive/background-brief.ts).
//
//   GET  /api/bots/:id/background-brief
//   PUT  /api/bots/:id/background-brief   { enabled?, everyHours?, subjects?, at?, timeZone?, screenContext? }
//        `screenContext` (#2699): the bot sees the front app and window
//        title on this computer. GET says `screenContextAvailable` (the
//        desktop app on macOS or Windows); elsewhere a PUT of it is ignored.
//        `at` (HH:MM) in `timeZone` is when the brief runs each day. #3456:
//        the brief is a routine of the bot (server/proactive/brief-routine.ts),
//        never on by default: `enabled: true` is the person's yes and creates
//        or resumes it, `enabled: false` pauses it, a time or subjects change
//        moves it. GET reads `enabled` and the time from that routine (the
//        person may pause or move it in the routines list). `checklist` (#3432):
//        a plain switch of the checklist wakes (heartbeat), no memory line.
//        #4250: it is the checklist routine's on and off (false pauses it,
//        true turns it on).
//        `reviews` (#4250 S8): `{ endOfDay?, weekly? }`, the person's switch
//        of each review routine (server/proactive/review-routines.ts): true is
//        their yes and creates or resumes it, in `timeZone`; false pauses it.
//        The answer carries `reviews`, what runs now.
//   POST /api/bots/:id/background-brief/pass { costUsd? }
//        Reads the apps already connected. No app: an empty queue.
//   POST /api/bots/:id/background-brief/:suggestionId/reject
//   POST /api/bots/:id/background-brief/:suggestionId/keep
//   POST /api/bots/:id/background-brief/:suggestionId/feedback { choice, threadId?, messageId? }
//        #2694: up, down, less or never. Applies at the next pass and
//        leaves one memory line for the person.
//   POST /api/bots/:id/background-brief/wake/feedback { choice, topic, threadId?, messageId? }
//        #2694: the same choice on a whole wake kind (heartbeat, mail,
//        calendar, attention, ...): it shapes the next wakes of that kind
//        and is kept on the message it was given on.
//
// A pass does not invent pieces. It files only what the caller already read,
// and only when every tool named is a read. Keep writes one memory line
// stamped for the person.

import { PASS, type RouteHandler } from "./table.ts";
import type { ReviewKind } from "../proactive/review-routines.ts";
import type { RequestAuth } from "../auth/request-auth.ts";
import {
  isBriefFeedback,
  keptMemoryLine,
  localizedGist,
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
  /** Write the kept line, already in the person's language, into their memory. */
  keep: (botId: string, line: string) => void;
  /** #2879: the person's language, for the kept line. Absent: English. */
  language?: (botId: string) => "fr" | "en";
  /** #2694: write a feedback line into the person's memory. */
  remember?: (botId: string, choice: import("../proactive/background-brief.ts").BriefFeedback, text: string, topic: string) => void;
  /** #2694: feedback on a wake kind, from a wake's message or a Today card. */
  wakeFeedback?: (botId: string, topic: string, choice: import("../proactive/background-brief.ts").BriefFeedback, where: { threadId?: string; messageId?: string }) => { status: number; body: Record<string, unknown> };
  /** #2694: a brief item rated from the chat: its row in the brief message shows the choice. */
  itemShown?: (botId: string, suggestionId: string, choice: import("../proactive/background-brief.ts").BriefFeedback, where: { threadId: string; messageId: string }) => void;
  /** Names of the apps already connected. Empty: the queue stays empty. */
  connected(botId: string): readonly string[];
  /** A read of those apps. No send, no change, no browser. */
  reads(botId: string): Promise<BriefAppCall>;
  /** #2699: screen context works here (desktop app, macOS or Windows). */
  screenContextAvailable?: () => boolean;
  /** #4250: the checklist's one switch (server/heartbeat/heartbeat.ts
   * setOn): its routine on or paused. Absent: the heartbeat mute. */
  checklist?: (botId: string, on: boolean) => boolean | undefined;
  /** #3456: the bot's brief routine (server/proactive/brief-routine.ts). */
  routine?: {
    view(botId: string): BriefSettings;
    sync(botId: string, patch: Partial<BriefSettings>, settings: BriefSettings): void;
  };
  /** #4250 (S8): the bot's end of day and weekly review routines. */
  reviews?: {
    set(botId: string, kind: ReviewKind, on: boolean, timeZone?: string): unknown;
    on(botId: string, kind: ReviewKind): boolean;
  };
}

/** The review switches of a PUT body, by routine kind. */
function reviewSwitches(value: unknown): Array<[ReviewKind, boolean]> {
  if (!value || typeof value !== "object") return [];
  const body = value as { endOfDay?: unknown; weekly?: unknown };
  return [
    ...(typeof body.endOfDay === "boolean" ? [["end_of_day", body.endOfDay] as [ReviewKind, boolean]] : []),
    ...(typeof body.weekly === "boolean" ? [["weekly", body.weekly] as [ReviewKind, boolean]] : []),
  ];
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
      const screenContextAvailable = deps.screenContextAvailable?.() === true;
      const view = deps.store.view(botId);
      return json(res, 200, { ...view, ...(deps.routine ? { settings: deps.routine.view(botId) } : {}), apps, screenContextAvailable, ...(apps ? {} : { notice: "no_apps" as const }) });
    }
    if (!suggestionId && method === "PUT") {
      const body = await readBody(req) as Partial<BriefSettings> & { checklist?: unknown; reviews?: unknown };
      const switches = deps.reviews ? reviewSwitches(body.reviews) : [];
      if (switches.length) {
        const timeZone = typeof body.timeZone === "string" ? body.timeZone : undefined;
        try {
          for (const [kind, on] of switches) deps.reviews!.set(botId, kind, on, timeZone);
        } catch (error) {
          return json(res, 409, { error: `The review's routine could not be saved: ${error instanceof Error ? error.message : String(error)}` });
        }
        const reviews = { endOfDay: deps.reviews!.on(botId, "end_of_day"), weekly: deps.reviews!.on(botId, "weekly") };
        // a plain switch of a review: the brief's settings stay as they are
        if (body.enabled === undefined && body.at === undefined && body.subjects === undefined && body.everyHours === undefined
          && body.screenContext === undefined && body.checklist === undefined) return json(res, 200, { reviews });
      }
      const subjects = Array.isArray(body.subjects) ? body.subjects.filter((item): item is string => typeof item === "string") : undefined;
      const patch: Partial<BriefSettings> = {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(typeof body.everyHours === "number" ? { everyHours: body.everyHours } : {}),
        ...(subjects ? { subjects } : {}),
        ...(typeof body.at === "string" ? { at: body.at } : {}),
        ...(typeof body.timeZone === "string" ? { timeZone: body.timeZone } : {}),
        ...(typeof body.screenContext === "boolean" && deps.screenContextAvailable?.() === true ? { screenContext: body.screenContext } : {}),
      };
      // #3432: the checklist switch, with no vote and no memory line; #4250:
      // it is the checklist routine's own on and off
      const asked = typeof body.checklist === "boolean" ? body.checklist : undefined;
      const checklist = asked === undefined ? undefined
        : deps.checklist ? deps.checklist(botId, asked) ?? asked
        : !deps.store.setWakeMuted(botId, "heartbeat", !asked);
      const settings = checklist !== undefined && !Object.keys(patch).length ? deps.store.settings(botId) : deps.store.saveSettings(botId, patch);
      if (!deps.routine) return json(res, 200, { settings, ...(checklist !== undefined ? { checklist } : {}) });
      try {
        deps.routine.sync(botId, patch, settings);
      } catch (error) {
        return json(res, 409, { error: `The brief's routine could not be saved: ${error instanceof Error ? error.message : String(error)}`, settings: deps.routine.view(botId) });
      }
      return json(res, 200, { settings: deps.routine.view(botId), ...(checklist !== undefined ? { checklist } : {}) });
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
    if (suggestionId === "wake" && action === "feedback" && method === "POST") {
      if (!deps.wakeFeedback) return json(res, 404, { error: "Not found." });
      const body = await readBody(req) as { choice?: unknown; topic?: unknown; threadId?: unknown; messageId?: unknown } | null;
      const choice = body?.choice;
      if (!isBriefFeedback(choice)) return json(res, 400, { error: "choice must be up, down, less or never" });
      const topic = typeof body?.topic === "string" ? body.topic.trim().toLowerCase() : "";
      if (!/^[a-z][a-z-]{0,29}$/.test(topic)) return json(res, 400, { error: "topic must be a wake kind" });
      const id = (value: unknown) => typeof value === "string" && /^[\w-]{1,200}$/.test(value) ? value : undefined;
      const threadId = id(body?.threadId);
      const messageId = id(body?.messageId);
      const done = deps.wakeFeedback(botId, topic, choice, { ...(threadId ? { threadId } : {}), ...(messageId ? { messageId } : {}) });
      return json(res, done.status, done.body);
    }
    if (suggestionId && action === "feedback" && method === "POST") {
      const body = await readBody(req) as { choice?: unknown; threadId?: unknown; messageId?: unknown } | null;
      const choice = body?.choice;
      if (!isBriefFeedback(choice)) return json(res, 400, { error: "choice must be up, down, less or never" });
      const done = deps.store.feedback(botId, suggestionId, choice);
      if (!done) return json(res, 404, { error: "No such suggestion." });
      deps.remember?.(botId, choice, done.item.text, done.topic);
      const id = (value: unknown) => typeof value === "string" && /^[\w-]{1,200}$/.test(value) ? value : undefined;
      const threadId = id(body?.threadId);
      const messageId = id(body?.messageId);
      if (threadId && messageId) deps.itemShown?.(botId, suggestionId, choice, { threadId, messageId });
      return json(res, 200, { suggestion: done.item, topic: done.topic });
    }
    if (suggestionId && action === "keep" && method === "POST") {
      const kept = deps.store.takePending(botId, suggestionId);
      if (!kept) return json(res, 404, { error: "No pending suggestion." });
      const language = deps.language?.(botId) ?? "en";
      deps.keep(botId, localizedGist(kept.text, language));
      return json(res, 200, { suggestion: kept, line: keptMemoryLine(kept.text, new Date(), language) });
    }
    return json(res, 405, { error: "Method not allowed." });
  };
}
